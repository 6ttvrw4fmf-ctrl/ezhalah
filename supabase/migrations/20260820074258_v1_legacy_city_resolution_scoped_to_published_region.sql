-- Data Integrity run #33 (2026-08-20).
--
-- DEFECT: listing_native_location_v1's `legacy` CTE resolved a city NAME against
-- loc_catalog_city with NO region predicate:
--     LEFT JOIN loc_catalog_city cc ON cc.city_norm = normalize_ar(lal_1.city_ar)
-- while listings_arabic_locations ALREADY carries the region the resolver matched
-- (lal_1.region_ar), sitting unused one column away. For a place name that repeats
-- across regions (الهفوف, المجمعة, القويعية, الباحة, البدائع, بيش, تربة, ...) this
-- emitted several candidate rows, all at priority 2, and `best`'s
--     DISTINCT ON (platform, listing_id) ... ORDER BY priority
-- has no tiebreaker -- so the homonym was picked ARBITRARILY and non-deterministically.
--
-- 810 production_ready listings were filed in a region their own source contradicts.
-- Proven live against the source's own schema.org block (4/4 probed):
--   aqarcity 30611 -> الاحساء / المنطقة الشرقية      (we said منطقة الرياض)
--   aqarcity 29809 -> الشيحيه / منطقة حائل           (we said المنطقة الشرقية)
--   aqarcity 29743 -> تربة / منطقة حائل              (we said منطقة مكة المكرمة)
--   aqarcity 27595 -> ملح / منطقة المدينة المنورة    (we said منطقة مكة المكرمة)
-- and against aqar's own URL slugs, e.g.
--   .../الهفوف/...-مدينة-الاحساء-المنطقة-الشرقية-6597312  filed under منطقة الرياض.
-- Users could not reach these listings in their true city, and saw them in a wrong one.
--
-- This is 24a -- "unambiguous inside the region the source published" -- applied at the one
-- stage that still ignored it. The anti-ambiguity protection MOVES rather than disappears:
-- `having count(distinct city_id) = 1` inside the published region. A name ambiguous even
-- inside its own region falls through unchanged.
--
-- STRICTLY MONOTONIC BY CONSTRUCTION: the region-scoped lateral only REPLACES the answer
-- when exactly one city exists inside the published region. Otherwise the old unscoped
-- behaviour stands, made deterministic (ORDER BY city_id -- the value production already
-- had: search_listings_ar holds 664 of {664,828} for الدرعية, 1301 of {1301,1514} for بيشة).
--
-- Second edit, same bug class: `best` gains ORDER BY ..., ranked.source_method, so a listing
-- present in two priority-1 branches stops re-rolling its winner on every rebuild (97 satel
-- listings sit in both the satel native branch and phasea_shadow_resolution).
--
-- MEASURED against a control matview built from the UNCHANGED definition at the SAME instant
-- (a two-snapshot diff was contaminated by the 10-minute resolver crons 25/41/54/61):
--   identical row sets (0 only-ctrl, 0 only-new)
--   810 rows region-repaired (6 platforms)
--   121 rows same-region churn between duplicate catalog entries (now deterministic)
--    51 satel rows phasea -> native_scraper: 32 GAIN a district, 0 lose one
--     0 cities lost, 0 production_ready lost, 0 city_ar changed, 0 transaction_type changed
--
-- The matview was rebuilt out-of-line (listing_native_location_v1_new, populated and indexed
-- while nothing depended on it); this migration is the short swap. v2 and its three dependent
-- views are captured live and recreated verbatim -- never hand-copied.
do $swap$
declare
  v2def text; v2comment text; n_new bigint; probe int;
  kids text[] := array['platforms_unsearchable','platforms_deprecated_status','mon_search_index_city_drift'];
  kiddefs jsonb := '{}'::jsonb;
  k text; pass int; remaining text[]; failed text[];
begin
  select pg_get_viewdef('listing_native_location_v2'::regclass, true) into v2def;
  if v2def is null or length(v2def) < 5000 then
    raise exception 'v2 definition missing or suspiciously short (%)', coalesce(length(v2def), -1);
  end if;
  select obj_description('listing_native_location_v2'::regclass, 'pg_class') into v2comment;

  foreach k in array kids loop
    kiddefs := kiddefs || jsonb_build_object(k, pg_get_viewdef(('public.'||k)::regclass, true));
  end loop;

  select count(*) into n_new from public.listing_native_location_v1_new;
  if n_new < 200000 then raise exception 'candidate matview too small: % rows', n_new; end if;
  if (select count(*) from pg_indexes where tablename = 'listing_native_location_v1_new') <> 7 then
    raise exception 'candidate matview does not carry all 7 indexes';
  end if;

  foreach k in array kids loop
    execute format('drop view public.%I', k);
  end loop;
  drop view public.listing_native_location_v2;
  drop materialized view public.listing_native_location_v1;

  alter materialized view public.listing_native_location_v1_new rename to listing_native_location_v1;
  alter index lnl_v1_pk_new                     rename to lnl_v1_pk;
  alter index idx_lnl_v1_norm_city_purpose_new  rename to idx_lnl_v1_norm_city_purpose;
  alter index lnl_v1_city_purpose_new           rename to lnl_v1_city_purpose;
  alter index lnl_v1_district_new               rename to lnl_v1_district;
  alter index lnl_v1_region_ready_new           rename to lnl_v1_region_ready;
  alter index lnl_v1_platform_updated_new       rename to lnl_v1_platform_updated;
  alter index lnl_v1_source_table_new           rename to lnl_v1_source_table;

  execute 'create view public.listing_native_location_v2 as ' || v2def;
  execute 'grant all on public.listing_native_location_v2 to anon, authenticated, service_role';
  if v2comment is not null then
    execute format('comment on view public.listing_native_location_v2 is %L', v2comment);
  end if;

  -- recreate dependents; retry so inter-view ordering cannot matter
  remaining := kids;
  for pass in 1..3 loop
    failed := array[]::text[];
    foreach k in array remaining loop
      begin
        execute format('create view public.%I as %s', k, kiddefs->>k);
        execute format('grant all on public.%I to anon, authenticated, service_role', k);
      exception when others then
        failed := failed || k;
      end;
    end loop;
    remaining := failed;
    exit when cardinality(remaining) = 0;
  end loop;
  if cardinality(remaining) > 0 then
    raise exception 'could not recreate dependent views: %', remaining;
  end if;

  execute 'select 1 from public.listing_native_location_v2 limit 1' into probe;
  if probe is distinct from 1 then raise exception 'rebuilt v2 is not queryable'; end if;
end $swap$;

comment on materialized view public.listing_native_location_v1 is
  'Native/legacy location resolution per listing. The legacy branch resolves a city name '
  'INSIDE the region listings_arabic_locations already matched (rule 24a); a globally-unique '
  'fallback applies only when no single city exists in that region. best() breaks ties on '
  'source_method so two priority-1 branches cannot re-roll a winner between rebuilds. '
  'Run #33 (2026-08-20): 810 listings were filed in a region their own source contradicted.';
