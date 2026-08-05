-- Going public — right-size the free signup grant.
--
-- 0001 granted 20 tokens on signup, which was sensible while the only account was yours. On a
-- link anyone can click, 20 tokens is 2 Kling clips plus change: roughly a dollar of real fal
-- spend for every email address that signs up, with no other barrier.
--
-- 12 is one full storyboard of stills (8-12 moments at 1 token each) and NO clips, which costs
-- ~$0.50 and still lets a visitor experience the actual product end to end. Animation is the
-- expensive half, so it is the half that should require buying tokens.
--
-- CONFIG: change v_welcome below and re-run this file to adjust. 0 disables the free tier.
--
-- Existing balances are untouched — this only affects new signups.
--
-- Apply with: supabase db push (or paste into the Supabase SQL editor). Safe to re-run.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_welcome integer := 12; -- CONFIG: free tokens on signup (0 = none)
begin
  insert into public.token_balances (user_id, tokens) values (new.id, v_welcome)
  on conflict (user_id) do nothing;
  if v_welcome > 0 then
    insert into public.token_ledger (user_id, delta, reason, ref) values (new.id, v_welcome, 'welcome', null);
  end if;
  return new;
end;
$$;
