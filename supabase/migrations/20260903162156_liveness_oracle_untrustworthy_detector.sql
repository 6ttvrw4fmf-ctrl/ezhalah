-- A gate that refuses to act on a degraded oracle is only half the answer. Something must SAY the
-- oracle is degraded, or the platform silently stops being verifiable and nobody finds out.
--
-- THE INCIDENT (2026-09-01..03). gathern's oracle alive-rate held 62-84% for nine days and then
-- collapsed to 3.8 / 0.7 / 0.5% when the source began serving 404s to our egress. Nothing alerted.
-- The sweep kept running, kept reporting ok=true, and inactivated 302 rows on 09-01 and 106 on
-- 09-02 before the anomaly cap finally caught the oversized 09-03 batch. Every count-based and
-- freshness barrier stayed green the whole time, because the crawl WAS healthy — only the oracle's
-- answers had stopped being believable.
--
-- The code-side trust gate (scrapers/common/liveness_trust.py, same 0.20 floor) now stops such a
-- run from striking or killing anything. This detector is the other half: it makes the degraded
-- state VISIBLE, so the egress gets fixed instead of the platform quietly going unverifiable.
--
-- REGRESSION, NEVER AN ABSOLUTE (the run-#85 lesson). A table must have PROVEN it can verify above
-- the floor before falling below it counts as degradation. dealapp from CI egress sits at ~12% by
-- nature (docs/ops/LISTING_LIVENESS.md §5.1) and must not alert forever; gathern fell from 75% and
-- must. Discovery is dynamic over every *_liveness_detail table, so a new platform's oracle is
-- covered the day it starts writing evidence — not the day someone remembers to add it here.
create or replace function public.mon_detect_liveness_oracle_untrustworthy()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n int := 0;
  v_probes bigint; v_alive bigint; v_rate numeric;
  v_base_probes bigint; v_base_alive bigint; v_base_rate numeric;
  k text; plat text;
  trust_floor constant numeric := 0.20;   -- MUST match liveness_trust.MIN_ALIVE_RATE_FOR_TRUST
  min_probes  constant int     := 25;     -- MUST match liveness_trust.MIN_PROBES_FOR_TRUST
begin
  for r in
    select c.table_name tn
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name like '%\_liveness\_detail'
       and c.column_name = 'http_status'
       and exists (select 1 from information_schema.columns d
                    where d.table_schema = 'public' and d.table_name = c.table_name
                      and d.column_name = 'run_at')
     order by c.table_name
  loop
    plat := split_part(r.tn, '_', 1);
    k := 'liveness_oracle_untrustworthy:' || r.tn;

    execute format($q$select count(*), count(*) filter (where http_status = 200)
                        from public.%I where run_at > now() - interval '24 hours'$q$, r.tn)
      into v_probes, v_alive;

    -- Baseline deliberately excludes the last 48h so an ongoing outage cannot drag its own
    -- reference down and silence the alert it should be raising.
    execute format($q$select count(*), count(*) filter (where http_status = 200)
                        from public.%I
                       where run_at > now() - interval '14 days'
                         and run_at <= now() - interval '48 hours'$q$, r.tn)
      into v_base_probes, v_base_alive;

    -- Too little evidence on either side: say nothing rather than guess. An oracle that simply is
    -- not running is a different failure with its own detectors.
    if v_probes < min_probes or v_base_probes < min_probes then
      continue;
    end if;

    v_rate      := v_alive::numeric      / nullif(v_probes, 0);
    v_base_rate := v_base_alive::numeric / nullif(v_base_probes, 0);

    if v_base_rate >= trust_floor and v_rate < trust_floor then
      n := n + public.mon_raise(
        'P1', 'liveness_oracle_untrustworthy', plat, k,
        jsonb_build_object(
          'source_table', r.tn,
          'probes_24h', v_probes,
          'alive_24h', v_alive,
          'alive_rate_24h', round(v_rate, 4),
          'baseline_rate_2_to_14d', round(v_base_rate, 4),
          'trust_floor', trust_floor,
          'why', 'This platform''s liveness oracle used to verify ' ||
                 round(100 * v_base_rate, 1) || '% of its probes alive and now verifies ' ||
                 round(100 * v_rate, 1) || '%. Inventory does not die that fast: the SOURCE has '
                 'stopped answering us truthfully (egress block, fingerprint block, rate-limit '
                 'change). Every 404 in this window is UNKNOWN, not death '
                 '(docs/ops/LISTING_LIVENESS.md §1).',
          'consequence', 'Sweeps are now TRUST-QUARANTINED by scrapers/common/liveness_trust.py: '
                 'they write no strikes and no inactivations, so no false deaths are being '
                 'created. But this platform is NOT being verified while this is open, and its '
                 'rows are drifting into honestly-UNKNOWN.',
          'action', 'Fix the EGRESS (a residential route, as wasalt uses via WASALT_PROXY_URL), '
                 'then re-probe. Once healthy, restore anything wrongly inactivated during the '
                 'window via the platform''s resurrection pass (gathern: liveness --recheck-dead, '
                 'which restores only on a live 200).',
          'do_not', 'Do NOT lower the trust floor, raise anomaly_floor, or force a drain to make '
                 'this green. A backlog that will not drain is evidence about the VERIFIER, not '
                 'permission to delete faster (docs/ops/LISTING_LIVENESS.md §7).'));
    else
      perform public.mon_resolve_key('liveness_oracle_untrustworthy', k);
    end if;
  end loop;

  return n;
end
$function$;

comment on function public.mon_detect_liveness_oracle_untrustworthy() is
  'P1 when a liveness oracle that USED to verify above the 0.20 trust floor now verifies below it '
  '(regression vs its own 2-14d baseline, never an absolute). Mirrors the code-side trust gate in '
  'scrapers/common/liveness_trust.py. Born from the gathern 2026-09-01..03 false-death window.';

-- Roster it in the SAME migration: a detector nothing reaches is decoration (AGENTS.md).
do $roster$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to leave the detector unrostered';
  end if;

  if position('mon_detect_liveness_oracle_untrustworthy' in src) > 0 then
    return;                                   -- already rostered
  end if;

  if position('''mon_detect_detail_capture_collapse''' in src) = 0 then
    raise exception 'roster anchor not found - refusing to guess where to append';
  end if;

  newsrc := replace(src,
    '''mon_detect_detail_capture_collapse''',
    '''mon_detect_detail_capture_collapse'', ''mon_detect_liveness_oracle_untrustworthy''');
  execute newsrc;

  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_liveness_oracle_untrustworthy' in src) = 0 then
    raise exception 'roster append did not take effect';
  end if;
end
$roster$;
