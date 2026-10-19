-- PROVEN-SILENT DISTRICT PROOF ROWS, batch 4 (2026-10-18): ashab.
-- Every ashab unit page prints one location line, «location_on CITY[،DISTRICT][،PLAN]», and scrapers/ashab/run.py takes
-- the district from its second slot when that slot is not a plan number. The rows below are the ones whose line holds
-- the CITY only, or the city and a PLAN number — read live 2026-10-18 23:20 UTC: /properties/1119/unit/1182 «location_on
-- بريدة», /properties/840/unit/773 «location_on بريدة،ق/ب/6660», /properties/740/unit/623 «location_on الدليمية،559/ق»,
-- and no «حي» anywhere on those pages — and whose title and description carry no «حي». Every row was seen today.
-- Rows are excused per listing; a new blank row is not.
set local lock_timeout = '5s';

insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof, decided_by)
select 'ashab', a.tbl, a.id,
       'ashab: the unit''s location line names the city (and a plan number) only, and the ad names no «حي»',
       'unit page: the «location_on …» line (city، district، plan), the title, the description',
       '2026-10-18 read: /properties/1119/unit/1182 «location_on بريدة»; /properties/840/unit/773 «location_on بريدة،ق/ب/6660»; '
         || '/properties/740/unit/623 «location_on الدليمية،559/ق»; no «حي» on the pages. This unit: '
         || regexp_replace(a.listing_url, '^https?://[^/]+', ''),
       'district engineer 2026-10-18 (page read)'
  from (select 'ashab_residential_listings' tbl, id, district_ar, neighborhood, title, description, listing_url, active, last_seen_at
          from public.ashab_residential_listings
        union all
        select 'ashab_commercial_listings', id, district_ar, neighborhood, title, description, listing_url, active, last_seen_at
          from public.ashab_commercial_listings) a
 where a.active and coalesce(a.district_ar, '') = '' and coalesce(a.neighborhood, '') = ''
   and a.last_seen_at > timestamptz '2026-10-18 00:00+00'
   and coalesce(a.title, '') || ' ' || coalesce(a.description, '') !~ '(^|[^ء-ي])(ب|و|ل)?(حي|الحي)\s'
   and not public.district_blank_is_excused('ashab', a.tbl, a.id);
