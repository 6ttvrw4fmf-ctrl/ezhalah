-- THE API'S SCHEMA RELOAD GETS 30 s, APPLIED WITHOUT FORCING A RELOAD (2026-10-09, follows
-- 20261009211053_api_schema_reload_survives_a_busy_database).
--
-- WHAT WENT WRONG WITH 20261009211053. It raised authenticator to 30 s and then sent
-- `notify pgrst, 'reload config'`. PostgREST re-opened its pool before that transaction committed,
-- so the first schema-cache load still ran on 8 s connections and timed out (21:11:00, 57014); the
-- retry waited on a lock past authenticator's 8 s lock_timeout (21:11:10, 55P03); the third try took
-- 9.3 s and won (21:11:21). 38 API requests got 503 in those 19 s, none from a real browser. The
-- settings were then rolled back by hand (21:11:33), which this migration supersedes.
--
-- WHY 30 s. Measured the same day, the schema-cache query takes 2-4 s when the database is quiet and
-- 4-9.3 s when it is busy, so an 8 s budget fails on exactly the busy reloads (20:24 and 20:56 UTC:
-- PGRST002 to every caller for about a minute, and the web-runtime smoke's searches got no count).
--
-- THIS TIME, NO NOTIFY. PostgREST re-opens its pool on its next schema reload (every migration sends
-- one) and those new connections carry these values, so the reload that needs the room gets it.
-- Request limits stay exactly what they are today, now pinned on each role, because PostgREST applies
-- the impersonated role's own settings to every request: anon and authenticated 20 s statement and
-- 8 s lock (lock was inherited from authenticator), service_role 8 s and 8 s (both were inherited).
-- Only authenticator's own work, the schema cache, gets 30 s.
--
-- ROLLBACK (takes effect at PostgREST's next reload; add `notify pgrst, 'reload config'` only when
-- the database is quiet):
--   alter role authenticator set statement_timeout = '8s'; alter role authenticator set lock_timeout = '8s';
--   alter role anon reset lock_timeout; alter role authenticated reset lock_timeout;
--   alter role service_role reset statement_timeout; alter role service_role reset lock_timeout;

alter role anon set lock_timeout = '8s';
alter role authenticated set lock_timeout = '8s';
alter role service_role set statement_timeout = '8s';
alter role service_role set lock_timeout = '8s';
alter role authenticator set statement_timeout = '30s';
alter role authenticator set lock_timeout = '30s';
