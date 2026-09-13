-- LOCK DISCIPLINE: this ALTER needs ACCESS EXCLUSIVE on a table the twice-hourly detector sweep
-- reads (mon_detect_res_com_collision_repair_regression). A first attempt on 2026-09-13 queued
-- behind mon_dispatch_p0_fast() and, while queued, blocked every subsequent reader. Fail fast
-- instead of building a queue in production.
set local lock_timeout = '3s';

-- ops_res_com_collision_adjudication could only record retiring the RESIDENTIAL side.
--
-- The 2026-08-30 sadin/dealapp repair retired residential every time, so res_active_before/after
-- were enough. They are not general: on 2026-09-13 arkaan AK907 needed the RESIDENTIAL row retired
-- (the source itself retitled the ad from residential land to commercial land between captures)
-- while amaall's six needed the COMMERCIAL side retired (those rows predate scrapers/amaall/run.py,
-- added 2026-09-12, whose current output is residential). A table that can only express one
-- direction would have recorded the amaall repairs as if the residential row had been touched,
-- which is false -- and mon_detect_res_com_collision_repair_regression would then watch the wrong
-- side, i.e. a barrier green over the rows it was built to protect.
--
-- Additive only: nothing is dropped, no existing value changes meaning. The eight historical rows
-- are backfilled to retired_side='residential', which is what they factually were.
alter table public.ops_res_com_collision_adjudication
  add column if not exists retired_side       text,
  add column if not exists com_active_before  boolean,
  add column if not exists com_active_after   boolean;

update public.ops_res_com_collision_adjudication
   set retired_side = 'residential'
 where retired_side is null;

alter table public.ops_res_com_collision_adjudication
  alter column retired_side set default 'residential';

alter table public.ops_res_com_collision_adjudication
  drop constraint if exists ops_res_com_collision_adjudication_retired_side_ck;
alter table public.ops_res_com_collision_adjudication
  add constraint ops_res_com_collision_adjudication_retired_side_ck
  check (retired_side in ('residential','commercial','none'));

comment on column public.ops_res_com_collision_adjudication.retired_side is
  'Which side of the collision was deactivated: residential | commercial | none (ambiguous, left '
  'alone for a human). NEVER infer it from res_active_after alone - a commercial-side repair '
  'leaves both residential columns true.';
