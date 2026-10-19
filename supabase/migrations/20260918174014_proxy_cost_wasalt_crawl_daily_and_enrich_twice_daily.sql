-- OWNER 2026-09-18, on proxy cost: "for the smaller ones, we can work with them on two days, but
-- the [big] one will have to be more of a daily basis."
--
-- WHY THIS IS THE LEVER THAT MATTERS. The shared Saudi residential proxy is metered, and wasalt is
-- 56,974 of the 57,151 listings that go through it — 99.7%. Everything else is rounding.
-- One full wasalt crawl walks 19 property-type slugs x 2 deals = 38 search streams, paginated 32
-- listings per page, so roughly 1,820 page fetches. At every-8-hours that is ~5,460 fetches/day;
-- daily it is ~1,820. A 67% cut in the dominant cost, and the same top-up then lasts 3x longer.
--
-- WHAT IS NOT CHANGED, deliberately:
--   * Detail-page fetching is already OFF by default (WASALT_FETCH_DETAIL) with its own cost guard —
--     ~400KB per listing. Nothing to win there; it was already won.
--   * Liveness is already HEAD-first (~1-2KB, GET only to confirm a non-200). Already cheap.
--   * gzip is already requested in scrapers/common/http.py.
--   * gh-wasalt-enum-liveness (every 2 days) and gh-wasalt-cleanup (weekly) are already modest.
--
-- FRESHNESS COST, stated rather than hidden: a new wasalt listing now appears up to 24h after
-- publication instead of up to 8h, and a withdrawn one stays visible up to 24h longer. For property
-- ads that is an acceptable trade the owner has made explicitly; for a fast-moving inventory it
-- would not be. If freshness is ever preferred again, put these back to '*/8'.
--
-- enrich-ar drops 6x/day -> 2x/day for a different reason: its backlog is 505 rows of 56,974
-- (99.1% already fetched), so five of six runs were spinning up for almost nothing. This is not a
-- freshness trade, it is removing idle runs.
do $mig$
declare v_res int; v_com int; v_enr int;
begin
  select jobid into v_res from cron.job where jobname = 'gh-wasalt-res';
  select jobid into v_com from cron.job where jobname = 'gh-wasalt-com';
  select jobid into v_enr from cron.job where jobname = 'gh-wasalt-enrich-ar';
  if v_res is null or v_com is null or v_enr is null then
    raise exception 'expected wasalt cron jobs are missing (res=%, com=%, enrich_ar=%)', v_res, v_com, v_enr;
  end if;

  -- 02:40 / 02:45 are unoccupied minutes (checked against every active job), so this does not create
  -- a new cron_minute_collision that mon_detect_cron_minute_collision would raise.
  perform cron.alter_job(v_res, schedule => '40 2 * * *');
  perform cron.alter_job(v_com, schedule => '45 2 * * *');
  perform cron.alter_job(v_enr, schedule => '15 */12 * * *');
end $mig$;

do $verify$
declare s_res text; s_com text; s_enr text; v_dupes int;
begin
  select schedule into s_res from cron.job where jobname = 'gh-wasalt-res';
  select schedule into s_com from cron.job where jobname = 'gh-wasalt-com';
  select schedule into s_enr from cron.job where jobname = 'gh-wasalt-enrich-ar';
  if s_res <> '40 2 * * *' or s_com <> '45 2 * * *' or s_enr <> '15 */12 * * *' then
    raise exception 'schedules did not take: res=% com=% enrich=%', s_res, s_com, s_enr;
  end if;

  -- all three must still be ACTIVE — a cost change must never become a silent disable.
  if (select count(*) from cron.job
       where jobname in ('gh-wasalt-res','gh-wasalt-com','gh-wasalt-enrich-ar') and active) <> 3 then
    raise exception 'a wasalt job was left inactive — this change reduces cadence, never disables';
  end if;

  -- and must not collide with another active job on the same minute+hour.
  select count(*) into v_dupes from (
    select schedule, count(*) c from cron.job where active
      and schedule in ('40 2 * * *','45 2 * * *') group by schedule having count(*) > 1) d;
  if v_dupes > 0 then
    raise exception 'the new wasalt slots collide with an existing active job';
  end if;
end $verify$;