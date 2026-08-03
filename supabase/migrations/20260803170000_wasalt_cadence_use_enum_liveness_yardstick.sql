-- Fix wasalt's freshness yardstick in platform_cadence.
--
-- Live check (2026-08-03) against cron.job:
--   jobid 4  gh-wasalt-res  '40 */8 * * *'   -- residential sweep, every 8h
--   jobid 5  gh-wasalt-com  '45 */8 * * *'   -- commercial sweep, every 8h
--   jobid 36 gh-wasalt-enum-liveness '0 21 */2 * *'  -- every 2 days (48h)
--
-- The current row (expected_hours=8, note citing jobids 4/5) treats the 8-hourly sweeps as the
-- freshness yardstick, but jobs 4/5 only touch ~12% of the active catalog per run and were never
-- meant to prove catalog-wide liveness. The full-catalog cadence is jobid 36
-- (gh-wasalt-enum-liveness), which runs every 2 days -> expected_hours should be 48, not 8.

update public.platform_cadence
   set expected_hours = 48,
       note = 'Full-catalog liveness sweep is jobid 36 (gh-wasalt-enum-liveness), every 2 days. '
              || 'jobids 4/5 (gh-wasalt-res/com, 8-hourly) only cover ~12% of the active catalog '
              || 'per run and are not the freshness yardstick.'
 where platform = 'wasalt';
