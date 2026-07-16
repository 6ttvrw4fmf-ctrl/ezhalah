-- RECOVERED FROM PRODUCTION 2026-07-16: this migration was applied directly to prod (via
-- MCP/psql) without being committed — recovered verbatim from
-- supabase_migrations.schema_migrations so a clean clone reconstructs the real schema. Do not
-- edit. See the 2026-07-16 search outage (PGRST203 ambiguous overload) this drift caused.
-- CORRECTION (same day, forensics finding): max(scraped_at) is the WRONG freshness signal —
-- scraped_at has DEFAULT now() and is never refreshed by upserts (except satel/eastabha), so it
-- measures "newest NEW listing id", which for tiny boutique sources is legitimately weeks old.
-- 15 of the 17 "stale" platforms were actually writing every day (max(last_seen_at) = today).
-- The correct data-level signal is "did the scraper touch this platform's rows recently" =
-- greatest(max(scraped_at), max(last_seen_at)).
CREATE OR REPLACE FUNCTION public.check_scraper_freshness()
RETURNS TABLE(platform text, last_scraped_at timestamptz, hours_stale numeric, expected_hours int, severity text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare rec record; t text; m timestamptz; latest timestamptz; exp int; hs numeric; sev text;
begin
  for rec in
    select regexp_replace(tablename,'_(residential|commercial)_listings$','') as p,
           array_agg(tablename) as tabs
    from pg_tables
    where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'deal\_%'
    group by 1
  loop
    latest := null;
    foreach t in array rec.tabs loop
      execute format('select greatest(max(scraped_at), max(last_seen_at)) from public.%I', t) into m;
      if m is not null and (latest is null or m > latest) then latest := m; end if;
    end loop;
    select coalesce((select pc.expected_hours from platform_cadence pc where pc.platform = rec.p), 24)
      into exp;
    hs := round((extract(epoch from (now() - coalesce(latest, 'epoch'::timestamptz))) / 3600.0)::numeric, 1);
    if hs > 2 * exp then
      sev := case when hs > 6 * exp then 'critical' else 'warning' end;
      insert into scraper_freshness_alerts(platform, last_scraped_at, hours_stale, expected_hours, severity)
      values (rec.p, latest, hs, exp, sev);
      platform := rec.p; last_scraped_at := latest; hours_stale := hs; expected_hours := exp; severity := sev;
      return next;
    end if;
  end loop;
end
$function$;