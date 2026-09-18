-- Run this manually in the Supabase SQL editor (ubicarg project).
--
-- New scoring formula for a country-scale game: 100 pts within 1km, then
-- -1 pt every 500m beyond that (was: 100 pts within 50m, -1 pt every 66m —
-- calibrated for UbicaBA's street-corner scale, way too strict for
-- province-to-province distances). Client-side match: scoreForDistance() in
-- src/App.jsx. Only the ghost-mode bot simulation functions need a DB-side
-- update — real players score client-side.

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

    distance := case when points >= 100 then round(random() * 1000) else 1000 + (100 - points) * 500 + floor(random() * 500) end;

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

      distance := case when pts >= 100 then round(random() * 1000) else 1000 + (100 - pts) * 500 + floor(random() * 500) end;
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

      distance := case when pts >= 100 then round(random() * 1000) else 1000 + (100 - pts) * 500 + floor(random() * 500) end;
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
