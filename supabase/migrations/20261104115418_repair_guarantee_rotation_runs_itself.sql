-- THE REPAIR-GUARANTEE ROTATION RUNS ITSELF, AND THREE 2026-11-04 REPAIRS ARE ENROLLED (alerts 12983, 12984, 10003).
--
-- WHY repair_guarantee_stale NEVER CLOSED. ops_repair_guarantee_registry promises PERMANENT oldest-first
-- re-verification, but the only thing that ever wrote last_verified_at was routine #7 — one of the eleven
-- routines the owner deleted on 2026-09-27. Nothing replaced it: measured 2026-11-04, 215 entries, the newest
-- verification 2026-10-30 and only by a repair's own author at enrollment, 120 entries past the 30-day window.
-- The detector kept raising, correctly, about a rotation that no longer existed.
--
-- THE ROTATION, now in the database. ops_repair_guarantee_rotate() visits every registered repair whose
-- watching detector EXISTS and is REACHABLE (roster or its own cron job) and has not been rotated in 20 h:
--   * the detector RAN cleanly in the last 26 h (ops_detector_timing, not crashed, not skipped — or its own
--     cron job succeeded), AND the alert kinds it raises are readable from its body (mon_raise('Pn','<kind>'…)):
--       no open alert of those kinds → last_verdict 'detector_clean';  open ones → 'detector_raising' (keys kept);
--       last_verified_at = now().
--   * otherwise 'undetermined' is recorded in last_detail.rotation ONLY — last_verified_at is NOT stamped, so
--     the stale limb keeps reporting a repair the robot could not actually check.
-- What it never does: write 'holds' (only a per-invariant evidence re-check earns that — the verdict trigger's
-- own rule), overwrite a 'violated' verdict (kept, so the open violation and its unearned_since marker stay
-- visible), or touch a repair with no detector (the unwatched limb owns those; 57 on 2026-11-04, an honest gap).
-- It is called at the top of mon_detect_repair_guarantee_stale(), inside its own exception block: a rotation
-- failure raises repair_guarantee_rotation_failed instead of silencing the stale limb.
--
-- ENROLMENT (repair-enrollment-guard.yml red, alert 12984 → 12983 unenrolled 20261104062200 / 065445 / 070739).
-- Each invariant re-measured against production 2026-11-04 ~11:40 UTC before enrolling:
--   062200 AQM5708581: neighborhood = district_ar on id 1097380 (0 drift rows);
--   065445 wasalt 14700765 / 14619626: price_total 1,000,000 / 150,000, price_per_meter NULL (wasalt's salePrice);
--   070739 dealapp 1571258 / 17021434 / 1738221: furnished NULL;
--   all three watching detectors are on mon_run_all_detectors() and none of their kinds has an open alert.
-- Barrier: scripts/verify-repair-guarantee-rotation-runs-itself.ts.

insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
 ('20261104062200', 'aqm5708581_card_district_takes_the_indexed_district',
  'The aqarmonthly card district (neighborhood) equals the indexed district (district_ar): AQM5708581 shows «حي الملك فهد», never the glued «حي الملك فهد المجمعة».',
  'mon_detect_aqarmonthly_card_district_drift', 'finish-ten-unconfirmed 2026-11-04 (alert 12983)', now(), 'holds',
  jsonb_build_object('evidence_recheck', 'aqarmonthly_residential_listings id 1097380: neighborhood = district_ar (0 drift rows); detector on roster; no open aqarmonthly_card_district_drift alert',
                     'checked', 'production 2026-11-04')),
 ('20261104065445', 'wasalt_multiplied_description_is_not_a_rate',
  'A wasalt description total that is the seller''s total multiplied by the area is never read as a per-m² rate: 14700765 and 14619626 keep wasalt''s own salePrice (1,000,000 / 150,000) as a total.',
  'mon_detect_rate_served_as_total', 'finish-ten-unconfirmed 2026-11-04 (alert 12983)', now(), 'holds',
  jsonb_build_object('evidence_recheck', 'wasalt_residential_listings 14700765 price_total 1000000, 14619626 price_total 150000, price_per_meter NULL on both; detector on roster; no open rate_served_as_total alert',
                     'checked', 'production 2026-11-04')),
 ('20261104070739', 'field_integrity_judges_served_price_and_dealapp_floor_covering',
  'A dealapp ad whose only furnishing word names a floor covering (نجيل / عشب / موكيت) is not served as furnished = yes.',
  'mon_detect_dealapp_partial_furnished_as_yes', 'finish-ten-unconfirmed 2026-11-04 (alert 12983)', now(), 'holds',
  jsonb_build_object('evidence_recheck', 'dealapp_residential_listings 1571258 / 17021434 / 1738221 furnished NULL; detector on roster; no open dealapp_partial_furnished_as_yes alert',
                     'checked', 'production 2026-11-04'))
on conflict do nothing;

create or replace function public.ops_repair_guarantee_rotate()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_roster text;
  rec      record;
  v_def    text;
  v_kinds  text[];
  v_ran    boolean;
  v_open   text[];
  v_verdict text;
  n_clean int := 0; n_raising int := 0; n_undetermined int := 0;
begin
  select pg_get_functiondef(p.oid) into v_roster
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors'
   limit 1;

  for rec in
    select r.repair_version, r.detector, r.last_verdict
      from public.ops_repair_guarantee_registry r
     where coalesce(r.detector, '') <> ''
       and coalesce(r.last_verified_at, '-infinity'::timestamptz) < now() - interval '20 hours'
       and coalesce((r.last_detail #>> '{rotation,at}')::timestamptz, '-infinity'::timestamptz) < now() - interval '20 hours'
     order by coalesce(r.last_verified_at, r.registered_at), r.repair_version
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = rec.detector and p.pronargs = 0
     limit 1;
    -- missing or unreachable: the unwatched limb reports it; the rotation does not pretend to check it
    continue when v_def is null;
    continue when not (position(rec.detector in coalesce(v_roster, '')) > 0
                       or exists (select 1 from cron.job j where j.active and position(rec.detector in j.command) > 0));

    v_kinds := array(select distinct m[1]
                       from regexp_matches(v_def, 'mon_raise\(\s*''P\d''\s*,\s*''([A-Za-z0-9_]+)''', 'g') m);
    v_ran := exists (select 1 from public.ops_detector_timing d
                      where d.detector = rec.detector and d.swept_at > now() - interval '26 hours'
                        and not d.crashed and not d.skipped)
          or exists (select 1 from cron.job j join cron.job_run_details x on x.jobid = j.jobid
                      where j.active and position(rec.detector in j.command) > 0
                        and x.status = 'succeeded' and x.start_time > now() - interval '26 hours');

    if cardinality(v_kinds) = 0 or not v_ran then
      update public.ops_repair_guarantee_registry
         set last_detail = last_detail || jsonb_build_object('rotation', jsonb_build_object(
               'at', now(), 'verdict', 'undetermined',
               'why', case when not v_ran then 'the detector has not run cleanly in 26 h'
                           else 'no mon_raise(''Pn'', ''<kind>'') literal in the detector body' end))
       where repair_version = rec.repair_version;
      n_undetermined := n_undetermined + 1;
      continue;
    end if;

    v_open := array(select a.dedup_key from public.alert_event a
                     where a.resolved_at is null and a.kind = any(v_kinds)
                     order by a.dedup_key limit 20);
    v_verdict := case when cardinality(v_open) > 0 then 'detector_raising' else 'detector_clean' end;

    update public.ops_repair_guarantee_registry
       set last_verified_at = now(),
           last_verdict = case when rec.last_verdict = 'violated' then 'violated' else v_verdict end,
           last_detail = last_detail || jsonb_build_object('rotation', jsonb_build_object(
             'at', now(), 'verdict', v_verdict, 'robot', 'ops_repair_guarantee_rotate()',
             'previous_verdict', rec.last_verdict, 'kinds', to_jsonb(v_kinds), 'open_keys', to_jsonb(v_open)))
     where repair_version = rec.repair_version;
    if v_verdict = 'detector_clean' then n_clean := n_clean + 1; else n_raising := n_raising + 1; end if;
  end loop;

  return jsonb_build_object('detector_clean', n_clean, 'detector_raising', n_raising, 'undetermined', n_undetermined);
end
$function$;

revoke all on function public.ops_repair_guarantee_rotate() from public, anon, authenticated;

do $mig$
declare
  v_def text := pg_get_functiondef('public.mon_detect_repair_guarantee_stale()'::regprocedure);
  v_old text := E'begin\n  -- Fetch the roster body ONCE rather than per row.\n';
  v_new text := E'begin\n'
    || E'  -- THE ROTATION RUNS FIRST (2026-11-04): routine #7, the only writer of last_verified_at, was deleted on\n'
    || E'  -- 2026-09-27. A failed rotation is raised, never swallowed into a quiet stale limb.\n'
    || E'  begin\n'
    || E'    perform public.ops_repair_guarantee_rotate();\n'
    || E'    perform public.mon_resolve_key(''repair_guarantee'', ''repair_guarantee_rotation_failed'');\n'
    || E'  exception when others then\n'
    || E'    n := n + public.mon_raise(''P2'', ''repair_guarantee'', ''monitoring'', ''repair_guarantee_rotation_failed'',\n'
    || E'      jsonb_build_object(''error'', sqlerrm, ''why'', ''ops_repair_guarantee_rotate() failed, so no registered repair was re-verified this sweep.''));\n'
    || E'  end;\n\n'
    || E'  -- Fetch the roster body ONCE rather than per row.\n';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'mon_detect_repair_guarantee_stale: anchor not found exactly once — re-read the live function';
  end if;
  if position('ops_repair_guarantee_rotate' in v_def) > 0 then
    raise exception 'mon_detect_repair_guarantee_stale already calls the rotation — refusing to add a second call';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;

select public.mon_detect_repair_guarantee_stale();
