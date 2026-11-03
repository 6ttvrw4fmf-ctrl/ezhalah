-- The daily-gated mon_detect_index_label_unrepairable() (a full-index join, 291-394 s per run) rode
-- inside the hourly mon-detectors-and-dispatch sweep (jobid 38, statement_timeout 900 s, typical
-- 6 min). On the hour its 20 h slot came due the sweep ran 13m40s (2026-11-02 19:59, headroom
-- alert) or was KILLED at 15m00s (2026-11-01 22:59, place_km inside loc_display_district_ar) — and
-- an aborted sweep runs NO detector for that hour and rolls back the slot claim, so it retries the
-- next hour. It now runs in its own daily cron slot with its own budget, the same shape as
-- mon-unknown-named-district / mon-district-blank-unexplained. It stays reached by a cron job, so
-- mon_detect_orphaned_detectors() still sees it, and its 20 h mon_claim_daily_slot gate is kept, so
-- mon_detect_stalled_daily_detector still watches it.
do $mig$
declare
  v_def text := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  v_needle constant text := '''mon_detect_index_label_unrepairable'', ';
  v_hits int := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
begin
  if v_hits <> 1 then
    raise exception 'expected 1 roster entry for mon_detect_index_label_unrepairable, found %', v_hits;
  end if;
  execute replace(v_def, v_needle, '');
  if position('mon_detect_index_label_unrepairable' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) > 0 then
    raise exception 'roster entry still present after rewrite';
  end if;
  if position('mon_detect_card_label_contract' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'rewrite dropped a neighbouring roster entry';
  end if;
end
$mig$;

select cron.schedule('mon-index-label-unrepairable', '29 3 * * *',
  $$set statement_timeout to '600s'; select public.mon_detect_index_label_unrepairable();$$);