-- A DATABASE CHANGE DURING A BUSY HOUR MUST NOT TAKE THE WHOLE API DOWN (2026-10-09).
--
-- THE INCIDENT. 2026-10-09 at 20:24 and 20:56 UTC every API request (searches, counts, listing
-- tables, alert_event) answered 503 PGRST002 for about a minute. Each time a migration had just been
-- applied (20:24:18 = 20261009202418_gate_three_heaviest_sweep_detectors), so PostgREST reloaded its
-- schema cache. That reload runs as `authenticator`, whose statement_timeout was 8 s. With the
-- database busy (the Friday audit's browser sweeps + CI live checks: 3-9 searches in flight, search
-- p90 4-9 s) the reload needed longer: "Failed to load the schema cache ... 57014 canceling statement
-- due to statement timeout" exactly 8 s after it began, then PGRST002 to every caller until a retry
-- won. The web-runtime smoke's searches in those windows landed no count (count=null), and a real
-- user would have seen the same. Quiet reloads the same day (17:11-19:15) finished in 0.1-3 s.
--
-- THE FIX. authenticator itself gets 30 s, so a reload under load completes instead of failing.
-- Request limits do NOT move: PostgREST applies the impersonated role's own settings to every request,
-- so anon and authenticated keep their 20 s, and service_role -- which had no setting of its own and
-- so inherited authenticator's 8 s -- is pinned to that same 8 s first. The config reload re-opens
-- PostgREST's pool, so the new value reaches its connections now rather than at pool recycling.
--
-- ROLLBACK: alter role authenticator set statement_timeout = '8s';
--           alter role service_role reset statement_timeout; notify pgrst, 'reload config';

alter role service_role set statement_timeout = '8s';
alter role authenticator set statement_timeout = '30s';
notify pgrst, 'reload config';
