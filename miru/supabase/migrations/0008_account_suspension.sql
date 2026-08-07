-- Moderation — the ability to stop an account from spending.
--
-- The go-live checklist requires a content policy AND a way to enforce it. Users generate on
-- the owner's fal and Anthropic keys, so "we can ban someone" has to mean something
-- operationally, not just in a document.
--
-- Enforcement lives inside spend_tokens, alongside the balance check, for the same reason the
-- caps do: it is the single choke point every paid generation passes through, it is atomic,
-- and it cannot be skipped by calling the RPC directly. A suspended user keeps their account,
-- their projects, and their assets — they simply cannot spend.
--
-- To suspend someone (SQL editor):
--   insert into public.account_status (user_id, suspended_at, reason)
--   select id, now(), 'terms violation' from auth.users where email = 'them@example.com'
--   on conflict (user_id) do update set suspended_at = now(), reason = excluded.reason;
--
-- To reinstate:
--   update public.account_status set suspended_at = null, reason = null
--    where user_id = (select id from auth.users where email = 'them@example.com');
--
-- Apply with: supabase db push (or paste into the Supabase SQL editor). Safe to re-run.

create table if not exists public.account_status (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  suspended_at  timestamptz,
  reason        text,
  updated_at    timestamptz not null default now()
);

alter table public.account_status enable row level security;

-- A user may see that they are suspended (so the app can explain itself) but never write it.
drop policy if exists "account_status_select_own" on public.account_status;
create policy "account_status_select_own" on public.account_status for select
  using (auth.uid() = user_id);

-- Re-declare spend_tokens with the suspension check in front of the balance decrement.
-- Everything else is unchanged from 0002.
create or replace function public.spend_tokens(
  p_amount         integer,
  p_reason         text,
  p_ref            text,
  p_daily_cap      integer default null,
  p_global_ceiling integer default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_new       integer;
  v_day_start timestamptz := date_trunc('day', now());
  v_spent     integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  -- Moderation gate. Checked first: a suspended account should not be told about its balance
  -- or the daily caps, only that it is suspended.
  if exists (
    select 1 from public.account_status
     where user_id = v_uid and suspended_at is not null
  ) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  if p_global_ceiling is not null then
    select coalesce(sum(-delta), 0) into v_spent
      from public.token_ledger
     where created_at >= v_day_start
       and (reason like 'spend:%' or reason like 'refund:%');
    if v_spent + p_amount > p_global_ceiling then raise exception 'GLOBAL_CEILING_EXCEEDED'; end if;
  end if;

  if p_daily_cap is not null then
    select coalesce(sum(-delta), 0) into v_spent
      from public.token_ledger
     where user_id = v_uid
       and created_at >= v_day_start
       and (reason like 'spend:%' or reason like 'refund:%');
    if v_spent + p_amount > p_daily_cap then raise exception 'DAILY_CAP_EXCEEDED'; end if;
  end if;

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

revoke all on function public.spend_tokens(integer, text, text, integer, integer) from public, anon;
grant execute on function public.spend_tokens(integer, text, text, integer, integer) to authenticated;
