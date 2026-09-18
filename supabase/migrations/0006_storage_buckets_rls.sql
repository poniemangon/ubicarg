-- Run this manually in the Supabase SQL editor (ubicarg project).
--
-- The `admin-uploads` and `localidad-images` storage buckets were created
-- via the Storage API (public: true, so reads work with no policy needed —
-- public buckets serve GETs through a fast path that bypasses RLS). Writes
-- (upload/update/remove) still go through storage.objects' own RLS
-- regardless of the bucket's public flag, and ship with zero policies by
-- default — admin-only, same pattern as every other admin-gated table.

create policy "admins can manage admin-uploads"
  on storage.objects for all
  using (bucket_id = 'admin-uploads' and public.is_admin_user())
  with check (bucket_id = 'admin-uploads' and public.is_admin_user());

create policy "admins can manage localidad-images"
  on storage.objects for all
  using (bucket_id = 'localidad-images' and public.is_admin_user())
  with check (bucket_id = 'localidad-images' and public.is_admin_user());
