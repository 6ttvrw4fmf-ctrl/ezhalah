-- mon_detect_stale_active_fraction: a listing PROVEN ALIVE by a direct read in the last 7 days is not stale (2026-11-03,
-- backlog 1262).
--
-- The detector counted «stale» as last_seen_at < 7 days — the CRAWLER's sighting. AGENTS.md: "seen by the crawler"
-- (last_seen_at) is a different fact from "proven alive" (last_verified_alive_at, writable only through
-- liveness_contract.py). On STREAM platforms the crawler never re-reads an old post by design (haraj reads hourly sitemap
-- files of NEW posts), and the daily direct revisit (fleet_liveness.py, FLEET_DAILY_DIRECT) is what proves the rest
-- alive. Measured 2026-11-03: haraj_residential 14,902 active, 12,285 not crawler-seen in 7 days, 14,900 directly proven
-- alive in the last 48 h, 2 with neither; muhaysini_residential 18,785 / 7,024 / 18,785 / 0; muhaysini_commercial
-- 582 / 266 / 582 / 0; haraj_commercial 1,079 / 890 / 1,079 / 0. The P1 «80% dead» was a count of live, verified ads.
-- A row is now stale only when NEITHER fact is fresh (greatest of the two). A table without last_verified_alive_at keeps
-- the old rule exactly (checked per table, never a silent skip). Nothing else changes.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.mon_detect_stale_active_fraction()'::regprocedure);
  if position($x$execute format('select count(*) filter (where active), count(*) filter (where active and last_seen_at < now()-interval ''7 days'') from public.%I', rec.tn)$x$ in d) = 0 then
    raise exception 'mon_detect_stale_active_fraction: count line not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$execute format('select count(*) filter (where active), count(*) filter (where active and last_seen_at < now()-interval ''7 days'') from public.%I', rec.tn)$x$,
    $x$execute format('select count(*) filter (where active), count(*) filter (where active and %s < now()-interval ''7 days'') from public.%I',
        case when exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = rec.tn
                            and c.column_name = 'last_verified_alive_at')
             then 'greatest(last_seen_at, last_verified_alive_at)' else 'last_seen_at' end,  -- proof of life counts (2026-11-03)
        rec.tn)$x$);
  execute d;
end
$mig$;