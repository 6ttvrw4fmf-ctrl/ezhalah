-- ♻️ 2026-11-08: mon_detect_liveness_oracle_untrustworthy judged dealapp's oracle by the share of HTTP 200 rows in
-- dealapp_liveness_detail, but that ledger has NEVER recorded an alive read: its verdicts are only strike / kill /
-- unknown (14 days measured 2026-11-08: 0 alive rows of 99,648). Its «alive rate» was the share of dead-shaped 200s
-- among non-alive rows, and it fell from 23.5% to 6.3% when the sweep went to 4 shards on 11-06 and logged more
-- unknown shells, while the runs themselves read 179-447 alive of every 600 with canaries 1-3/3 live and a bogus id
-- not-alive (scrape_runs dealapp_liveness 11-08). P1 alert 13324 had sat open since 11-05 on that artefact.
-- The detector now measures only ledgers that record alive verdicts (gathern: 20,506 alive rows in 24 h), and counts
-- an alive read by its verdict, not by its status code. A ledger with no alive rows is resolved, not judged: its
-- sweep's own control gate (canary_live / canary_bogus, liveness_trust) is what guards it.
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
  v_logs_alive bigint;
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
       and exists (select 1 from information_schema.columns v
                    where v.table_schema = 'public' and v.table_name = c.table_name
                      and v.column_name = 'verdict')
     order by c.table_name
  loop
    plat := split_part(r.tn, '_', 1);
    k := 'liveness_oracle_untrustworthy:' || r.tn;

    -- A ledger that never records an alive read cannot say what share of reads came back alive.
    execute format($q$select count(*) from public.%I
                       where run_at > now() - interval '14 days' and verdict in ('alive', 'live')$q$, r.tn)
      into v_logs_alive;
    if v_logs_alive = 0 then
      perform public.mon_resolve_key('liveness_oracle_untrustworthy', k);
      continue;
    end if;

    execute format($q$select count(*), count(*) filter (where verdict in ('alive', 'live'))
                        from public.%I where run_at > now() - interval '24 hours'$q$, r.tn)
      into v_probes, v_alive;

    -- Baseline deliberately excludes the last 48h so an ongoing outage cannot drag its own
    -- reference down and silence the alert it should be raising.
    execute format($q$select count(*), count(*) filter (where verdict in ('alive', 'live'))
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
