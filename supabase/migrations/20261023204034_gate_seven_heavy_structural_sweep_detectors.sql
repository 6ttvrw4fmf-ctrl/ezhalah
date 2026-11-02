-- 🦅 Falcon 2026-10-23 (backlog 327, open since 10-09): the next seven heaviest hourly-sweep detectors move behind
-- the sanctioned ~20 h gate, the same way the 2026-10-09 gate migration moved the first three.
--
-- Measured over the last 24 sweeps (ops_detector_timing, 2026-10-22 → 10-23), average per sweep:
-- buy_rent_combined_exactness 25.6 s, shared_default_pin 19.1 s, wasalt_street_width_misread 17.7 s,
-- age_resolver_platform_gap 16.3 s, phasea_offregion_pick 14.1 s, city_identity_contract 10.1 s,
-- city_resolution_ignores_region 9.4 s — about 112 s of a ~350 s sweep that runs at :59 every hour on a 2-vCPU
-- database. ops_search_latency_sample put the customer search mean at 2.1–3.5 s in the 20:1x–20:3x window today.
-- All seven check STRUCTURE (resolver contracts, index shapes, parser invariants) that changes at crawl speed, not
-- minute by minute, and nothing repairs on their alerts within the hour. search_index_freshness and cron_health
-- stay hourly: they are liveness. sync_pass_left_rows_unindexed stays untouched: another change to it is pending.
--
-- Needle edit, fail closed: each live body has exactly one column-0 «begin» line (checked before writing); the gate
-- goes in as its first statement. Missing function, an overload, an existing gate, or an anchor count other than 1
-- → refuse. mon_detect_stalled_daily_detector watches every gated detector through ops_detector_last_full_run.

do $mig$
declare
  fn text;
  src text;
  n int;
  anchor constant text := E'\nbegin\n';
begin
  foreach fn in array array[
    'mon_detect_buy_rent_combined_exactness',
    'mon_detect_shared_default_pin',
    'mon_detect_wasalt_street_width_misread',
    'mon_detect_age_resolver_platform_gap',
    'mon_detect_phasea_offregion_pick',
    'mon_detect_city_identity_contract',
    'mon_detect_city_resolution_ignores_region'
  ] loop
    if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = fn) <> 1 then
      raise exception '% is missing or overloaded; refusing', fn;
    end if;
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;
    if position('mon_claim_daily_slot' in src) > 0 then
      raise exception '% is already gated; refusing to gate twice', fn;
    end if;
    n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
    if n <> 1 then
      raise exception '% anchor found % times (expected 1); refusing to rewrite', fn, n;
    end if;
    src := replace(src, anchor,
      E'\nbegin\n'
      || E'  -- ~20h gate (Falcon 2026-10-23, backlog 327): see the migration header. Watched by\n'
      || E'  -- mon_detect_stalled_daily_detector so this gate cannot silently wedge shut.\n'
      || format(E'  if not public.mon_claim_daily_slot(%L) then\n    return 0;\n  end if;\n', fn));
    execute src;
  end loop;
end $mig$;

-- Verify the rewrite took, by execution of the same predicate the loop used.
do $chk$
declare fn text; src text;
begin
  foreach fn in array array[
    'mon_detect_buy_rent_combined_exactness',
    'mon_detect_shared_default_pin',
    'mon_detect_wasalt_street_width_misread',
    'mon_detect_age_resolver_platform_gap',
    'mon_detect_phasea_offregion_pick',
    'mon_detect_city_identity_contract',
    'mon_detect_city_resolution_ignores_region'
  ] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;
    if position(format('mon_claim_daily_slot(%L)', fn) in src) = 0 then
      raise exception 'post-check: % is not gated after the rewrite', fn;
    end if;
  end loop;
end $chk$;
