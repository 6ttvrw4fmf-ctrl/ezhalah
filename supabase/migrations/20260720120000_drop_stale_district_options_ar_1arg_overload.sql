-- Hotfix — 2026-07-20, immediately after deploying PR #155 (Trending Cities/Districts).
-- =============================================================================================
-- PR #155's migration did `CREATE OR REPLACE FUNCTION district_options_ar(p_city_id integer,
-- p_deal text DEFAULT NULL, p_category text DEFAULT NULL)`, intending to extend the existing
-- single-argument function. Postgres does NOT treat a different parameter list as a replacement —
-- it creates a SEPARATE overload. This left TWO live functions named district_options_ar
-- simultaneously (1-arg original + 3-arg new), which is the exact PGRST203 "ambiguous overload"
-- signature this repo's own safe-deploy.sh schema-drift gate exists to catch (and did catch, on
-- this deploy — see docs/DEPLOY_SAFETY.md 2026-07-16 outage for the original incident this gate
-- was built to prevent). Caught before advancing the deploy baseline; the Vercel deploy itself had
-- already gone out and was NOT rolled back, since the smoke test showed search itself unaffected —
-- this migration was applied within minutes, before any known real user hit the ambiguous shape.
--
-- FIX: drop the stale 1-arg overload. Verified (read-only, live, 2026-07-20) that the remaining
-- 3-arg function's defaults reproduce the 1-arg function's output byte-for-byte, and that all three
-- call shapes (1-arg, 2-arg, 3-arg) resolve unambiguously to the single remaining function
-- immediately after this ran.
-- =============================================================================================

DROP FUNCTION IF EXISTS public.district_options_ar(integer);
