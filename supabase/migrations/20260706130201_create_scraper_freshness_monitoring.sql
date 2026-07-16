-- RECOVERED FROM PRODUCTION 2026-07-16: this migration was applied directly to prod (via
-- MCP/psql) without being committed — recovered verbatim from
-- supabase_migrations.schema_migrations so a clean clone reconstructs the real schema. Do not
-- edit. See the 2026-07-16 search outage (PGRST203 ambiguous overload) this drift caused.
-- DATA-LEVEL scraper freshness monitoring (owner 2026-07-06).
-- Root problem it solves: pg_cron only records that the GitHub-Actions DISPATCH call succeeded —
-- the downstream workflow can fail or no-op silently (proven: ~14 small-source platforms sat stale
-- 2-15 days behind a green cron). This check looks at the DATA instead: per platform, the newest
-- scraped_at across its raw tables vs the platform's expected cadence. If data is >2x overdue, an
-- alert row is written — visible from the DB regardless of what any scheduler claims.

CREATE TABLE public.platform_cadence (
  platform text PRIMARY KEY,
  expected_hours int NOT NULL,
  note text
);
-- Defaults: 24h for everything; explicit overrides for the known non-daily platforms.
INSERT INTO public.platform_cadence(platform, expected_hours, note) VALUES
  ('aqar',      8,   '8-hourly sweep (jobids 2/3)'),
  ('wasalt',    8,   '8-hourly sweep (jobids 4/5)'),
  ('muktamel',  168, 'weekly (jobid 14)'),
  ('gathern',   24,  'daily (jobid 15)'),
  ('aqarmonthly', 24, 'daily (jobid 23)');

CREATE TABLE public.scraper_freshness_alerts (
  id bigserial PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  platform text NOT NULL,
  last_scraped_at timestamptz,
  hours_stale numeric,
  expected_hours int,
  severity text  -- 'warning' (>2x cadence) | 'critical' (>6x cadence)
);

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
      and tablename not like 'deal\_%'          -- deprecated platform, merged into dealapp
    group by 1
  loop
    latest := null;
    foreach t in array rec.tabs loop
      execute format('select max(scraped_at) from public.%I', t) into m;
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

-- Every 6 hours — staleness moves slowly; hourly would just spam identical alert rows.
select cron.schedule(
  'scraper-freshness-check',
  '10 */6 * * *',
  $$select public.check_scraper_freshness();$$
);