-- 🔧 2026-11-09: enrol the seven data repairs of 11-07/11-08 that alert repair_guarantee_unenrolled (13655) found outside
-- ops_repair_guarantee_registry, so the permanent oldest-first rotation re-verifies each one against production.
-- Each invariant is written from the repair's own header; each detector exists and is on mon_run_all_detectors() —
-- the check block below refuses otherwise (a registry row pointing at nothing is the class alert 1063 exists for).
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by) values
  ('20261107213403', 'multi_use_land_twin_is_not_a_url_collision',
   'A URL served by exactly one residential land ad and one commercial land ad whose own text says «متعددة الاستخدام» (the owner''s 2026-09-27 multi-use rule, Keller Williams 20 twins) is never raised as url_collision_res_vs_com; any other res/com URL collision still raises.',
   'mon_detect_url_collisions_res_vs_com', 'qa 2026-11-09 (from alert 13655)'),
  ('20261107213742', 'rega_land_total_is_not_a_phone_price',
   'A served price that equals the source''s own structured REGA field verbatim (source_capture.price_evidence origin api, e.g. AdValidator.advertisement.landTotalPrice on muhaysini) is never raised as field_integrity phone_price; a price with no such evidence of the same shape still raises.',
   'mon_detect_field_integrity', 'qa 2026-11-09 (from alert 13655)'),
  ('20261108073000', 'wasalt_card_licence_guard_and_arrivals',
   'Every served wasalt row re-upserted after the wasalt_preserve_detail trigger landed whose index holds a 10-digit REGA licence (ar_data.regaVerifiedInfo) carries that licence on its card key (additional_info.rega_ad_license_number); a row missing it means the trigger stopped and raises P2 to 🆕.',
   'mon_detect_wasalt_card_licence_missing', 'qa 2026-11-09 (from alert 13655)'),
  ('20261108112500', 'lifecycle_hide_16_read_gone_twice',
   'The 16 bossbih / sadiqeltajer / aqarcity ads read gone on two independent readers on 2026-11-08 stay inactive: each is registered in ops_adjudicated_retraction, and a crawl or auto_recover_false_inactive() turning one back on raises adjudicated_reactivation.',
   'mon_detect_adjudicated_reactivation', 'qa 2026-11-09 (from alert 13655)'),
  ('20261108114500', 'aqargate_hide_27_wordpress_ads_left_the_new_site',
   'The 27 aqargate WordPress-era ads absent from the new site''s complete catalogue (walked 2026-11-08) stay inactive: each is registered in ops_adjudicated_retraction, and a reactivation raises adjudicated_reactivation.',
   'mon_detect_adjudicated_reactivation', 'qa 2026-11-09 (from alert 13655)'),
  ('20261108121500', 'gathern_hide_2_new_units_read_gone_twice',
   'The 2 gathern units whose own page never answered live (404 on three hourly sweeps + spot check 42476468102) stay inactive unless gathern-recheck-dead reads them live again; a crawl reviving one without a live page read raises adjudicated_reactivation.',
   'mon_detect_adjudicated_reactivation', 'qa 2026-11-09 (from alert 13655)'),
  ('20261108124500', 'sakani_hide_26_ended_licence_read_gone',
   'The 26 sakani units whose REGA licence ended (source field ad_license_end_date) and whose own page read gone (spot check 42478842663, controls 5/5) stay inactive: registered in ops_adjudicated_retraction, a reactivation raises adjudicated_reactivation.',
   'mon_detect_adjudicated_reactivation', 'qa 2026-11-09 (from alert 13655)')
on conflict do nothing;

do $$
declare r record; roster text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
begin
  for r in select distinct detector from public.ops_repair_guarantee_registry
            where repair_version in ('20261107213403','20261107213742','20261108073000','20261108112500','20261108114500','20261108121500','20261108124500') loop
    if to_regproc('public.' || r.detector) is null then raise exception 'enrolment names a detector that does not exist: %', r.detector; end if;
    if position(r.detector in roster) = 0
       and not exists (select 1 from cron.job j where j.active and position(r.detector in j.command) > 0) then
      raise exception 'enrolment names a detector nothing runs: %', r.detector;
    end if;
  end loop;
  if (select count(*) from public.ops_repair_guarantee_registry
       where repair_version in ('20261107213403','20261107213742','20261108073000','20261108112500','20261108114500','20261108121500','20261108124500')) <> 7 then
    raise exception 'seven repairs were not all enrolled';
  end if;
end $$;
