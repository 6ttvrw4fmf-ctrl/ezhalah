-- Refresh-COVERAGE detector (2026-08-09).
--
-- WHY: check_scraper_freshness() measures greatest(max(scraped_at), max(last_seen_at)) over the
-- WHOLE table — "did ANY row get seen recently?". That question cannot see an enumeration collapse.
-- Dealapp proved it live: its crawl re-saw 360 / 249 / 97 / 172 rows a day out of 7,143 active
-- (~2-5%), then 0 rows on 2026-08-08 (run finished_at NULL) and 0 again on 2026-08-09
-- (ok=false, "0-row run (blocked/empty source?)"). 5,242 of 7,143 active rows had not been re-seen
-- in 3 days. Freshness alerts fired in that window: ZERO — because one fresh row kept max()
-- current and hours_stale never crossed 2x expected_hours.
--
-- This detector asks the coverage question instead: what FRACTION of the active population was
-- re-seen inside the platform's own expected window (x3, so a daily crawler gets 3 days of slack).
-- It is DETECT-ONLY by design and deliberately deactivates nothing — dealapp is exactly the
-- platform where a blocked crawl must never be allowed to look like mass death
-- (see mark_stale_listings_inactive, detect-only since PR#256, and the prune safety guard).
CREATE TABLE IF NOT EXISTS public.mon_refresh_coverage_alerts (
  id            bigserial PRIMARY KEY,
  platform      text        NOT NULL,
  active_rows   bigint      NOT NULL,
  refreshed     bigint      NOT NULL,
  coverage_pct  numeric     NOT NULL,
  window_hours  int         NOT NULL,
  severity      text        NOT NULL,
  checked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mon_refresh_coverage_alerts_checked_idx
  ON public.mon_refresh_coverage_alerts (checked_at DESC);

CREATE OR REPLACE FUNCTION public.mon_detect_refresh_coverage()
 RETURNS TABLE(platform text, active_rows bigint, refreshed bigint,
               coverage_pct numeric, window_hours int, severity text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rec record; t text; win int; a bigint; r bigint; tot_a bigint; tot_r bigint; pct numeric; sev text;
begin
  for rec in
    select regexp_replace(tablename,'_(residential|commercial)_listings$','') as p,
           array_agg(tablename) as tabs
    from pg_tables
    where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
    group by 1
  loop
    -- same opt-out contract as check_scraper_freshness(): a platform flagged inactive is not
    -- expected to refresh, so it must not page.
    if exists (select 1 from platform_cadence pc
               where pc.platform = rec.p and pc.is_active = false) then
      continue;
    end if;
    select coalesce((select pc.expected_hours from platform_cadence pc where pc.platform = rec.p), 24) * 3
      into win;
    tot_a := 0; tot_r := 0;
    foreach t in array rec.tabs loop
      execute format(
        'select count(*), count(*) filter (where last_seen_at > now() - make_interval(hours => %s))
           from public.%I where active', win, t) into a, r;
      tot_a := tot_a + coalesce(a,0); tot_r := tot_r + coalesce(r,0);
    end loop;
    -- Too small to reason about; a 9-row platform swings between 0% and 100% on one listing.
    if tot_a < 50 then
      continue;
    end if;
    pct := round(100.0 * tot_r / tot_a, 1);
    if pct < 50 then
      sev := case when pct < 20 then 'critical' else 'warning' end;
      insert into public.mon_refresh_coverage_alerts
        (platform, active_rows, refreshed, coverage_pct, window_hours, severity)
      values (rec.p, tot_a, tot_r, pct, win, sev);
      platform := rec.p; active_rows := tot_a; refreshed := tot_r;
      coverage_pct := pct; window_hours := win; severity := sev;
      return next;
    end if;
  end loop;
end $function$;

select cron.schedule(
  'mon-refresh-coverage',
  '25 6 * * *',
  $$select public.mon_detect_refresh_coverage();$$
);
