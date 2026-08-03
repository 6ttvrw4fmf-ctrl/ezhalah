-- ─────────────────────────────────────────────────────────────────────────────────────────
-- STANDING GUARD: English-neighbourhood leak detector. ADDITIVE + ALERT-ONLY.
--
-- WHY: dealapp was capturing the source's ENGLISH schema.org addressRegion as the district (a wrong
-- "Riyadh" default), which — absent the card-gate — risked English text reaching a user-facing card.
-- The root cause is fixed at the scraper (breadcrumb Arabic capture + regression test), and the
-- resolution pipeline only ever emits a CANONICAL ARABIC district or NULL — so English cannot reach
-- search_listings_ar.district_ar by construction. This detector is the cross-cutting backstop that
-- keeps that invariant true forever: it fires the instant ANY live card on ANY platform shows a
-- Latin-letter district, which can only happen if the resolver is changed to pass English through.
-- It is the machine-checked form of feedback_english-district-to-arabic-mapping-standard: users only
-- ever see the correct Arabic district or «الحي غير محدد» — zero English leakage, anywhere.
--
-- NEUTRALITY: alert-only. Reads the search index; never modifies a listing, never hides a source.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.mon_detect_english_district_leak()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cnt    bigint;
  v_sample jsonb;
  v_open   boolean;
  n int := 0;
begin
  -- Latin letters in a live card's district = the invariant is broken. Should always be 0.
  select count(*),
         jsonb_agg(distinct platform) filter (where platform is not null)
    into v_cnt, v_sample
  from public.search_listings_ar
  where district_ar ~ '[A-Za-z]';

  v_open := exists (select 1 from public.alert_event
                    where dedup_key = 'english_district_leak' and resolved_at is null);

  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('english_district_leak','search_index'); end if;   -- self-heal
  elsif not v_open then
    n := n + public.mon_raise('P1','english_district_leak','search_index','english_district_leak',
      jsonb_build_object(
        'count', v_cnt,
        'platforms', coalesce(v_sample,'[]'::jsonb),
        'why','a live card shows a Latin-letter neighbourhood — the resolver must emit canonical Arabic or NULL only (feedback_english-district-to-arabic-mapping-standard)'));
  end if;
  return n;
end $function$;

-- ── wire the new detector into the single run-all entrypoint the routines already call ──
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; j int; k int; l int; m int; edl int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  f := public.mon_detect_stale_refresh();
  g := public.mon_detect_legacy_alert_tables();
  h := public.mon_detect_field_integrity();
  i := public.mon_detect_search_index_freshness();
  j := public.mon_detect_quarantine_growth();
  k := public.mon_detect_registry_orphans();
  l := public.mon_detect_rls_reachability();
  m := public.mon_detect_mass_inactivation();
  edl := public.mon_detect_english_district_leak();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,
    'field_integrity',h,'search_index_freshness',i,'quarantine_growth',j,
    'registry_orphans',k,'rls_reachability',l,'mass_inactivation',m,
    'english_district_leak',edl,'ran_at',now());
end $function$;
