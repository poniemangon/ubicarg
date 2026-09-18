-- Run this manually in the Supabase SQL editor (ubicarg project).
--
-- Fixes is_admin_user(): it originally checked "does this session have a
-- real Supabase Auth account" (exists (select 1 from auth.users where id =
-- auth.uid())), which worked for UbicaBA back when only admins used native
-- Supabase Auth and players signed in through Clerk. ubicarg's client never
-- uses Clerk — every player AND every admin signs in through Supabase Auth
-- (Google OAuth / email+password) — so that check now passes for anyone
-- signed in, not just admins. This adds an explicit flag and checks that
-- instead.

alter table profiles add column is_admin boolean not null default false;

create or replace function is_admin_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from profiles where clerk_user_id = auth.uid()::text), false)
$$;

-- After running this, promote your own account once you've signed up as a
-- normal player (Google or email):
--   update profiles set is_admin = true where username = '<your username>';
