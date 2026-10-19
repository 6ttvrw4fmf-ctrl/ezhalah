-- mon_detect_rows_collapse: judge CRAWL labels only (backlog 646, 2026-10-19).
-- A liveness / cleanup / verify-deletions job writes rows_seen = the rows it PROBED, and it probes only the
-- rows its crawl did not just see (aqalemhajer 10-18: «active=1057 probed=18 fresh=1039»). A healthy crawl
-- therefore makes that number SHRINK, and the detector read it as a collapse: 18 of the 20 open rows_collapse
-- P1s on 2026-10-19 were such labels (fleet_liveness:aqalemhajer ratio 0.121 while the aqalemhajer crawl read
-- 1,091 cards = the site's own printed total). Those jobs keep their own monitors (expected-but-absent runs,
-- coverage ramp, oracle-never-observed). Crawl labels, sharded crawls (dealapp:N/12) and wasalt_enum_shard
-- are still judged; rows_collapse:dwelleo (catalogue empty at source) stays open.
-- Needle edit of the live body (no DROP, same signature).
do $mig$
declare src text; new_src text;
  needle constant text := E'      select platform, sum(rows_seen)::numeric as rows_3d\n        from public.scrape_runs\n       where started_at >= now() - interval ''3 days''\n       group by platform';
  repl constant text := E'      select platform, sum(rows_seen)::numeric as rows_3d\n        from public.scrape_runs\n       where started_at >= now() - interval ''3 days''\n         -- probe jobs count PROBES, not inventory: a healthy crawl shrinks them (backlog 646)\n         and platform !~ ''^(fleet_liveness|cleanup|verify_deletions|aqar_liveness|aqar_liveness_recheck):''\n       group by platform';
begin
  src := pg_get_functiondef('public.mon_detect_rows_collapse()'::regprocedure);
  if position(needle in src) = 0 then
    raise exception 'mon_detect_rows_collapse: needle not found, live body changed';
  end if;
  new_src := replace(src, needle, repl);
  execute new_src;
end $mig$;

do $chk$
declare src text := pg_get_functiondef('public.mon_detect_rows_collapse()'::regprocedure);
begin
  if position('fleet_liveness|cleanup|verify_deletions|aqar_liveness|aqar_liveness_recheck' in src) = 0 then
    raise exception 'check failed: probe-label exclusion missing';
  end if;
  if position('mon_resolve_stale_keys(''rows_collapse'', live)' in src) = 0 then
    raise exception 'check failed: stale-key resolution lost';
  end if;
end $chk$;
