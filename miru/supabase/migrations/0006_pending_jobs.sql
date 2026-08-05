-- Phase 5 follow-up — make the BATCH durable, not just the submitted jobs.
--
-- 0005 persisted a job only once it had been handed to fal. The list of moments still
-- waiting to be submitted lived in the browser's scheduler loop, so closing the tab during
-- an Animate All kept the clips already in flight and silently dropped the rest — a 9-moment
-- batch came back as 3 done and 6 forgotten.
--
-- A job row is now created for EVERY intended clip up front, in 'pending' state: no fal
-- request, no tokens spent. The client scheduler promotes them a few at a time, and tokens
-- are spent only at that moment. Resuming a session means finding the leftover 'pending'
-- rows and carrying on.
--
-- This deliberately does NOT submit everything up front. Spending tokens for nine clips the
-- moment the button is pressed is the abandonment problem the small window exists to avoid.
--
-- Apply with: supabase db push (or paste into the Supabase SQL editor). Safe to re-run.

-- A pending job has no fal request yet. NULLs don't collide under a unique index, so many
-- rows can sit unsubmitted at once.
alter table public.render_jobs alter column request_id drop not null;

-- 'pending'   — intended, not yet sent to fal, nothing charged
-- 'cancelled' — abandoned before submission, so there is nothing to refund
alter table public.render_jobs drop constraint if exists render_jobs_status_check;
alter table public.render_jobs add constraint render_jobs_status_check
  check (status in ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled'));

alter table public.render_jobs alter column status set default 'pending';
