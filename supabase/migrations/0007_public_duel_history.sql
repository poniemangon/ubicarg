-- Run this manually in the Supabase SQL editor (ubicarg project).
--
-- Same bug as UbicaBA's 0074/0075_public_duel_history*.sql (this schema was
-- cloned from it): viewing another player's public profile shows "0
-- jugadas" for their duel stats, because duels/duel_results' SELECT
-- policies only allow rows where the REQUESTING session is a participant —
-- not rows for the profile actually being viewed. Adds an extra permissive
-- SELECT policy for closed (finished) ranked/multiplayer duels only —
-- private 1v1s stay hidden, matching PublicProfilePage.jsx's own on-screen
-- promise ("Los duelos 1 vs 1 privados no son visibles para otros
-- jugadores"). See UbicaBA's 0075 for the full explanation of why this is
-- scoped narrower than just "closed_at is not null".

create policy "closed duels are viewable by everyone"
  on duels for select
  using (closed_at is not null and (is_multiplayer or matchmaking));

create policy "results of closed duels are viewable by everyone"
  on duel_results for select
  using (
    exists (
      select 1 from duels d
      where d.id = duel_results.duel_id
        and d.closed_at is not null
        and (d.is_multiplayer or d.matchmaking)
    )
  );
