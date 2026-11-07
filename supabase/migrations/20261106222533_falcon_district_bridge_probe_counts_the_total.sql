-- 🦅 falcon 2026-11-06: district_bridge_leak:count_parity compared the count chip with a CAPPED row count.
--
-- mon_district_bridge_leak_probe() calls location_search_candidates_ar(..., p_limit := 400) and reported count(*) as
-- «returned», so any حي with more than 400 listings read as «the user is shown a number they cannot reach»: alert
-- district_bridge_leak:count_parity:إشبيلية (21:59 UTC) said results 400 vs chip 1,935, while the search's own
-- total_count for الرياض / إشبيلية is 1,935 = af_eligible_count 1,935 (measured 22:30 UTC). Trap 22: a capped walk is
-- not a count. And the probe's keys were resolved on every sweep that did not claim the daily slot, so each finding
-- lived 30 minutes, then vanished: a real leak would have flapped the same way.
--
-- 1. The probe reports «returned» as the search's own total_count (the 400 rows still feed foreign_rows).
-- 2. On a sweep without the daily slot, the detector keeps its open probe/count_parity keys instead of resolving them.
-- Both are needle edits on the LIVE bodies and fail closed if a line moved. PROOF at apply: إشبيلية's probe total
-- equals its chip. Watched by mon_detect_district_bridge_leak itself (on the roster).
do $mig$
declare d text; n int;
  o1 constant text := 'select r.d, r.c, count(*)::bigint,';
  n1 constant text := 'select r.d, r.c, coalesce(max(x.total_count), 0)::bigint,';
begin
  d := pg_get_functiondef('public.mon_district_bridge_leak_probe()'::regprocedure);
  n := (length(d) - length(replace(d, o1, ''))) / length(o1);
  if n <> 1 then raise exception 'probe: expected the returned-count line once, found %', n; end if;
  execute replace(d, o1, n1);
end
$mig$;

do $mig$
declare d text; n int;
  o2 constant text := '    update public.ops_detector_last_full_run set last_result = n where detector = ''district_bridge_leak'';
  end if;';
  n2 constant text := '    update public.ops_detector_last_full_run set last_result = n where detector = ''district_bridge_leak'';
  else
    -- no behavioural probe this sweep: a probe finding stands until the next probe says otherwise (🦅 2026-11-06)
    live := live || coalesce((select array_agg(a.dedup_key) from public.alert_event a
                                where a.kind = ''district_bridge_leak'' and a.resolved_at is null
                                  and (a.dedup_key like ''district_bridge_leak:probe:%''
                                       or a.dedup_key like ''district_bridge_leak:count_parity:%'')), ''{}''::text[]);
  end if;';
begin
  d := pg_get_functiondef('public.mon_detect_district_bridge_leak()'::regprocedure);
  n := (length(d) - length(replace(d, o2, ''))) / length(o2);
  if n <> 1 then raise exception 'detector: expected the daily-slot block end once, found %', n; end if;
  execute replace(d, o2, n2);
end
$mig$;

do $verify$
declare v_tot bigint; v_chip bigint;
begin
  select max(total_count) into v_tot
    from public.location_search_candidates_ar(p_cities := array['الرياض'], p_districts := array['إشبيلية'], p_limit := 400);
  v_chip := public.af_eligible_count(p_cities := array['الرياض'], p_districts := array['إشبيلية']);
  if v_tot is distinct from v_chip then
    raise exception 'PROOF: إشبيلية total % differs from its chip % — a real count leak, do not ship this as a harness fix', v_tot, v_chip;
  end if;
  if position('max(x.total_count)' in pg_get_functiondef('public.mon_district_bridge_leak_probe()'::regprocedure)) = 0 then
    raise exception 'PROOF: the probe still counts capped rows';
  end if;
end $verify$;
