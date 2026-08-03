-- SceneLab hosted schema — accounts, per-user projects, and an atomic token economy.
--
-- Safety principles baked in here:
--   * The SERVER is the only authority on token balances. Clients can READ their own
--     balance/ledger but can NEVER write tokens (no INSERT/UPDATE grants). All movement goes
--     through SECURITY DEFINER functions that check-and-decrement atomically under a row lock.
--   * Spending is a single atomic statement (`UPDATE ... WHERE tokens >= amount`), so two
--     concurrent generations can never double-spend a balance into the negative.
--   * Purchases are idempotent on the Stripe session id, so a replayed webhook can't
--     double-credit.
--
-- Apply with: supabase db push  (or paste into the Supabase SQL editor).

-- ---------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------

-- One editable Project per row, stored as a JSONB blob mirroring the app's Project shape
-- (fast migration from the localStorage model; can be normalized into moments/transitions
-- later). `data` holds { title, script, characters, settings, moments, transitions, ... }.
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'Untitled scene',
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

-- Authoritative token balance (one row per user). Never written by clients.
create table if not exists public.token_balances (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  tokens      integer not null default 0 check (tokens >= 0),
  updated_at  timestamptz not null default now()
);

-- Append-only audit trail of every token movement. delta > 0 = credit, delta < 0 = spend.
create table if not exists public.token_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  delta       integer not null,
  reason      text not null,            -- e.g. 'spend:still', 'spend:clip', 'refund:clip', 'purchase', 'welcome'
  ref         text,                     -- e.g. moment id, stripe session id
  created_at  timestamptz not null default now()
);
create index if not exists token_ledger_user_idx on public.token_ledger (user_id, created_at desc);

-- Idempotent record of Stripe purchases (unique on the checkout session id).
create table if not exists public.purchases (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  stripe_session_id   text not null unique,
  tokens              integer not null,
  amount_cents        integer not null,
  status              text not null default 'complete',
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------
alter table public.projects       enable row level security;
alter table public.token_balances enable row level security;
alter table public.token_ledger   enable row level security;
alter table public.purchases      enable row level security;

-- Projects: a user fully owns their own rows.
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

-- Money tables: read-only to the owner; NO write policies at all, so tokens can only move
-- through the SECURITY DEFINER functions below (or the service role, which bypasses RLS).
create policy "balances_select_own" on public.token_balances for select using (auth.uid() = user_id);
create policy "ledger_select_own"   on public.token_ledger   for select using (auth.uid() = user_id);
create policy "purchases_select_own" on public.purchases     for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------------------
-- Atomic token movement (SECURITY DEFINER — runs as the table owner, bypassing RLS, but
-- scoped to auth.uid() so a signed-in user can only ever move their OWN tokens)
-- ---------------------------------------------------------------------------------------

-- Spend: atomic check-and-decrement. Raises INSUFFICIENT_TOKENS if the balance is too low.
-- Called from a Server Action *on behalf of the signed-in user* (their JWT → auth.uid()).
create or replace function public.spend_tokens(p_amount integer, p_reason text, p_ref text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  update public.token_balances
     set tokens = tokens - p_amount, updated_at = now()
   where user_id = v_uid and tokens >= p_amount
   returning tokens into v_new;

  if not found then raise exception 'INSUFFICIENT_TOKENS'; end if;

  insert into public.token_ledger (user_id, delta, reason, ref)
  values (v_uid, -p_amount, p_reason, p_ref);

  return v_new;
end;
$$;

-- Refund the signed-in user (e.g. a generation failed after we deducted). Owner-scoped.
create or replace function public.refund_tokens(p_amount integer, p_reason text, p_ref text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  update public.token_balances
     set tokens = tokens + p_amount, updated_at = now()
   where user_id = v_uid
   returning tokens into v_new;

  insert into public.token_ledger (user_id, delta, reason, ref)
  values (v_uid, p_amount, p_reason, p_ref);

  return v_new;
end;
$$;

-- Apply a completed Stripe purchase. Called ONLY by the webhook with the service role, with
-- an explicit user id (there is no user session in a server-to-server webhook). Idempotent:
-- inserting the purchase row conflicts on the unique session id, so a replay credits nothing.
create or replace function public.apply_purchase(
  p_user_id uuid, p_session_id text, p_tokens integer, p_amount_cents integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_inserted boolean := false;
begin
  insert into public.purchases (user_id, stripe_session_id, tokens, amount_cents)
  values (p_user_id, p_session_id, p_tokens, p_amount_cents)
  on conflict (stripe_session_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted then
    insert into public.token_balances (user_id, tokens)
    values (p_user_id, p_tokens)
    on conflict (user_id) do update set tokens = token_balances.tokens + excluded.tokens, updated_at = now();

    insert into public.token_ledger (user_id, delta, reason, ref)
    values (p_user_id, p_tokens, 'purchase', p_session_id);
  end if;
end;
$$;

-- Only the signed-in user may spend/refund; only trusted server code may apply purchases.
revoke all on function public.spend_tokens(integer, text, text)  from public, anon;
revoke all on function public.refund_tokens(integer, text, text) from public, anon;
revoke all on function public.apply_purchase(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.spend_tokens(integer, text, text)  to authenticated;
grant execute on function public.refund_tokens(integer, text, text) to authenticated;
-- apply_purchase is intentionally NOT granted to authenticated — webhook uses the service role.

-- ---------------------------------------------------------------------------------------
-- On signup: create a zeroed balance (+ an optional welcome grant for testing).
-- Set WELCOME_TOKENS to 0 for a pure paid economy; a small grant is handy while testing.
-- ---------------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_welcome integer := 20; -- CONFIG: free tokens on signup (0 = none)
begin
  insert into public.token_balances (user_id, tokens) values (new.id, v_welcome)
  on conflict (user_id) do nothing;
  if v_welcome > 0 then
    insert into public.token_ledger (user_id, delta, reason, ref) values (new.id, v_welcome, 'welcome', null);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep updated_at fresh on project writes
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
