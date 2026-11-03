-- ⚡ 2026-11-02 (alert 4194, P1 since 2026-09-20): check_scraper_freshness() dated a site only by its stored ROWS
-- (max scraped_at / last_seen_at). alhumaidan stores none — all three of its ads are «تم الإيجار» (platform_registry
-- notes) — so «latest» was NULL → coalesce(latest, 'epoch') → «498,216 hours stale», a critical row every 6 h for
-- six weeks, while its crawler ran ok every night (last 2026-11-02 04:31 UTC, «skipped: already_transacted×3»).
-- A site with NO stored row has no row to date: its crawler's own last successful run is the fact. A site that HAS
-- rows is unchanged, so a crawler that runs «ok» yet stops touching its rows is still caught. Needle edit of the
-- live body (no DROP); the mirrored alert resolves once no legacy row lands for 24 h.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.check_scraper_freshness()'::regprocedure);
  if position($x$    select coalesce((select pc.expected_hours from platform_cadence pc where pc.platform = rec.p), 24)$x$ in d) = 0 then
    raise exception 'check_scraper_freshness: expected_hours line not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$    select coalesce((select pc.expected_hours from platform_cadence pc where pc.platform = rec.p), 24)$x$,
    $x$    -- no stored row at all: date the site by its crawler's last ok run, never by the epoch (2026-11-02)
    if latest is null then
      select max(sr.finished_at) into latest from public.scrape_runs sr where sr.platform = rec.p and sr.ok;
    end if;
    select coalesce((select pc.expected_hours from platform_cadence pc where pc.platform = rec.p), 24)$x$);
  execute d;
end
$mig$;

do $chk$
declare v_last timestamptz;
begin
  if position('sr.platform = rec.p and sr.ok' in pg_get_functiondef('public.check_scraper_freshness()'::regprocedure)) = 0 then
    raise exception 'PROOF: the no-row branch did not land';
  end if;
  -- the case that raised for six weeks now dates to a real, recent run
  select max(finished_at) into v_last from public.scrape_runs where platform = 'alhumaidan' and ok;
  if v_last is null or v_last < now() - interval '48 hours' then
    raise exception 'PROOF: alhumaidan has no ok run in 48 h (%), the alert would be right', v_last;
  end if;
end
$chk$;
