-- Phase 4 — durable asset storage.
--
-- fal's CDN URLs are provider-owned and temporary: a project whose moments point at
-- cdn.fal.media rots the moment those URLs expire. Every paid output (stills and clips) is
-- therefore mirrored into a PRIVATE Supabase Storage bucket, and the project stores the
-- durable object PATH. Display URLs are short-lived signed URLs re-minted on every load, so
-- nothing persisted can go stale.
--
-- Layout: assets/<user-id>/<kind>/<key>-<nonce>.<ext>  — the first path segment is the owner,
-- which is what every policy below keys off.
--
-- Apply with: supabase db push  (or paste into the Supabase SQL editor).

insert into storage.buckets (id, name, public, file_size_limit)
values ('assets', 'assets', false, 104857600)   -- 100 MB: a 10s Kling clip is far under this
on conflict (id) do update set public = false, file_size_limit = 104857600;

-- Owner-scoped access. The bucket is private, so there is no anonymous read path: the only
-- way to view an object is a signed URL, which can only be minted by someone who passes the
-- SELECT policy below (the owner) or by the service role.
drop policy if exists "assets_select_own" on storage.objects;
create policy "assets_select_own" on storage.objects for select
  to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "assets_insert_own" on storage.objects;
create policy "assets_insert_own" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);

-- Update is needed for upsert; delete lets a user clear their own assets. Both stay scoped to
-- the owner's folder, so one user can never touch another's paid output.
drop policy if exists "assets_update_own" on storage.objects;
create policy "assets_update_own" on storage.objects for update
  to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "assets_delete_own" on storage.objects;
create policy "assets_delete_own" on storage.objects for delete
  to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);
