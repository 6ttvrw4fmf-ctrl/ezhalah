-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DESIGN ONLY — NOT APPLIED TO ANY PROJECT. Branch-only artifact for owner review.
-- Investigation basis (aannarbkwcymrotzwdbo, read-only, 2026-07-14): see accompanying report.
--
-- PROBLEM: public.check_scraper_freshness() (created in migration
-- 20260706130201_create_scraper_freshness_monitoring, adjusted in
-- 20260706131008_fix_freshness_check_use_last_seen — both present in Supabase's live migration
-- history but NOT present in this repo's supabase/migrations/ directory, a known drift issue,
-- see memory "Migration history drift + branch-replay broken 2026-07-13") computes freshness
-- ONE ROW PER PLATFORM: it discovers every `<platform>_residential_listings` /
-- `<platform>_commercial_listings` table, takes greatest(max(scraped_at), max(last_seen_at))
-- across ALL rows of that platform (every property_type + transaction_type mixed together), and
-- compares the single resulting timestamp against platform_cadence.expected_hours.
--
-- CONFIRMED LIVE (read-only queries, 2026-07-14 ~12:49 UTC) — this whole-platform average HIDES
-- dead sub-verticals: wasalt_residential_listings platform-level freshness is currently ~4.1h
-- (fine, high-volume slugs like Apartment/Villa/Floor refresh every ~4h), but:
--   • property_type='Farm'         (transaction_type Buy AND Rent): 0 rows in the table, active
--                                  or inactive — the scrape job for this slug is producing
--                                  NOTHING, invisible in the whole-platform max().
--   • property_type='Chalet', transaction_type='Rent':              0 rows, same story.
--   • property_type='Chalet', transaction_type='Buy':                exactly 1 row, scraped_at
--                                  2026-06-21 12:01:29 UTC (23+ days old); last_seen_at is being
--                                  re-touched every ~4h by the liveness/enrich pass revisiting the
--                                  SAME existing URL, which keeps hours_stale looking "fresh"
--                                  (~4.1h) under the current last_seen_at-based formula even
--                                  though the underlying chalet-sale scrape has found zero new
--                                  inventory in over three weeks. See NOTE B below.
--   • property_type='Room', transaction_type='Buy':                  1 row, scraped_at
--                                  2026-07-12 21:59:18 UTC (~38.8h stale at query time; already
--                                  over its would-be 2x-expected_hours=16h warning threshold, but
--                                  today's platform-level check can't see it, it only sees the
--                                  whole-platform max).
-- Prior audit's "chalet-rent, farm-sale, farm-rent dead 6 days" is CONFIRMED directionally, but
-- current state is worse than "stale": these three now have ZERO rows in the table at all
-- (active or inactive) — not merely an old timestamp. Re-verify counts before relying on any
-- specific "6 days" figure; that number was not re-derived here (no historical snapshot queried).
--
-- NOTE A — matrix-to-DB collapsing (IMPORTANT for anyone tuning this): the residential sweep/fill
-- workflows (.github/workflows/wasalt-residential-sweep.yml,
-- .github/workflows/wasalt-residential-fill.yml) run 10 slugs × 2 deals = 20 scrape-job cells:
--   slug: apartment, villa-townhouse, floor, building, land, rest-house, chalet, farm, room, duplex
--   deal: sale, rent
-- but scrapers/wasalt/run.py's TYPE_MAP (line ~63) folds "Duplex" AND "Townhouse" into
-- property_type='Villa' — so the "duplex" scrape-job's health is NOT independently observable at
-- the property_type/transaction_type granularity: if "duplex" silently breaks while
-- "villa-townhouse" keeps working, this design (and the existing whole-platform check) both stay
-- blind to it. Distinct DB-level sub-verticals after TYPE_MAP = 9 property_type values × 2 deals
-- = 18 (Apartment, Villa, Floor, Building, "Residential Land", "Rest House", Chalet, Farm, Room).
-- A 19th combo currently exists in the table — property_type='Palace', transaction_type='Buy',
-- 1 row, scraped_at 2026-06-21 12:43:33 — but "Palace" is NOT a key in TYPE_MAP and is not
-- produced by any of the 10 current slugs; it is a pre-TYPE_MAP legacy artifact, not an active
-- sub-vertical. Recommendation: treat 18 as the correct expected-combo count for wasalt
-- residential; do not silently "discover" Palace/Buy as if it were a live sub-vertical.
--
-- NOTE B — do not derive "expected combos" from GROUP BY over existing rows. A sub-vertical that
-- has gone to truly zero rows (Farm, Chalet-Rent) produces NO group at all in a naive
-- `group by property_type, transaction_type` over the table itself, so it can never be flagged
-- as stale — the exact blind spot this design exists to close. This mirrors how the existing
-- check_scraper_freshness() already handles a whole-platform table with zero rows: it uses
-- coalesce(latest, 'epoch'::timestamptz) against a table it already knows must exist (found via
-- discovering the physical `<platform>_..._listings` tables in pg_tables). The sub-vertical
-- version cannot use that same table-discovery trick (property_type/transaction_type are DATA
-- values, not table names), so it needs an explicit registry of "which (platform, property_type,
-- transaction_type) combos are expected to exist" — seeded by hand, same pattern already used for
-- platform_cadence and ops_expected_jobs. A missing combo compares its (fictional) latest activity
-- against 'epoch' and is therefore always maximally stale until seeded with a real row.
--
-- FOLLOWS THE SAME CONVENTIONS AS THE EXISTING OBJECTS (function name pattern, SECURITY DEFINER +
-- search_path, alerts-table shape/columns, ops_alerts_v1-style union-branch wiring). Naming and
-- file-timestamp format match the two prior scraper_freshness migrations
-- (20260706130201_create_scraper_freshness_monitoring,
-- 20260706131008_fix_freshness_check_use_last_seen) as they exist in Supabase's live migration
-- history (confirmed via list_migrations on aannarbkwcymrotzwdbo) — NOT as they exist in this
-- repo, since neither file is present here (drift).
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── registry: every (platform, property_type, transaction_type) combo the ingestion pipeline is
-- expected to produce, plus its own expected_hours (falls back to platform_cadence when null).
-- Seed ONLY what has been verified against scrapers/wasalt/run.py's TYPE_MAP + the residential
-- sweep matrix (.github/workflows/wasalt-residential-sweep.yml) — do not guess other platforms'
-- slug maps without reading their run.py first.
create table if not exists public.platform_subvertical_cadence (
  platform         text not null,
  property_type    text not null,
  transaction_type text not null,
  expected_hours   integer,          -- null = inherit platform_cadence.expected_hours
  note             text,
  primary key (platform, property_type, transaction_type)
);
alter table public.platform_subvertical_cadence enable row level security;  -- owner/service only

-- Seed: wasalt residential, 9 property_type values (post-TYPE_MAP) × 2 transaction types = 18 rows.
-- Derived from scrapers/wasalt/run.py TYPE_MAP applied to the 10 residential-sweep slugs
-- (villa-townhouse + duplex both collapse into 'Villa' — see NOTE A above, only one row pair
-- seeded for it, not two).
insert into public.platform_subvertical_cadence (platform, property_type, transaction_type, expected_hours, note) values
  ('wasalt', 'Apartment',        'Buy',  null, 'slug=apartment'),
  ('wasalt', 'Apartment',        'Rent', null, 'slug=apartment'),
  ('wasalt', 'Villa',            'Buy',  null, 'slug=villa-townhouse + duplex (TYPE_MAP collapses both to Villa)'),
  ('wasalt', 'Villa',            'Rent', null, 'slug=villa-townhouse + duplex (TYPE_MAP collapses both to Villa)'),
  ('wasalt', 'Floor',            'Buy',  null, 'slug=floor'),
  ('wasalt', 'Floor',            'Rent', null, 'slug=floor'),
  ('wasalt', 'Building',         'Buy',  null, 'slug=building'),
  ('wasalt', 'Building',         'Rent', null, 'slug=building'),
  ('wasalt', 'Residential Land', 'Buy',  null, 'slug=land'),
  ('wasalt', 'Residential Land', 'Rent', null, 'slug=land'),
  ('wasalt', 'Rest House',       'Buy',  null, 'slug=rest-house'),
  ('wasalt', 'Rest House',       'Rent', null, 'slug=rest-house'),
  ('wasalt', 'Chalet',           'Buy',  null, 'slug=chalet'),
  ('wasalt', 'Chalet',           'Rent', null, 'slug=chalet'),
  ('wasalt', 'Farm',             'Buy',  null, 'slug=farm'),
  ('wasalt', 'Farm',             'Rent', null, 'slug=farm'),
  ('wasalt', 'Room',             'Buy',  null, 'slug=room'),
  ('wasalt', 'Room',             'Rent', null, 'slug=room')
on conflict (platform, property_type, transaction_type) do nothing;

-- ── alert log, same shape/conventions as public.scraper_freshness_alerts, +2 grouping columns.
create table if not exists public.scraper_subvertical_freshness_alerts (
  id                bigint generated by default as identity primary key,
  checked_at        timestamptz not null default now(),
  platform          text not null,
  property_type     text not null,
  transaction_type  text not null,
  last_scraped_at   timestamptz,
  hours_stale       numeric,
  expected_hours    integer,
  severity          text
);
alter table public.scraper_subvertical_freshness_alerts enable row level security;  -- owner/service only
create index if not exists idx_scraper_subvertical_freshness_latest
  on public.scraper_subvertical_freshness_alerts (platform, property_type, transaction_type, checked_at desc);

-- ── the check itself. Same warning/critical thresholds (2x / 6x expected_hours) and same
-- coalesce-to-epoch-for-missing-data behavior as check_scraper_freshness(), but driven by the
-- registry table above instead of discovering tables — see NOTE B for why.
create or replace function public.check_scraper_subvertical_freshness()
returns table(platform text, property_type text, transaction_type text,
              last_scraped_at timestamptz, hours_stale numeric, expected_hours integer, severity text)
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  rec record;
  tabs text[];
  t text;
  latest timestamptz;
  m timestamptz;
  exp int;
  hs numeric;
  sev text;
begin
  for rec in
    select psc.platform, psc.property_type, psc.transaction_type, psc.expected_hours as override_hours
    from public.platform_subvertical_cadence psc
  loop
    -- discover this platform's physical residential/commercial tables the same way
    -- check_scraper_freshness() does, then look for this specific (property_type, transaction_type)
    -- slice within them.
    select array_agg(tablename) into tabs
    from pg_tables
    where schemaname = 'public'
      and tablename ~ ('^' || rec.platform || '_(residential|commercial)_listings$');

    latest := null;
    if tabs is not null then
      foreach t in array tabs loop
        execute format(
          'select greatest(max(scraped_at), max(last_seen_at)) from public.%I
             where property_type = $1 and transaction_type = $2', t)
          into m using rec.property_type, rec.transaction_type;
        if m is not null and (latest is null or m > latest) then latest := m; end if;
      end loop;
    end if;

    select coalesce(rec.override_hours,
                     (select pc.expected_hours from public.platform_cadence pc where pc.platform = rec.platform),
                     24)
      into exp;

    hs := round((extract(epoch from (now() - coalesce(latest, 'epoch'::timestamptz))) / 3600.0)::numeric, 1);

    if hs > 2 * exp then
      sev := case when hs > 6 * exp then 'critical' else 'warning' end;
      insert into public.scraper_subvertical_freshness_alerts
        (platform, property_type, transaction_type, last_scraped_at, hours_stale, expected_hours, severity)
      values (rec.platform, rec.property_type, rec.transaction_type, latest, hs, exp, sev);
      platform := rec.platform; property_type := rec.property_type; transaction_type := rec.transaction_type;
      last_scraped_at := latest; hours_stale := hs; expected_hours := exp; severity := sev;
      return next;
    end if;
  end loop;
end
$function$;

-- ── wiring recommendation (NOT applied here — shown for reviewer context only):
--
-- 1) pg_cron, offset 10 minutes after the existing platform-level check (jobid 31, '10 */6 * * *')
--    so the two never race on the same tables:
--      select cron.schedule('subvertical-scraper-freshness-check', '20 */6 * * *',
--        'select public.check_scraper_subvertical_freshness();');
--
-- 2) Add 'subvertical-scraper-freshness-check' to public.ops_expected_jobs (see
--    supabase/migrations/20260709_ops_monitoring_core.sql seed list) so a missing/inactive job
--    itself becomes a cron-source alert in ops_alerts_v1.
--
-- 3) Add one more union arm to public.ops_alerts_v1, mirroring the existing 'scraper_freshness'
--    arm exactly (same distinct-on-latest-row-per-key pattern, same 7-hour is_open window matched
--    to the 6-hour cadence):
--      union all
--      select 'scraper_subvertical_freshness', f.severity,
--             f.platform || ':' || f.property_type || ':' || f.transaction_type,
--             format('stale %sh (expected %sh, last seen %s)',
--                    round(f.hours_stale::numeric, 1), f.expected_hours, f.last_scraped_at::date),
--             null::bigint, f.checked_at,
--             (f.checked_at > now() - interval '7 hours')
--      from (select distinct on (platform, property_type, transaction_type) *
--              from public.scraper_subvertical_freshness_alerts
--             order by platform, property_type, transaction_type, checked_at desc) f
--
-- 4) Grants (mirror scraper_freshness_alerts — service_role only, never anon):
--      revoke all on public.platform_subvertical_cadence from public, anon, authenticated;
--      revoke all on public.scraper_subvertical_freshness_alerts from public, anon, authenticated;
--      revoke all on function public.check_scraper_subvertical_freshness() from public, anon, authenticated;
--      grant select on public.platform_subvertical_cadence to service_role;
--      grant select on public.scraper_subvertical_freshness_alerts to service_role;
--      grant execute on function public.check_scraper_subvertical_freshness() to service_role;
--      notify pgrst, 'reload schema';
--
-- OPEN QUESTION FOR OWNER: extend platform_subvertical_cadence to aqar (also an 8-hourly sweep with
-- its own slug matrix) and other platforms, or ship wasalt-only first since that's the platform
-- with the confirmed live gap? Not decided here.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (if this needs to be undone — additive only, safe to drop cleanly):
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.check_scraper_subvertical_freshness();
--   DROP TABLE IF EXISTS public.scraper_subvertical_freshness_alerts;
--   DROP TABLE IF EXISTS public.platform_subvertical_cadence;
--   COMMIT;
-- (If step 1/2/3/4 of the wiring recommendation above were ALSO applied: first run
-- `select cron.unschedule('subvertical-scraper-freshness-check');`, remove the
-- 'subvertical-scraper-freshness-check' row from ops_expected_jobs, and drop the
-- 'scraper_subvertical_freshness' union arm from ops_alerts_v1, before the DROPs above.)
-- ─────────────────────────────────────────────────────────────────────────────────────────
