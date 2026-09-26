-- Run this manually in the Supabase SQL editor.
--
-- Diagnostic + fix, take 2 (see 0034_fix_analytics_rls.sql — same exact
-- symptom recurred: "new row violates row-level security policy for table
-- analytics_sessions", 42501, on a plain insert of a brand-new session id
-- that should trivially pass a `with check (true)` policy). Whatever's
-- actually live on the table has drifted from what 0031/0034 intended —
-- same kind of drift this project has hit before with barrios/intersections
-- and is_admin_user().
--
-- Likely knock-on effect: analytics_pageviews.session_id has a not-null FK
-- into analytics_sessions.id — if the session row never got inserted, every
-- pageview insert for that visitor fails too (23503, "Key is not present in
-- table analytics_sessions" — also visible in the console). A visitor whose
-- heartbeat 401s essentially never gets counted as a "visit" at all, even
-- though they can still fully play (daily_stats doesn't depend on this
-- table) — which is exactly the mismatch reported: more daily maps
-- completed some days than unique visits logged.
--
-- Run the diagnostic SELECT first to see what's actually there:
--
--   select policyname, cmd, permissive, roles, qual, with_check
--   from pg_policies
--   where tablename = 'analytics_sessions';
--
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_name = 'analytics_sessions';
--
-- Then run the fix below — drop-if-exists + recreate guarantees the correct
-- policies regardless of whatever history led to this, and explicit GRANTs
-- rule out a plain privilege issue masquerading as an RLS error.

drop policy if exists "anyone can heartbeat a session" on analytics_sessions;
drop policy if exists "anyone can update their own session's heartbeat" on analytics_sessions;
drop policy if exists "admins can read sessions" on analytics_sessions;

create policy "anyone can heartbeat a session"
  on analytics_sessions for insert
  with check (true);

create policy "anyone can update their own session's heartbeat"
  on analytics_sessions for update
  using (true)
  with check (true);

create policy "admins can read sessions"
  on analytics_sessions for select
  using (is_admin_user());

grant select, insert, update on analytics_sessions to anon, authenticated;
grant select, insert on analytics_pageviews to anon, authenticated;
