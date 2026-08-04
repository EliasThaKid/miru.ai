-- SECURITY FIX — close the self-service refund hole.
--
-- 0001 granted `refund_tokens` to `authenticated`, and the function credits whatever
-- p_amount it is handed with no evidence that a matching spend ever happened. Because
-- PostgREST exposes every execute-granted public function at /rest/v1/rpc/<name>, any
-- signed-in user could mint an unbounded balance with the public anon key and their own
-- JWT — which converts straight into unbounded fal spend on the owner's account.
--
-- Two changes:
--   1. `refund_tokens` is revoked from `authenticated`. Refunds are no longer reachable
--      with a user JWT at all.
--   2. Refunds move to `refund_spend`, callable ONLY by the service role (a server-only
--      secret that never reaches the browser). It additionally refuses to refund more than
--      the caller actually spent against that ref, so even a bug in a Server Action — or a
--      leaked service key used carelessly — cannot credit tokens out of thin air.
--
-- Spending stays reachable with a user JWT. That asymmetry is deliberate: a user calling
-- spend_tokens directly can only DRAIN their own balance, which is self-harm, and it can't
-- trigger a paid fal call because that only happens inside the Server Action.
--
-- Apply with: supabase db push (or paste into the Supabase SQL editor). Safe to re-run.

-- ---------------------------------------------------------------------------------------
-- 1. Revoke the user-callable refund.
-- ---------------------------------------------------------------------------------------
revoke all on function public.refund_tokens(integer, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Service-role-only refund, bounded by real recorded spend.
-- ---------------------------------------------------------------------------------------
-- `p_ref` is the same reference the spend was recorded under (a moment id, or a
-- "from->to" pair key). Net spend for that ref = spends minus refunds already issued, so:
--   * refunding twice for one failure is capped by what remains, and
--   * total refunds for a ref can never exceed total spends for that ref.
-- Returns the number of tokens actually credited (0 when there is nothing to refund).
create or replace function public.refund_spend(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text,
  p_ref     text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_net integer;
begin
  if p_user_id is null then raise exception 'INVALID_USER'; end if;
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  -- Net tokens still standing as spent against this ref.
  select coalesce(sum(-delta), 0) into v_net
    from public.token_ledger
   where user_id = p_user_id
     and ref = p_ref
     and (reason like 'spend:%' or reason like 'refund:%');

  if v_net <= 0 then
    return 0;  -- nothing outstanding: already refunded, or never spent
  end if;
  if p_amount > v_net then
    raise exception 'REFUND_EXCEEDS_SPEND';
  end if;

  update public.token_balances
     set tokens = tokens + p_amount, updated_at = now()
   where user_id = p_user_id;

  insert into public.token_ledger (user_id, delta, reason, ref)
  values (p_user_id, p_amount, p_reason, p_ref);

  return p_amount;
end;
$$;

-- Not granted to anon or authenticated: the service role bypasses these grants, and nothing
-- else may call it.
revoke all on function public.refund_spend(uuid, integer, text, text) from public, anon, authenticated;
