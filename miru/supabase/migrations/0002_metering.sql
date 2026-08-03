-- Phase 3 — metering safety rails on top of the atomic token economy.
--
-- Upgrades spend_tokens to enforce, in the SAME atomic function call as the balance
-- decrement:
--   * a per-user daily spend cap, and
--   * a global daily spend ceiling (the kill-switch against a runaway/abusive user).
-- Both limits are passed in BY THE SERVER (from env), never by the client. A signed-in
-- user could call this RPC directly, but they can only ever spend their OWN balance and
-- can't trigger a paid fal call without the server action — so client-supplied limits can't
-- be used to over-spend the owner's budget. The limits that gate real generation are the
-- ones the trusted server action passes here.
--
-- "Daily spend" counts only real, kept generations: spend rows minus refunded ones
-- (reason like 'spend:%' / 'refund:%'), so a failed-then-refunded attempt nets to zero and
-- purchases/welcome grants never inflate the allowance.
--
-- Apply with: supabase db push  (or paste into the Supabase SQL editor). Safe to re-run.

-- A plain time index so the daily-spend range scans stay cheap as the ledger grows.
create index if not exists token_ledger_time_idx on public.token_ledger (created_at);

-- Replace the 3-arg spender with a 5-arg version that also enforces the caps. Dropping the
-- old signature keeps a single, unambiguous entry point (nothing else calls it).
drop function if exists public.spend_tokens(integer, text, text);

create or replace function public.spend_tokens(
  p_amount         integer,
  p_reason         text,
  p_ref            text,
  p_daily_cap      integer default null,   -- per-user daily spend cap (null = no cap)
  p_global_ceiling integer default null    -- global daily spend ceiling (null = no ceiling)
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

  -- Global daily ceiling (kill-switch): net real spend across ALL users today. Visible here
  -- only because SECURITY DEFINER bypasses RLS — clients still can't read others' rows.
  if p_global_ceiling is not null then
    select coalesce(sum(-delta), 0) into v_spent
      from public.token_ledger
     where created_at >= v_day_start
       and (reason like 'spend:%' or reason like 'refund:%');
    if v_spent + p_amount > p_global_ceiling then raise exception 'GLOBAL_CEILING_EXCEEDED'; end if;
  end if;

  -- Per-user daily cap: this user's net real spend today.
  if p_daily_cap is not null then
    select coalesce(sum(-delta), 0) into v_spent
      from public.token_ledger
     where user_id = v_uid
       and created_at >= v_day_start
       and (reason like 'spend:%' or reason like 'refund:%');
    if v_spent + p_amount > p_daily_cap then raise exception 'DAILY_CAP_EXCEEDED'; end if;
  end if;

  -- Atomic balance decrement — the hard invariant. `WHERE tokens >= amount` means two
  -- concurrent spends can never drive the balance negative. (The cap checks above are not
  -- serialized with this, so a burst could overshoot a daily cap by a little; the cap is a
  -- coarse budget rail, while the balance floor is the guarantee.)
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

-- Live balance: let the app subscribe to its own token_balances row so the UI ticks down as
-- generations spend. RLS still applies to realtime, so a user only ever receives their own
-- row. Guarded so re-running the migration (or a table already in the publication) is a no-op.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.token_balances;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
