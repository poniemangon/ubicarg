-- UbicaRG — consolidated base schema, adapted from UbicaBA's 73 migrations
-- (supabase/migrations/0001..0073 in the baires-geoguess repo), squashed into
-- one initial migration for a brand-new Supabase project.
--
-- What changed vs. UbicaBA:
--   barrios        -> provincias    (barrio_id -> provincia_id)
--   intersections  -> localidades   (street1 + street2 -> a single `nombre`;
--                                    barrio_id -> provincia_id)
--   duels.barrio_ids -> duels.provincia_ids
--   every other table/function/policy is functionally identical to UbicaBA.
--
-- This is STRUCTURE ONLY:
--   - `provincias` and `localidades` are created empty — no rows. Load the
--     real Argentina provinces/localities data separately.
--   - Everything else (profiles, duels, groups, logros, ghost mode, etc.) is
--     seeded with the same small amount of functional data UbicaBA ships
--     with (default app_settings, the logros catalog, the ghost-mode bot
--     pool, the 'unlogged' referral placeholder) — see the SEED DATA section
--     at the bottom. None of it is Buenos-Aires-specific.
--
-- Auth: native Supabase Auth (Google OAuth + email/password) for everyone —
-- UbicaBA moved off Clerk at some point after these migrations were
-- written, and ubicarg's client (already cloned from the current codebase)
-- reflects that: no Clerk app or Third-Party Auth provider needed. Enable
-- the Email and Google providers on this Supabase project (Dashboard >
-- Authentication > Providers), and set the Site URL / Redirect URLs
-- (Dashboard > Authentication > URL Configuration) to wherever the app
-- runs (http://localhost:5180 for local dev, plus the real domain later).
--
-- Admins are just profiles with is_admin = true — sign up as a normal
-- player (Google or email), then flip it yourself once:
--   update profiles set is_admin = true where username = '<you>';
--
-- Run this whole file once, in order, in the Supabase SQL editor.

-- ===========================================================================
-- Auth helpers (no table dependencies — safe to define first)
-- ===========================================================================

create or replace function requesting_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt()->>'sub', '')
$$;

-- ===========================================================================
-- profiles
-- ===========================================================================
-- clerk_user_id holds the signed-in Supabase Auth user's own id (as text) —
-- named after UbicaBA's original Clerk-based auth for schema parity, but
-- ubicarg never uses Clerk: every player AND every admin signs in through
-- native Supabase Auth (Google OAuth / email+password), so this column and
-- requesting_user_id() (which reads the JWT's 'sub' claim — the same claim
-- name Supabase's own JWTs use) work unchanged either way.

create table profiles (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  username text unique not null,
  avatar_url text,
  avatar_is_custom boolean not null default false,
  elo int not null default 1000,
  ranked_games_played int not null default 0,
  is_referred boolean not null default false,
  is_banned boolean not null default false,
  is_admin boolean not null default false,
  ghost_mode boolean not null default false,
  is_bot boolean not null default false,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Because every signed-in user (player or admin) now has a real Supabase
-- Auth account, "has an auth.users row" (UbicaBA's original check, back
-- when only admins used native Supabase Auth and players used Clerk) can no
-- longer tell them apart — this checks the explicit is_admin flag instead.
-- Promote an account with: update profiles set is_admin = true where
-- username = '<you>'; (run once, manually, in the SQL editor).
create or replace function is_admin_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from profiles where clerk_user_id = auth.uid()::text), false)
$$;

create policy "profiles are viewable by everyone"
  on profiles for select
  using (true);

create policy "users can insert their own profile"
  on profiles for insert
  with check (clerk_user_id = requesting_user_id());

create policy "users can update their own profile"
  on profiles for update
  using (clerk_user_id = requesting_user_id());

create policy "admins can update any profile"
  on profiles for update
  using (is_admin_user())
  with check (is_admin_user());

-- ===========================================================================
-- friendships
-- ===========================================================================

create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index friendships_requester_idx on friendships (requester_id);
create index friendships_addressee_idx on friendships (addressee_id);

alter table friendships enable row level security;

create policy "participants can view their friendships"
  on friendships for select
  using (
    exists (
      select 1 from profiles p
      where p.clerk_user_id = requesting_user_id()
        and p.id in (friendships.requester_id, friendships.addressee_id)
    )
  );

create policy "users can send friend requests"
  on friendships for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = friendships.requester_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "participants can update their friendships"
  on friendships for update
  using (
    exists (
      select 1 from profiles p
      where p.clerk_user_id = requesting_user_id()
        and p.id in (friendships.requester_id, friendships.addressee_id)
    )
  );

-- ===========================================================================
-- provincias (was: barrios) — map data, structure only, no rows
-- ===========================================================================

-- `comuna` is kept for structural parity with UbicaBA's barrios table, where
-- comuna = 0 flags a pseudo-barrio holding admin-added "special" locations
-- (see App.jsx's eligibleBarrioIdsShuffled/isAllSpecialSelection) — reuse or
-- repurpose it as ubicarg needs.
create table provincias (
  provincia_id int primary key,
  nombre text not null,
  comuna int not null
);

alter table provincias enable row level security;

create policy "provincias are viewable by everyone"
  on provincias for select
  using (true);

create policy "admins can manage provincias"
  on provincias for all
  using (is_admin_user())
  with check (is_admin_user());

-- ===========================================================================
-- localidades (was: intersections) — map data, structure only, no rows
-- ===========================================================================

-- UbicaBA's intersections are a pair of streets (street1 + street2); a
-- locality is a single place, so that collapses into one `nombre` column.
-- pool_index is the same kind of key as UbicaBA's: a plain integer matching
-- the position of this row in the client's loaded pool (round_indices on
-- duels/daily_stats stores these, not localidades.provincia_id), not an
-- auto-generated id — assign it explicitly when you load the real data.
create table localidades (
  pool_index int primary key,
  nombre text not null,
  provincia_id int not null references provincias(provincia_id),
  lat double precision not null,
  lng double precision not null,
  image_url text
);

alter table localidades enable row level security;

create policy "localidades are viewable by everyone"
  on localidades for select
  using (true);

create policy "admins can manage localidades"
  on localidades for all
  using (is_admin_user())
  with check (is_admin_user());

-- ===========================================================================
-- groups
-- ===========================================================================

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text,
  created_by uuid not null references profiles(id) on delete cascade,
  invite_id text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table user_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (user_id, group_id)
);

create index user_groups_group_idx on user_groups (group_id);
create index user_groups_user_idx on user_groups (user_id);

alter table groups enable row level security;
alter table user_groups enable row level security;

create policy "groups are viewable by everyone"
  on groups for select
  using (true);

create policy "user_groups are viewable by everyone"
  on user_groups for select
  using (true);

create policy "users can create a group"
  on groups for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = groups.created_by
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "group creator can update the group"
  on groups for update
  using (
    exists (
      select 1 from profiles p
      where p.id = groups.created_by
        and p.clerk_user_id = requesting_user_id()
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = groups.created_by
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "users can join a group"
  on user_groups for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = user_groups.user_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "users can leave a group"
  on user_groups for delete
  using (
    exists (
      select 1 from profiles p
      where p.id = user_groups.user_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

-- ===========================================================================
-- duels
-- ===========================================================================
-- No status column: pending / one-side-played / completed is derived from
-- how many duel_results rows exist for a given duel.

create table duels (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  challenger_id uuid not null references profiles(id) on delete cascade,
  opponent_id uuid references profiles(id) on delete cascade,
  round_indices int[] not null,
  provincia_ids int[],
  is_multiplayer boolean not null default false,
  max_players int,
  winner_id uuid references profiles(id),
  closed_at timestamptz,
  matchmaking boolean not null default false,
  time_limit_seconds int default 8,
  group_duel uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint duels_multiplayer_max_players_check
    check (not is_multiplayer or max_players is null or max_players >= 2)
);

create index duels_challenger_idx on duels (challenger_id);
create index duels_opponent_idx on duels (opponent_id);

alter table duels enable row level security;

-- ===========================================================================
-- duel_results — created here (ahead of duels' own policies) because the
-- "close a duel" / "delete an unresponded duel" policies below need
-- duel_results_count()/duel_results_has_profile(), which need this table to
-- already exist.
-- ===========================================================================

create table duel_results (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references duels(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  results jsonb not null,
  total_score int not null,
  previous_elo int,
  new_elo int,
  elo_reverted boolean not null default false,
  completed_at timestamptz not null default now(),
  unique (duel_id, profile_id)
);

create index duel_results_duel_idx on duel_results (duel_id);

alter table duel_results enable row level security;

-- security-definer helpers that read duel_results without its own RLS
-- (breaks the duels <-> duel_results RLS recursion cycle).
create or replace function duel_results_count(target_duel_id uuid)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*) from duel_results where duel_id = target_duel_id
$$;

create or replace function duel_results_has_profile(target_duel_id uuid, target_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from duel_results
    where duel_id = target_duel_id
      and profile_id = target_profile_id
  )
$$;

-- ===========================================================================
-- duels policies
-- ===========================================================================

create policy "participants or unclaimed invites are viewable"
  on duels for select
  using (
    opponent_id is null
    or exists (
      select 1 from profiles p
      where p.clerk_user_id = requesting_user_id()
        and p.id in (duels.challenger_id, duels.opponent_id)
    )
  );

create policy "admins can view all duels"
  on duels for select
  using (is_admin_user());

-- Creating a group duel requires being a member of the target group.
create policy "users can create duels as challenger"
  on duels for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = duels.challenger_id
        and p.clerk_user_id = requesting_user_id()
    )
    and (
      duels.group_duel is null
      or exists (
        select 1 from user_groups ug
        join profiles p2 on p2.id = ug.user_id
        where ug.group_id = duels.group_duel
          and p2.clerk_user_id = requesting_user_id()
      )
    )
  );

create policy "users can claim an unclaimed 1v1 duel invite"
  on duels for update
  using (opponent_id is null and not is_multiplayer)
  with check (
    exists (
      select 1 from profiles p
      where p.id = opponent_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

-- Closing a duel (closed_at null -> not null, winner_id set alongside it) is
-- allowed for:
--  (a) 1v1: either participant, once both have a duel_results row
--  (b) multiplayer: only the challenger (creator), once >=2 people have played
-- Group duels (group_duel is not null) are excluded — those only close via
-- close_group_duel_if_complete()/try_close_group_duel(), which are SECURITY
-- DEFINER and bypass RLS entirely.
create policy "duel participants can close it and set the winner"
  on duels for update
  using (closed_at is null)
  with check (
    closed_at is not null
    and group_duel is null
    and (
      (
        not is_multiplayer
        and duel_results_count(duels.id) >= 2
        and exists (
          select 1 from profiles p
          where p.clerk_user_id = requesting_user_id()
            and p.id in (duels.challenger_id, duels.opponent_id)
        )
      )
      or (
        is_multiplayer
        and duel_results_count(duels.id) >= 2
        and exists (
          select 1 from profiles p
          where p.clerk_user_id = requesting_user_id()
            and p.id = duels.challenger_id
        )
      )
    )
  );

create policy "challenger can cancel their own unclaimed matchmaking duel"
  on duels for delete
  using (
    matchmaking
    and opponent_id is null
    and closed_at is null
    and exists (
      select 1 from profiles p
      where p.clerk_user_id = requesting_user_id()
        and p.id = duels.challenger_id
    )
  );

create policy "closer can delete a private duel nobody else responded to"
  on duels for delete
  using (
    not matchmaking
    and closed_at is null
    and (
      exists (select 1 from profiles p where p.clerk_user_id = requesting_user_id() and p.id = duels.challenger_id)
      or exists (select 1 from profiles p where p.clerk_user_id = requesting_user_id() and p.id = duels.opponent_id)
    )
    and duel_results_count(duels.id) <= 1
  );

create policy "group admin can delete a group duel"
  on duels for delete
  using (
    group_duel is not null
    and exists (
      select 1 from groups g
      join profiles p on p.id = g.created_by
      where g.id = duels.group_duel
        and p.clerk_user_id = requesting_user_id()
    )
  );

-- ===========================================================================
-- duel_results policies (table itself created earlier, alongside duels)
-- ===========================================================================

create policy "duel results are viewable by multiplayer joiners or 1v1 participants"
  on duel_results for select
  using (
    exists (select 1 from duels d where d.id = duel_results.duel_id and d.is_multiplayer)
    or exists (
      select 1 from duels d
      join profiles p on p.clerk_user_id = requesting_user_id()
      where d.id = duel_results.duel_id
        and p.id in (d.challenger_id, d.opponent_id)
    )
  );

create policy "admins can view all duel results"
  on duel_results for select
  using (is_admin_user());

create policy "users can submit their own duel result"
  on duel_results for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = duel_results.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
    and (
      exists (
        select 1 from duels d
        where d.id = duel_results.duel_id
          and d.is_multiplayer
          and d.closed_at is null
          and (
            d.group_duel is null
            or exists (
              select 1 from user_groups ug
              where ug.group_id = d.group_duel
                and ug.user_id = duel_results.profile_id
            )
          )
      )
      or exists (
        select 1 from duels d
        where d.id = duel_results.duel_id
          and not d.is_multiplayer
          and d.closed_at is null
          and (d.challenger_id = duel_results.profile_id or d.opponent_id = duel_results.profile_id)
      )
    )
  );

create policy "users can update their own duel result"
  on duel_results for update
  using (
    exists (
      select 1 from profiles p
      where p.id = duel_results.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = duel_results.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

-- ===========================================================================
-- duel_results insert-cap trigger
-- ===========================================================================

-- Enforces the multiplayer max_players cap in a plain trigger instead of a
-- self-referential RLS subquery (which recurses — see UbicaBA's 0049).
create or replace function enforce_duel_max_players()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int;
  current_count int;
begin
  select max_players into cap from duels where id = new.duel_id;
  if cap is null then
    return new;
  end if;

  select count(*) into current_count from duel_results where duel_id = new.duel_id;
  if current_count >= cap then
    raise exception 'This duel is already full';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_duel_max_players_trigger on duel_results;
create trigger enforce_duel_max_players_trigger
  before insert on duel_results
  for each row
  execute function enforce_duel_max_players();

-- ===========================================================================
-- notifications
-- ===========================================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('duel_completed', 'friend_request', 'duel_matched', 'logro_earned')),
  duel_id uuid references duels(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_idx on notifications (profile_id, created_at desc);

alter table notifications enable row level security;

create policy "users can view their own notifications"
  on notifications for select
  using (
    exists (
      select 1 from profiles p
      where p.id = notifications.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "users can mark their own notifications read"
  on notifications for update
  using (
    exists (
      select 1 from profiles p
      where p.id = notifications.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = notifications.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "users can delete their own notifications"
  on notifications for delete
  using (
    exists (
      select 1 from profiles p
      where p.id = notifications.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "requester can notify the addressee of a friend request"
  on notifications for insert
  with check (
    type = 'friend_request'
    and exists (
      select 1 from friendships f
      join profiles p on p.clerk_user_id = requesting_user_id()
      where f.requester_id = p.id
        and f.addressee_id = notifications.profile_id
        and f.status = 'pending'
    )
  );

create policy "closer can notify duel participants that it completed"
  on notifications for insert
  with check (
    type = 'duel_completed'
    and exists (
      select 1 from duels d
      join profiles requester on requester.clerk_user_id = requesting_user_id()
      join duel_results dr_requester on dr_requester.duel_id = d.id and dr_requester.profile_id = requester.id
      join duel_results dr_target on dr_target.duel_id = d.id and dr_target.profile_id = notifications.profile_id
      where d.id = notifications.duel_id
        and d.closed_at is not null
    )
  );

create policy "opponent can notify the challenger a duel was matched"
  on notifications for insert
  with check (
    type = 'duel_matched'
    and exists (
      select 1 from duels d
      join profiles requester on requester.clerk_user_id = requesting_user_id()
      where d.id = notifications.duel_id
        and d.opponent_id = requester.id
        and d.challenger_id = notifications.profile_id
        and not d.is_multiplayer
    )
  );

alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table duels;
alter publication supabase_realtime add table duel_results;

-- ===========================================================================
-- daily_stats ("Mapa del día")
-- ===========================================================================

create table daily_stats (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  day_number int not null,
  results jsonb,
  total_score int not null,
  timed boolean not null default false,
  completed_at timestamptz not null default now(),
  constraint daily_stats_profile_id_day_number_timed_key unique (profile_id, day_number, timed),
  constraint daily_stats_guest_no_results check (profile_id is not null or results is null)
);

create index daily_stats_profile_idx on daily_stats (profile_id, day_number desc);

alter table daily_stats enable row level security;

create policy "daily stats are viewable by everyone"
  on daily_stats for select
  using (true);

create policy "users can save their own daily stats"
  on daily_stats for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = daily_stats.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "guests can save an anonymous daily attempt"
  on daily_stats for insert
  with check (profile_id is null and results is null);

create policy "users can update their own daily stats"
  on daily_stats for update
  using (
    exists (
      select 1 from profiles p
      where p.id = daily_stats.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

-- ===========================================================================
-- daily_wins / daily_group_wins
-- ===========================================================================
-- day_number must match the client's dayNumberForDate(): EPOCH_UTC =
-- 2024-01-01T00:00:00Z (or whatever epoch ubicarg's client uses),
-- day_number = floor((utcMidnight(date) - EPOCH_UTC) / 86400000).

create table daily_wins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  day_number int not null,
  daily_stat_id uuid not null references daily_stats(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint daily_wins_day_number_profile_id_key unique (day_number, profile_id)
);

create index daily_wins_profile_idx on daily_wins (profile_id);

alter table daily_wins enable row level security;

create policy "daily wins are viewable by everyone"
  on daily_wins for select
  using (true);

-- No insert/update/delete policy for anon/authenticated on purpose — the
-- only writer is award_daily_win() below, SECURITY DEFINER so it bypasses
-- RLS regardless. Nobody should ever award themselves a win.

create table daily_group_wins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  day_number int not null,
  daily_stat_id uuid not null references daily_stats(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint daily_group_wins_group_id_day_number_profile_id_key unique (group_id, day_number, profile_id)
);

create index daily_group_wins_group_idx on daily_group_wins (group_id);
create index daily_group_wins_profile_idx on daily_group_wins (profile_id);

alter table daily_group_wins enable row level security;

create policy "daily group wins are viewable by everyone"
  on daily_group_wins for select
  using (true);

-- ===========================================================================
-- app_settings
-- ===========================================================================

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

create policy "settings are viewable by everyone"
  on app_settings for select
  using (true);

create policy "admins can update settings"
  on app_settings for update
  using (is_admin_user())
  with check (is_admin_user());

-- ===========================================================================
-- distintivos (admin-granted badges)
-- ===========================================================================

create table distintivos (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references profiles(id) on delete cascade,
  image_url text not null,
  title text not null,
  text text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index distintivos_user_idx on distintivos (user_uuid);

alter table distintivos enable row level security;

create policy "active badges are viewable by everyone"
  on distintivos for select
  using (is_active);

create policy "admins can manage badges"
  on distintivos for all
  using (is_admin_user())
  with check (is_admin_user());

-- ===========================================================================
-- logros (automated achievements) + logros_jugadores (earned pivot)
-- ===========================================================================

create table logros (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  text text,
  image_url text,
  metric_type text not null check (
    metric_type in ('daily_maps_completed', 'daily_wins', 'duels_won', 'duels_played', 'elo_top_rank')
  ),
  threshold int not null check (threshold > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table logros_jugadores (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  logro_id uuid not null references logros(id) on delete cascade,
  earned_at timestamptz not null default now(),
  unique (profile_id, logro_id)
);

create index logros_jugadores_profile_idx on logros_jugadores (profile_id);

alter table logros enable row level security;
alter table logros_jugadores enable row level security;

create policy "active logros are viewable by everyone"
  on logros for select
  using (is_active);

create policy "admins can manage logros"
  on logros for all
  using (is_admin_user())
  with check (is_admin_user());

create policy "logros_jugadores are viewable by everyone"
  on logros_jugadores for select
  using (true);

-- No insert/update/delete policy for anon/authenticated on purpose — the
-- only writer is check_and_grant_achievements() below, SECURITY DEFINER.

-- ===========================================================================
-- analytics
-- ===========================================================================

create table analytics_sessions (
  id uuid primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table analytics_pageviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references analytics_sessions(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

create index analytics_pageviews_session_idx on analytics_pageviews (session_id);
create index analytics_pageviews_created_idx on analytics_pageviews (created_at);
create index analytics_pageviews_path_idx on analytics_pageviews (path);

alter table analytics_sessions enable row level security;
alter table analytics_pageviews enable row level security;

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

create policy "anyone can log a pageview"
  on analytics_pageviews for insert
  with check (true);

create policy "admins can read pageviews"
  on analytics_pageviews for select
  using (is_admin_user());

-- ===========================================================================
-- referrals
-- ===========================================================================

create table referrals (
  user_id uuid primary key references profiles(id) on delete cascade,
  visit_count int not null default 0
);

alter table referrals enable row level security;

create policy "admins can read referrals"
  on referrals for select
  using (is_admin_user());

-- ===========================================================================
-- comments (player-submitted feedback about a specific localidad)
-- ===========================================================================

create table comments (
  id uuid primary key default gen_random_uuid(),
  pool_index int references localidades(pool_index) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);

create index comments_pool_index_idx on comments (pool_index);
create index comments_profile_idx on comments (profile_id);
create index comments_created_idx on comments (created_at);

alter table comments enable row level security;

create policy "users can add their own comment"
  on comments for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = comments.profile_id
        and p.clerk_user_id = requesting_user_id()
    )
  );

create policy "admins can read comments"
  on comments for select
  using (is_admin_user());

create policy "admins can mark comments as seen"
  on comments for update
  using (is_admin_user())
  with check (is_admin_user());

-- ===========================================================================
-- daily_popups
-- ===========================================================================

create table daily_popups (
  id uuid primary key default gen_random_uuid(),
  image_url_desktop text not null,
  image_url_mobile text not null,
  link_url text not null,
  active boolean not null default false,
  click_count int not null default 0,
  created_at timestamptz not null default now()
);

-- Enforces "at most one active popup" at the DB level.
create unique index daily_popups_single_active on daily_popups (active) where active;

alter table daily_popups enable row level security;

create policy "daily popups are viewable by everyone"
  on daily_popups for select
  using (true);

create policy "admins can manage daily popups"
  on daily_popups for all
  using (is_admin_user())
  with check (is_admin_user());

-- ===========================================================================
-- ghost_activity_log
-- ===========================================================================

create table ghost_activity_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index ghost_activity_log_profile_idx on ghost_activity_log (profile_id);

alter table ghost_activity_log enable row level security;

create policy "admins can read ghost activity"
  on ghost_activity_log for select
  using (is_admin_user());

-- No insert/update/delete policy for anon/authenticated on purpose — the
-- only writer is log_ghost_activity() below, SECURITY DEFINER.

-- ===========================================================================
-- ELO
-- ===========================================================================
-- Rating update happens server-side via a trigger: the player closing their
-- own duel is the one whose UPDATE on `duels` fires this, but the
-- *opponent's* profiles row also needs to change, and "users can update
-- their own profile" only lets a session touch its own row.

create or replace function apply_duel_elo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k constant int := 32;
  challenger_elo int;
  opponent_elo int;
  expected_challenger numeric;
  expected_opponent numeric;
  score_challenger numeric;
  score_opponent numeric;
  new_challenger_elo int;
  new_opponent_elo int;
begin
  if new.closed_at is not null
     and old.closed_at is null
     and not new.is_multiplayer
     and new.matchmaking
     and new.opponent_id is not null then

    select elo into challenger_elo from profiles where id = new.challenger_id;
    select elo into opponent_elo from profiles where id = new.opponent_id;

    expected_challenger := 1.0 / (1 + power(10, (opponent_elo - challenger_elo) / 400.0));
    expected_opponent := 1.0 / (1 + power(10, (challenger_elo - opponent_elo) / 400.0));

    if new.winner_id = new.challenger_id then
      score_challenger := 1;
      score_opponent := 0;
    elsif new.winner_id = new.opponent_id then
      score_challenger := 0;
      score_opponent := 1;
    else
      score_challenger := 0.5;
      score_opponent := 0.5;
    end if;

    new_challenger_elo := greatest(0, round(challenger_elo + k * (score_challenger - expected_challenger)));
    new_opponent_elo := greatest(0, round(opponent_elo + k * (score_opponent - expected_opponent)));

    update profiles
      set elo = new_challenger_elo, ranked_games_played = ranked_games_played + 1
      where id = new.challenger_id;
    update profiles
      set elo = new_opponent_elo, ranked_games_played = ranked_games_played + 1
      where id = new.opponent_id;

    -- No-op if the corresponding side never submitted a result (forfeit) —
    -- there's no duel_results row to attach the snapshot to in that case.
    update duel_results
      set previous_elo = challenger_elo, new_elo = new_challenger_elo
      where duel_id = new.id and profile_id = new.challenger_id;
    update duel_results
      set previous_elo = opponent_elo, new_elo = new_opponent_elo
      where duel_id = new.id and profile_id = new.opponent_id;
  end if;

  return new;
end;
$$;

drop trigger if exists duel_elo_trigger on duels;
create trigger duel_elo_trigger
  after update on duels
  for each row
  execute function apply_duel_elo();

-- ===========================================================================
-- Achievements ("logros")
-- ===========================================================================

create or replace function check_and_grant_achievements(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  daily_maps_count int;
  daily_wins_count int;
  duels_won_count int;
  duels_played_count int;
  my_elo int;
  my_ranked_games int;
  my_elo_rank int;
  granted record;
begin
  select count(distinct day_number) into daily_maps_count
  from daily_stats
  where profile_id = target_profile_id;

  select count(*) into daily_wins_count
  from daily_wins
  where profile_id = target_profile_id;

  select count(*) into duels_won_count
  from duels
  where winner_id = target_profile_id and closed_at is not null;

  select count(distinct dr.duel_id) into duels_played_count
  from duel_results dr
  join duels d on d.id = dr.duel_id
  where dr.profile_id = target_profile_id and d.closed_at is not null;

  select elo, ranked_games_played into my_elo, my_ranked_games
  from profiles
  where id = target_profile_id;

  if my_ranked_games > 0 then
    select count(*) + 1 into my_elo_rank
    from profiles p2
    where p2.ranked_games_played > 0 and p2.elo > my_elo;
  else
    my_elo_rank := null;
  end if;

  for granted in
    with ins as (
      insert into logros_jugadores (profile_id, logro_id)
      select target_profile_id, l.id
      from logros l
      where l.is_active
        and (
          (l.metric_type = 'daily_maps_completed' and daily_maps_count >= l.threshold)
          or (l.metric_type = 'daily_wins' and daily_wins_count >= l.threshold)
          or (l.metric_type = 'duels_won' and duels_won_count >= l.threshold)
          or (l.metric_type = 'duels_played' and duels_played_count >= l.threshold)
          or (l.metric_type = 'elo_top_rank' and my_elo_rank is not null and my_elo_rank <= l.threshold)
        )
      on conflict (profile_id, logro_id) do nothing
      returning logro_id
    )
    select ins.logro_id, l.title, l.text, l.image_url
    from ins
    join logros l on l.id = ins.logro_id
  loop
    insert into notifications (profile_id, type, data)
    values (
      target_profile_id,
      'logro_earned',
      jsonb_build_object('logro_id', granted.logro_id, 'title', granted.title, 'text', granted.text, 'image_url', granted.image_url)
    );
  end loop;
exception
  when others then
    -- Achievements must never block the gameplay write that triggered this
    -- check (a duel closing, a daily map save, an elo update) — worst case a
    -- logro doesn't get granted this one time, it'll catch up next check.
    raise warning 'check_and_grant_achievements failed for profile %: %', target_profile_id, sqlerrm;
end;
$$;

create or replace function check_daily_stats_achievements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_and_grant_achievements(new.profile_id);
  return new;
end;
$$;

drop trigger if exists daily_stats_achievements_trigger on daily_stats;
create trigger daily_stats_achievements_trigger
  after insert on daily_stats
  for each row
  execute function check_daily_stats_achievements();

create or replace function check_daily_wins_achievements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_and_grant_achievements(new.profile_id);
  return new;
end;
$$;

drop trigger if exists daily_wins_achievements_trigger on daily_wins;
create trigger daily_wins_achievements_trigger
  after insert on daily_wins
  for each row
  execute function check_daily_wins_achievements();

create or replace function check_duel_achievements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  participant record;
begin
  if new.closed_at is not null and old.closed_at is null then
    for participant in
      select distinct profile_id from duel_results where duel_id = new.id
    loop
      perform check_and_grant_achievements(participant.profile_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists duel_achievements_trigger on duels;
create trigger duel_achievements_trigger
  after update on duels
  for each row
  execute function check_duel_achievements();

create or replace function check_elo_achievements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.elo is distinct from old.elo then
    perform check_and_grant_achievements(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists profile_elo_achievements_trigger on profiles;
create trigger profile_elo_achievements_trigger
  after update on profiles
  for each row
  execute function check_elo_achievements();

-- One-off utility: `select backfill_achievements();` retroactively grants
-- (and notifies) every existing user for logros they already qualify for.
create or replace function backfill_achievements()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  for p in select id from profiles loop
    perform check_and_grant_achievements(p.id);
  end loop;
end;
$$;

-- ===========================================================================
-- Group duels: auto-close + admin controls
-- ===========================================================================

-- Auto-closes a group duel once every current member of its group has a
-- duel_results row — top score wins, a tie for first leaves winner_id null.
create or replace function try_close_group_duel(target_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_duel record;
  member_count int;
  result_count int;
  top_score int;
  tie_count int;
  winner uuid;
begin
  select * into target_duel from duels where id = target_duel_id;
  if target_duel.group_duel is null or target_duel.closed_at is not null then
    return;
  end if;

  select count(*) into member_count from user_groups where group_id = target_duel.group_duel;
  select count(distinct profile_id) into result_count from duel_results where duel_id = target_duel.id;
  if result_count < member_count then
    return;
  end if;

  select max(total_score) into top_score from duel_results where duel_id = target_duel.id;
  select count(*) into tie_count from duel_results where duel_id = target_duel.id and total_score = top_score;

  if tie_count = 1 then
    select profile_id into winner from duel_results where duel_id = target_duel.id and total_score = top_score;
  else
    winner := null;
  end if;

  update duels set closed_at = now(), winner_id = winner where id = target_duel.id;
end;
$$;

create or replace function close_group_duel_if_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform try_close_group_duel(new.duel_id);
  return new;
end;
$$;

drop trigger if exists close_group_duel_trigger on duel_results;
create trigger close_group_duel_trigger
  after insert on duel_results
  for each row
  execute function close_group_duel_if_complete();

-- Leaving a group can close one of its active duels right then. Give the
-- leaving member an explicit 0-score duel_results row first (on conflict do
-- nothing — never overwrites a real submitted score) so they still count
-- toward the duel's outcome even though their membership row is already gone
-- by the time try_close_group_duel counts members.
create or replace function close_group_duels_on_member_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
begin
  for d in select id from duels where group_duel = old.group_id and closed_at is null loop
    insert into duel_results (duel_id, profile_id, results, total_score)
    values (d.id, old.user_id, '[]'::jsonb, 0)
    on conflict (duel_id, profile_id) do nothing;

    perform try_close_group_duel(d.id);
  end loop;
  return old;
end;
$$;

drop trigger if exists close_group_duels_on_leave_trigger on user_groups;
create trigger close_group_duels_on_leave_trigger
  after delete on user_groups
  for each row
  execute function close_group_duels_on_member_leave();

-- Admin succession: if the group's creator leaves, hand created_by to
-- whoever's been in the group longest among those who remain.
create or replace function reassign_group_admin_on_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_admin uuid;
begin
  if old.user_id is distinct from (select created_by from groups where id = old.group_id) then
    return old;
  end if;

  select user_id into next_admin
  from user_groups
  where group_id = old.group_id
  order by joined_at asc
  limit 1;

  if next_admin is not null then
    update groups set created_by = next_admin where id = old.group_id;
  end if;

  return old;
end;
$$;

drop trigger if exists reassign_group_admin_on_leave_trigger on user_groups;
create trigger reassign_group_admin_on_leave_trigger
  after delete on user_groups
  for each row
  execute function reassign_group_admin_on_leave();

-- Group admin (groups.created_by) can force-close their group's active duel
-- right now, picking a winner from whatever results already exist.
create or replace function admin_close_group_duel(target_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_duel record;
  top_score int;
  tie_count int;
  winner uuid;
begin
  select * into target_duel from duels where id = target_duel_id;
  if target_duel.id is null or target_duel.group_duel is null then
    raise exception 'not a group duel';
  end if;
  if target_duel.closed_at is not null then
    return;
  end if;

  if not exists (
    select 1 from groups g
    join profiles p on p.id = g.created_by
    where g.id = target_duel.group_duel
      and p.clerk_user_id = requesting_user_id()
  ) then
    raise exception 'not authorized';
  end if;

  select max(total_score) into top_score from duel_results where duel_id = target_duel.id;
  select count(*) into tie_count from duel_results where duel_id = target_duel.id and total_score = top_score;

  if tie_count = 1 then
    select profile_id into winner from duel_results where duel_id = target_duel.id and total_score = top_score;
  else
    winner := null;
  end if;

  update duels set closed_at = now(), winner_id = winner where id = target_duel.id;
end;
$$;

-- ===========================================================================
-- Stale-duel cleanup (needs pg_cron)
-- ===========================================================================

create extension if not exists pg_cron;

-- Auto-closes duels nobody ever explicitly closed: 2+ results, created more
-- than 6 hours ago. Winner is whoever has the strictly-highest total_score; a
-- tie for first leaves winner_id null. Duels with 0-1 results are left
-- untouched (nothing meaningful to declare a winner over).
create or replace function close_stale_duels()
returns void
language sql
security definer
set search_path = public
as $$
  with stale as (
    select id
    from duels
    where closed_at is null
      and created_at < now() - interval '6 hours'
      and duel_results_count(id) >= 2
  ),
  scored as (
    select
      dr.duel_id,
      dr.profile_id,
      rank() over (partition by dr.duel_id order by dr.total_score desc) as rnk,
      count(*) over (partition by dr.duel_id, dr.total_score) as tie_count
    from duel_results dr
    join stale s on s.id = dr.duel_id
  ),
  winners as (
    select duel_id, case when tie_count = 1 then profile_id else null end as winner_id
    from scored
    where rnk = 1
  )
  update duels d
  set closed_at = now(), winner_id = w.winner_id
  from winners w
  where d.id = w.duel_id;
$$;

select cron.schedule(
  'close-stale-duels',
  '0 */6 * * *',
  $$select close_stale_duels()$$
);

-- Same idea for group duels: 2+ results closes it, 0-1 results deletes the
-- duel outright (nothing meaningful to declare a winner over).
create or replace function close_stale_group_duels()
returns void
language sql
security definer
set search_path = public
as $$
  with stale as (
    select id
    from duels
    where group_duel is not null
      and closed_at is null
      and created_at < now() - interval '6 hours'
  ),
  to_close as (
    select id from stale where duel_results_count(id) >= 2
  ),
  to_delete as (
    select id from stale where duel_results_count(id) <= 1
  ),
  scored as (
    select
      dr.duel_id,
      dr.profile_id,
      rank() over (partition by dr.duel_id order by dr.total_score desc) as rnk,
      count(*) over (partition by dr.duel_id, dr.total_score) as tie_count
    from duel_results dr
    join to_close tc on tc.id = dr.duel_id
  ),
  winners as (
    select duel_id, case when tie_count = 1 then profile_id else null end as winner_id
    from scored
    where rnk = 1
  ),
  closed as (
    update duels d
    set closed_at = now(), winner_id = w.winner_id
    from winners w
    where d.id = w.duel_id
    returning d.id
  )
  delete from duels where id in (select id from to_delete);
$$;

select cron.schedule(
  'close-stale-group-duels',
  '0 */6 * * *',
  $$select close_stale_group_duels()$$
);

-- ===========================================================================
-- Daily wins (needs pg_cron) — adjust the timezone below if ubicarg isn't
-- anchored to America/Argentina/Buenos_Aires.
-- ===========================================================================

-- Awards yesterday's top competitivo (timed) daily_stats row a trophy, one
-- per profile tied for the top score. Excludes banned and ghost-mode players.
create or replace function award_daily_win()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_day int;
  top_score int;
begin
  target_day := ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1) - date '2024-01-01';

  select max(ds.total_score) into top_score
  from daily_stats ds
  join profiles p on p.id = ds.profile_id
  where ds.day_number = target_day
    and ds.timed
    and not p.is_banned
    and not p.ghost_mode;

  if top_score is null then
    return;
  end if;

  insert into daily_wins (profile_id, day_number, daily_stat_id)
  select ds.profile_id, target_day, ds.id
  from daily_stats ds
  join profiles p on p.id = ds.profile_id
  where ds.day_number = target_day
    and ds.timed
    and not p.is_banned
    and not p.ghost_mode
    and ds.total_score = top_score
  on conflict (day_number, profile_id) do nothing;
end;
$$;

select cron.schedule(
  'award-daily-win',
  '0 3 * * *',
  $$select award_daily_win()$$
);

-- Per-group version: a player only competes against their own group's
-- members. Skips groups with fewer than 2 current members.
create or replace function award_daily_group_wins()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_day int;
  g record;
  member_count int;
  top_score int;
begin
  target_day := ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1) - date '2024-01-01';

  for g in select id from groups loop
    select count(*) into member_count from user_groups where group_id = g.id;
    if member_count < 2 then
      continue;
    end if;

    select max(ds.total_score) into top_score
    from daily_stats ds
    join user_groups ug on ug.user_id = ds.profile_id and ug.group_id = g.id
    join profiles p on p.id = ds.profile_id
    where ds.day_number = target_day
      and not ds.timed
      and not p.is_banned
      and not p.ghost_mode;

    if top_score is null then
      continue;
    end if;

    insert into daily_group_wins (group_id, profile_id, day_number, daily_stat_id)
    select g.id, ds.profile_id, target_day, ds.id
    from daily_stats ds
    join user_groups ug on ug.user_id = ds.profile_id and ug.group_id = g.id
    join profiles p on p.id = ds.profile_id
    where ds.day_number = target_day
      and not ds.timed
      and not p.is_banned
      and not p.ghost_mode
      and ds.total_score = top_score
    on conflict (group_id, day_number, profile_id) do nothing;
  end loop;
end;
$$;

select cron.schedule(
  'award-daily-group-wins',
  '0 3 * * *',
  $$select award_daily_group_wins()$$
);

-- ===========================================================================
-- Admin panel RPCs
-- ===========================================================================

create or replace function daily_map_stats()
returns table(day_number int, total bigint, ranked bigint, unranked bigint, unlogged bigint, unique_users bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  today_ar int;
  rec record;
  cur_day int := null;
  day_total bigint := 0;
  day_ranked bigint := 0;
  day_unranked bigint := 0;
  day_unlogged bigint := 0;
  seen_profiles uuid[] := '{}';
begin
  if not is_admin_user() then
    raise exception 'not authorized';
  end if;

  today_ar := ((now() at time zone 'America/Argentina/Buenos_Aires')::date - date '2024-01-01');

  for rec in
    select ds.day_number as d, ds.profile_id as p, ds.timed as t
    from daily_stats ds
    where ds.day_number <= today_ar
    order by ds.day_number desc, ds.profile_id
  loop
    if cur_day is not null and rec.d <> cur_day then
      day_number := cur_day;
      total := day_total;
      ranked := day_ranked;
      unranked := day_unranked;
      unlogged := day_unlogged;
      unique_users := coalesce(array_length(seen_profiles, 1), 0);
      return next;

      day_total := 0;
      day_ranked := 0;
      day_unranked := 0;
      day_unlogged := 0;
      seen_profiles := '{}';
    end if;
    cur_day := rec.d;

    day_total := day_total + 1;
    if rec.p is null then
      day_unlogged := day_unlogged + 1;
    elsif rec.t then
      day_ranked := day_ranked + 1;
    else
      day_unranked := day_unranked + 1;
    end if;

    if rec.p is not null and not (rec.p = any(seen_profiles)) then
      seen_profiles := seen_profiles || rec.p;
    end if;
  end loop;

  if cur_day is not null then
    day_number := cur_day;
    total := day_total;
    ranked := day_ranked;
    unranked := day_unranked;
    unlogged := day_unlogged;
    unique_users := array_length(seen_profiles, 1);
    return next;
  end if;
end;
$$;

create or replace function top_pageviews(since timestamptz, result_limit int default 20)
returns table(path text, views bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then
    raise exception 'not authorized';
  end if;

  return query
    select p.path, count(*) as views
    from analytics_pageviews p
    where p.created_at >= since
    group by p.path
    order by views desc
    limit result_limit;
end;
$$;

create or replace function pageviews_by_hour(since timestamptz)
returns table(hour_start timestamptz, pageviews bigint, unique_sessions bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then
    raise exception 'not authorized';
  end if;

  return query
    select
      (date_trunc('hour', p.created_at at time zone 'utc') at time zone 'utc') as hour_start,
      count(*) as pageviews,
      count(distinct p.session_id) as unique_sessions
    from analytics_pageviews p
    where p.created_at >= since
    group by hour_start
    order by hour_start;
end;
$$;

create or replace function pageviews_by_day(since timestamptz)
returns table(day_start date, pageviews bigint, unique_sessions bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then
    raise exception 'not authorized';
  end if;

  return query
    select
      (p.created_at at time zone 'America/Argentina/Buenos_Aires')::date as day_start,
      count(*) as pageviews,
      count(distinct p.session_id) as unique_sessions
    from analytics_pageviews p
    where p.created_at >= since
    group by day_start
    order by day_start;
end;
$$;

create or replace function record_referral_visit(referrer_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referrer_id uuid;
begin
  select id into referrer_id from profiles where username = referrer_username;
  if referrer_id is null then
    return;
  end if;

  insert into referrals (user_id, visit_count)
  values (referrer_id, 1)
  on conflict (user_id) do update set visit_count = referrals.visit_count + 1;
end;
$$;

create or replace function set_active_daily_popup(popup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin_user() then
    raise exception 'not authorized';
  end if;
  update daily_popups set active = false where active;
  update daily_popups set active = true where id = popup_id;
end;
$$;

create or replace function increment_daily_popup_click(popup_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update daily_popups set click_count = click_count + 1 where id = popup_id;
$$;

-- ===========================================================================
-- Ghost mode
-- ===========================================================================

-- Reads request headers server-side (never trusts anything the client
-- claims), and silently no-ops for anyone who isn't actually flagged
-- ghost_mode — safe to call unconditionally without revealing via an error
-- (or lack of one) whether a given account is a ghost.
create or replace function log_ghost_activity(client_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_profile record;
  headers json;
  ip text;
begin
  select id, ghost_mode into caller_profile
  from profiles
  where clerk_user_id = requesting_user_id();

  if caller_profile.id is null or not caller_profile.ghost_mode then
    return;
  end if;

  headers := current_setting('request.headers', true)::json;
  ip := coalesce(headers->>'cf-connecting-ip', split_part(headers->>'x-forwarded-for', ',', 1));

  insert into ghost_activity_log (profile_id, ip_address, user_agent)
  values (caller_profile.id, ip, coalesce(client_user_agent, headers->>'user-agent'));
end;
$$;

-- Fabricates a bot's duel_results row for a just-created ghost-mode ranked
-- duel: one round per pool_index in duels.round_indices, a plausible random
-- distance/score per round drawn from a bell curve (centered on 360,
-- stddev 70, clamped to [50, 463]), plus a fabricated guess coordinate
-- offset from the actual location by that same distance (haversine
-- destination-point formula, random bearing).
--
-- SECURITY DEFINER because duel_results' insert policy requires the caller
-- to *be* the profile being inserted for — impossible for a bot, which has
-- no real session. Authorizes itself instead: caller must be the duel's own
-- challenger.
create or replace function submit_bot_duel_result(target_duel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  bot_id uuid;
  results jsonb := '[]'::jsonb;
  total int := 0;
  target int;
  running_sum int;
  avg_per_round numeric;
  num_rounds int;
  idx int;
  pi int;
  loc record;
  distance numeric;
  points int;
  bearing numeric;
  angular_dist numeric;
  lat1 numeric;
  lng1 numeric;
  new_lat numeric;
  new_lng numeric;
begin
  select * into d from duels where id = target_duel_id;
  if d.id is null then
    raise exception 'duel not found';
  end if;

  if not exists (
    select 1 from profiles p
    where p.id = d.challenger_id and p.clerk_user_id = requesting_user_id()
  ) then
    raise exception 'not authorized';
  end if;

  select id into bot_id from profiles where id = d.opponent_id and is_bot;
  if bot_id is null then
    raise exception 'opponent is not a bot';
  end if;

  num_rounds := array_length(d.round_indices, 1);

  target := round(360 + 70 * sqrt(-2 * ln(greatest(random(), 1e-9))) * cos(2 * pi() * random()));
  target := greatest(50, least(463, target));
  running_sum := 0;
  avg_per_round := target / num_rounds::numeric;

  for idx in 1 .. num_rounds loop
    pi := d.round_indices[idx];
    select nombre, lat, lng into loc from localidades where pool_index = pi;

    if idx < num_rounds then
      points := greatest(0, least(100, round(avg_per_round + (random() - 0.5) * 40)::int));
      running_sum := running_sum + points;
    else
      points := greatest(0, least(100, target - running_sum));
    end if;
    total := total + points;

    distance := case when points >= 100 then round(random() * 1000) else 1000 + (100 - points) * 6000 + floor(random() * 6000) end;

    bearing := random() * 2 * pi();
    angular_dist := distance / 6371000.0;
    lat1 := radians(loc.lat);
    lng1 := radians(loc.lng);
    new_lat := asin(sin(lat1) * cos(angular_dist) + cos(lat1) * sin(angular_dist) * cos(bearing));
    new_lng := lng1 + atan2(sin(bearing) * sin(angular_dist) * cos(lat1), cos(angular_dist) - sin(lat1) * sin(new_lat));

    results := results || jsonb_build_object(
      'nombre', loc.nombre,
      'guess', jsonb_build_array(degrees(new_lat), degrees(new_lng)),
      'actual', jsonb_build_array(loc.lat, loc.lng),
      'distance', distance,
      'points', points
    );
  end loop;

  insert into duel_results (duel_id, profile_id, results, total_score)
  values (target_duel_id, bot_id, results, total)
  on conflict (duel_id, profile_id) do nothing;
end;
$$;

-- Every 3 hours, picks up to 10 random bots, pairs them up, and plays out a
-- full fake ranked duel between each pair — closing it via a plain UPDATE
-- (not baked into the insert) so the existing apply_duel_elo() trigger fires
-- and moves both bots' ELO, keeping the bot pool's ratings drifting
-- organically instead of sitting frozen at their seeded values forever.
create or replace function simulate_bot_duels()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bot_ids uuid[];
  pool_indices int[];
  n int;
  i int;
  j int;
  bot1 uuid;
  bot2 uuid;
  new_duel_id uuid;
  round_idx_arr int[];
  pi int;
  loc record;
  results1 jsonb;
  results2 jsonb;
  target1 int;
  target2 int;
  actual1 int;
  actual2 int;
  running_sum int;
  avg_per_round numeric;
  pts int;
  distance numeric;
  winner uuid;
begin
  select array_agg(id) into bot_ids from (select id from profiles where is_bot order by random() limit 10) s;
  n := coalesce(array_length(bot_ids, 1), 0);
  if n < 2 then
    return;
  end if;

  select array_agg(pool_index) into pool_indices from localidades;
  if coalesce(array_length(pool_indices, 1), 0) < 5 then
    return;
  end if;

  i := 1;
  while i + 1 <= n loop
    bot1 := bot_ids[i];
    bot2 := bot_ids[i + 1];
    i := i + 2;

    select array_agg(x) into round_idx_arr
    from (select unnest(pool_indices) as x order by random() limit 5) s;

    if coalesce(array_length(round_idx_arr, 1), 0) < 5 then
      continue;
    end if;

    insert into duels (challenger_id, opponent_id, round_indices, is_multiplayer, matchmaking, time_limit_seconds)
    values (bot1, bot2, round_idx_arr, false, true, 8)
    returning id into new_duel_id;

    target1 := 50 + round(413 * power(random(), 0.51));
    target2 := 50 + round(413 * power(random(), 0.51));

    results1 := '[]'::jsonb;
    results2 := '[]'::jsonb;
    running_sum := 0;
    avg_per_round := target1 / 5.0;

    for j in 1 .. 5 loop
      pi := round_idx_arr[j];
      select nombre, lat, lng into loc from localidades where pool_index = pi;

      if j < 5 then
        pts := greatest(0, least(100, round(avg_per_round + (random() - 0.5) * 40)::int));
        running_sum := running_sum + pts;
      else
        pts := greatest(0, least(100, target1 - running_sum));
      end if;

      distance := case when pts >= 100 then round(random() * 1000) else 1000 + (100 - pts) * 6000 + floor(random() * 6000) end;
      results1 := results1 || jsonb_build_object(
        'nombre', loc.nombre, 'guess', null,
        'actual', jsonb_build_array(loc.lat, loc.lng), 'distance', distance, 'points', pts
      );
    end loop;

    running_sum := 0;
    avg_per_round := target2 / 5.0;

    for j in 1 .. 5 loop
      pi := round_idx_arr[j];
      select nombre, lat, lng into loc from localidades where pool_index = pi;

      if j < 5 then
        pts := greatest(0, least(100, round(avg_per_round + (random() - 0.5) * 40)::int));
        running_sum := running_sum + pts;
      else
        pts := greatest(0, least(100, target2 - running_sum));
      end if;

      distance := case when pts >= 100 then round(random() * 1000) else 1000 + (100 - pts) * 6000 + floor(random() * 6000) end;
      results2 := results2 || jsonb_build_object(
        'nombre', loc.nombre, 'guess', null,
        'actual', jsonb_build_array(loc.lat, loc.lng), 'distance', distance, 'points', pts
      );
    end loop;

    insert into duel_results (duel_id, profile_id, results, total_score)
    values (new_duel_id, bot1, results1, (select coalesce(sum((r->>'points')::int), 0) from jsonb_array_elements(results1) r));
    insert into duel_results (duel_id, profile_id, results, total_score)
    values (new_duel_id, bot2, results2, (select coalesce(sum((r->>'points')::int), 0) from jsonb_array_elements(results2) r));

    select duel_results.total_score into actual1 from duel_results where duel_id = new_duel_id and profile_id = bot1;
    select duel_results.total_score into actual2 from duel_results where duel_id = new_duel_id and profile_id = bot2;

    if actual1 > actual2 then
      winner := bot1;
    elsif actual2 > actual1 then
      winner := bot2;
    else
      winner := null;
    end if;

    update duels set closed_at = now(), winner_id = winner where id = new_duel_id;
  end loop;
end;
$$;

select cron.schedule(
  'simulate-bot-duels',
  '0 */3 * * *',
  $$select simulate_bot_duels()$$
);

-- ===========================================================================
-- SEED DATA — functional defaults, NOT map data. provincias/localidades are
-- deliberately left empty; load the real Argentina data separately.
-- ===========================================================================

insert into app_settings (key, value) values ('duel_time_limit_seconds', '8'::jsonb);

-- Landing spot for record_referral_visit() when the sharer isn't signed in
-- (see App.jsx's referralUsername/appendReferral in the UbicaBA client).
-- clerk_user_id is a placeholder, not a real auth identity.
insert into profiles (clerk_user_id, username)
values ('system-unlogged-referral-user', 'unlogged')
on conflict (clerk_user_id) do nothing;

-- Achievement catalog — same thresholds as UbicaBA. Edit title/text/
-- image_url from the admin panel's Logros tab whenever.
insert into logros (title, metric_type, threshold) values
  ('Top 5 ELO', 'elo_top_rank', 5),
  ('Top 3 ELO', 'elo_top_rank', 3),
  ('Top 2 ELO', 'elo_top_rank', 2),
  ('Top 1 ELO', 'elo_top_rank', 1),
  ('1 Daily Win', 'daily_wins', 1),
  ('3 Daily Wins', 'daily_wins', 3),
  ('10 Daily Wins', 'daily_wins', 10),
  ('1 Mapa del día completado', 'daily_maps_completed', 1),
  ('5 Mapas del día completados', 'daily_maps_completed', 5),
  ('10 Mapas del día completados', 'daily_maps_completed', 10),
  ('1 Duelo ganado', 'duels_won', 1),
  ('5 Duelos ganados', 'duels_won', 5),
  ('10 Duelos ganados', 'duels_won', 10),
  ('10 Duelos jugados', 'duels_played', 10),
  ('50 Duelos jugados', 'duels_played', 50),
  ('100 Duelos jugados', 'duels_played', 100),
  ('200 Duelos jugados', 'duels_played', 200),
  ('500 Duelos jugados', 'duels_played', 500);

-- Pre-seeded fake opponents for ghost mode (word+word+number, lowercase,
-- Spanish) — same pool UbicaBA ships with, nothing Buenos-Aires-specific.
insert into profiles (clerk_user_id, username, is_bot, elo, ranked_games_played)
values
  ('bot-' || gen_random_uuid(), 'zorrosilencioso42', true, 980, 12),
  ('bot-' || gen_random_uuid(), 'lobobrillante17', true, 1050, 8),
  ('bot-' || gen_random_uuid(), 'tormentaquieta63', true, 1120, 20),
  ('bot-' || gen_random_uuid(), 'tigrefeliz29', true, 940, 5),
  ('bot-' || gen_random_uuid(), 'riofrio91', true, 1005, 15),
  ('bot-' || gen_random_uuid(), 'aguilaoscura38', true, 1080, 11),
  ('bot-' || gen_random_uuid(), 'leonbrillante56', true, 960, 9),
  ('bot-' || gen_random_uuid(), 'ososilencioso74', true, 1030, 18),
  ('bot-' || gen_random_uuid(), 'halconfeliz22', true, 995, 6),
  ('bot-' || gen_random_uuid(), 'lobofrio85', true, 1110, 24),
  ('bot-' || gen_random_uuid(), 'tigrequieto11', true, 970, 4),
  ('bot-' || gen_random_uuid(), 'cuervooscuro67', true, 1015, 13),
  ('bot-' || gen_random_uuid(), 'riobrillante34', true, 1045, 10),
  ('bot-' || gen_random_uuid(), 'tormentasilenciosa99', true, 925, 7),
  ('bot-' || gen_random_uuid(), 'aguilafeliz48', true, 1090, 21),
  ('bot-' || gen_random_uuid(), 'zorrofrio16', true, 1000, 14),
  ('bot-' || gen_random_uuid(), 'leonoscuro73', true, 955, 8),
  ('bot-' || gen_random_uuid(), 'halconbrillante28', true, 1065, 16),
  ('bot-' || gen_random_uuid(), 'osoquieto52', true, 985, 5),
  ('bot-' || gen_random_uuid(), 'tigresilencioso39', true, 1035, 19),
  ('bot-' || gen_random_uuid(), 'lobofeliz64', true, 1010, 12),
  ('bot-' || gen_random_uuid(), 'aguilafria87', true, 945, 6),
  ('bot-' || gen_random_uuid(), 'riooscuro21', true, 1075, 22),
  ('bot-' || gen_random_uuid(), 'zorrobrillante58', true, 990, 9),
  ('bot-' || gen_random_uuid(), 'gavilanquieto33', true, 1055, 17),
  ('bot-' || gen_random_uuid(), 'leonsilencioso76', true, 930, 4),
  ('bot-' || gen_random_uuid(), 'tormentafeliz41', true, 1100, 23),
  ('bot-' || gen_random_uuid(), 'gavilanfrio19', true, 965, 7),
  ('bot-' || gen_random_uuid(), 'ososcuro82', true, 1020, 15),
  ('bot-' || gen_random_uuid(), 'tigrebrillante47', true, 1040, 11)
on conflict (username) do nothing;
