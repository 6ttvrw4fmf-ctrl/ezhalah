-- ============================================================================
-- routine-7-seam, 2026-09-19. ops_incident #332.
--
-- THE SEAM: a new P0-capable detector -> the P0 fast lane -> the 300s delivery SLO.
--
-- Migration 20260919092122 (detect_price_borrowed_from_page_chrome_fleet_wide,
-- applied 09:21Z) created mon_detect_price_borrowed_from_chrome, which CAN raise
-- P0, and added it to mon_run_all_detectors() -- but not to the
-- mon_run_p0_detectors() fast-lane roster.
--
-- CONSEQUENCE, MEASURED: a P0 raised by that detector is evaluated only inside
-- the twice-hourly sweep, whose whole runtime is charged against the 300s P0
-- delivery SLO before dispatch begins. The sweep measured avg 307s / max 900s
-- (its own statement_timeout) over the last 48h, so such a P0 could not meet the
-- SLO at all. This is precisely the drift mon_run_p0_detectors()'s own comment
-- says the barrier exists to prevent.
--
-- SECOND CONSEQUENCE, also measured: p0-fast-lane-coverage.yml is a live check
-- that runs on EVERY pull_request. It went red across the whole repo at ~09:22 --
-- observed failing on four unrelated PRs (#3255, journey/both-edges-docked,
-- qa/showmore-closing, and ksaaqar-platform itself), each green on the same
-- branch at 09:17. One production roster gap was failing every PR in the repo.
--
-- THE FIX is the one the barrier's own FIX text prescribes: add it to the
-- c_p0_detectors roster, needle-edited from the LIVE definition rather than
-- replaced from a snapshot, because concurrent sessions edit that same roster.
-- The SLO is not widened and no cron schedule is touched.
-- ============================================================================

do $lane$
declare
  src text;
  anchor text := '''mon_detect_silent_scraper_death'',';
  target text := 'mon_detect_price_borrowed_from_chrome';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors';

  if src is null then
    raise exception 'mon_run_p0_detectors not found -- refusing to guess a roster';
  end if;

  -- Idempotent: a concurrent session may already have landed this.
  if position(target in src) > 0 then
    return;
  end if;

  -- The detector must actually exist and must actually be P0-capable, or this
  -- would be adding a name the lane cannot call.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = target
  ) then
    raise exception '% does not exist -- refusing to add a phantom to the fast lane', target;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = target
       and pg_get_functiondef(p.oid) ilike '%''P0''%'
  ) then
    raise exception '% is not P0-capable -- the fast lane is for P0 detectors only', target;
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'roster anchor % is not unique -- refusing to needle-edit blindly', anchor;
  end if;

  -- Alphabetical position: after mon_detect_p0_delivery_sla, before
  -- mon_detect_silent_scraper_death.
  src := replace(src, anchor, '''' || target || ''',' || chr(10) || '    ' || anchor);
  execute src;

  -- Prove the edit took, and that nothing else was lost in the process.
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors';

  if position(target in src) = 0 then
    raise exception 'fast-lane roster edit did not take';
  end if;
  if position('mon_detect_silent_scraper_death' in src) = 0
     or position('mon_detect_unledgered_hard_delete' in src) = 0
     or position('mon_detect_alert_delivery' in src) = 0 then
    raise exception 'fast-lane roster lost an existing entry -- aborting';
  end if;
end
$lane$;

-- Apply-time proof: the lane must still RUN, and must now carry the detector.
do $proof$
declare
  res jsonb;
  n_lane int;
begin
  select count(*) into n_lane
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors'
     and position('mon_detect_price_borrowed_from_chrome' in pg_get_functiondef(p.oid)) > 0;
  if n_lane <> 1 then
    raise exception 'self-test: the detector is not on the fast lane after the edit';
  end if;

  -- Execute the lane end to end. A roster naming a function it cannot call would
  -- surface here as a crashed/missing entry rather than at 03:00 on a real P0.
  select public.mon_run_p0_detectors() into res;
  if res is null then
    raise exception 'self-test: mon_run_p0_detectors() returned null';
  end if;
  if coalesce(jsonb_array_length(res->'missing'), 0) <> 0 then
    raise exception 'self-test: fast lane reports missing detectors: %', res->'missing';
  end if;
  if coalesce(jsonb_array_length(res->'crashed'), 0) <> 0 then
    raise exception 'self-test: fast lane reports crashed detectors: %', res->'crashed';
  end if;
end
$proof$;
