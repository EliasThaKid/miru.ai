-- Phase 5 — async render jobs.
--
-- Today a Kling call is a blocking `fal.subscribe` inside a Server Action: the browser holds
-- an open request for 2-5 minutes, `maxDuration = 300` in page.tsx is the only thing keeping
-- the function alive, and a closed tab loses a generation the user already paid for.
--
-- Instead we submit to fal's queue, persist the `request_id`, and let the client poll. Once
-- the row exists the job survives tab close, refresh, and function timeout — the request is
-- fal's to finish, and the result is fetchable by id whenever we ask.
--
-- Job state is NOT client-writable. A user could otherwise mark their own job failed and
-- collect a refund for work that succeeded, so every write here goes through the service
-- role (see lib/render-jobs.ts); clients get read-only visibility into their own rows.
--
-- Apply with: supabase db push (or paste into the Supabase SQL editor). Safe to re-run.

create table if not exists public.render_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- Which project the job belongs to, when known. Null keeps a job usable for an
  -- unsaved/first-run project rather than blocking submission on a row existing.
  project_id    uuid references public.projects (id) on delete set null,

  kind          text not null check (kind in ('clip', 'anchored', 'bridge')),
  -- Moment id, or a 'from->to' pair key for a bridge. What the client reattaches to.
  target_id     text not null,
  endpoint      text not null,              -- fal endpoint slug; poll needs it to ask status
  request_id    text not null unique,       -- fal queue id; unique so one submit = one job

  status        text not null default 'queued'
                check (status in ('queued', 'running', 'succeeded', 'failed')),

  -- Money. Recorded at submit so a terminal failure can refund exactly what was reserved,
  -- against the same ledger ref the spend used (see refund_spend in 0004).
  tokens_spent  integer not null default 0,
  spend_ref     text not null,

  prompt        text,                       -- the prompt sent, returned as provenance
  result_url    text,                       -- signed Storage URL (or fal URL if unmirrored)
  storage_path  text,                       -- durable Storage path (Phase 4)
  -- Kind-specific payload the client needs on completion — e.g. an anchored job's
  -- endImageUrl/endImageStoragePath, which are paid assets in their own right.
  extra         jsonb not null default '{}'::jsonb,
  error         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Reattach query: this user's unfinished jobs, newest first.
create index if not exists render_jobs_user_open_idx
  on public.render_jobs (user_id, status, created_at desc);

alter table public.render_jobs enable row level security;

-- Read-only to the owner. There are deliberately NO insert/update/delete policies: job
-- state moves only through the service role, so a user cannot forge a failure (and its
-- refund) or claim someone else's result.
drop policy if exists "render_jobs_select_own" on public.render_jobs;
create policy "render_jobs_select_own" on public.render_jobs for select
  using (auth.uid() = user_id);

drop trigger if exists render_jobs_touch on public.render_jobs;
create trigger render_jobs_touch before update on public.render_jobs
  for each row execute function public.touch_updated_at();
