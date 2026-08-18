-- Data Integrity run #29 follow-up (owner-directed deep audit of the unlocated cohort).
--
-- listing_native_location_v2's `udid` lateral infers a CITY from a district name alone, for rows
-- that have no city and no region, accepting the match when
--   HAVING count(DISTINCT d.city_id) = 1
-- i.e. "this district name appears exactly once in loc_catalog_district".
--
-- That premise is false. The district catalog holds 3,883 districts across **161 of 4,582 cities —
-- 3.5% coverage**. "Appears once" therefore measures our own incompleteness, not real-world
-- uniqueness, and the failure is not theoretical:
--
--   «الياسمين»   1 catalog row  -> رماح        (it is also a well-known Riyadh district)
--   «المحمدية»   1 catalog row  -> بلجرشي      (also Jeddah, Riyadh, …)
--   «الإسكان»    1 catalog row  -> العلا       (generic: "the housing", found in many towns)
--   «الغروب»     1 catalog row  -> الرياض
--   «النرجس»     0 catalog rows               (a major Riyadh district we simply do not hold)
--
-- So a Riyadh apartment whose only location text is «الياسمين» would be filed under رماح and shown
-- to users as such. That is manufacturing a location, which the source-truth rule forbids outright —
-- and it is worse than leaving the listing unlocated, because a wrong city is served with
-- confidence while an unlocated one is honestly absent from city search.
--
-- This was found while auditing the 392 unlocated listings: 11 of them looked "recoverable" by
-- exactly this rule, and adjudicating them row by row showed every one would have been assigned a
-- city the source never published.
--
-- MEASURED IMPACT OF DISABLING: **zero rows today.** No production listing currently draws its city
-- from this path (verified against a full pre-image snapshot below). This is removing a loaded gun,
-- not changing what users see.
--
-- Kept as a DATA-DRIVEN gate rather than deleted, so re-enabling is a one-row change if the district
-- catalog ever reaches real coverage — and so a detector can watch the flag instead of watching a
-- diff. The sibling paths are unaffected and were checked: resolve_aqar_locations joins the district
-- catalog CONSTRAINED to an already-resolved city (d.city_id = cc.city_id), and
-- resolve_dealapp_districts only labels the district of rows that are already production_ready with
-- a known city. Neither infers a city from a district; only `udid` did.

create table if not exists public.ops_location_inference_flags (
  name        text primary key,
  enabled     boolean not null,
  reason      text not null,
  decided_at  timestamptz not null default now()
);

insert into public.ops_location_inference_flags (name, enabled, reason)
values ('district_only_city_inference', false,
        'Disabled by data-integrity run #29 (2026-08-18). Inferring a city from a district name '
        'alone is only sound if the district catalog is complete; it covers 161 of 4,582 cities '
        '(3.5%), so "unique district name" measures our gaps, not reality — «الياسمين» resolves to '
        'رماح while Riyadh''s district of the same name is not held at all. Zero production rows '
        'depended on this path when it was disabled. Re-enable ONLY with evidence of real catalog '
        'coverage, and expect mon_detect_district_only_city_inference to go red the moment it is '
        'flipped on.')
on conflict (name) do nothing;

comment on table public.ops_location_inference_flags is
  'Gates for location INFERENCES that go beyond what a source published. Default posture is off: an '
  'inference must earn its place with evidence. Read by listing_native_location_v2.';

-- ── Gate the udid lateral, spliced from the LIVE definition ────────────────────────────────────
do $$
declare
  src text; newsrc text; n int;
  anchor constant text :=
    'WHERE v1.city_ar IS NULL AND v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL AND d.district_norm = normalize_ar(v1.district_ar)';
  replacement constant text :=
    'WHERE (EXISTS (SELECT 1 FROM ops_location_inference_flags f WHERE f.name = ''district_only_city_inference'' AND f.enabled)) AND v1.city_ar IS NULL AND v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL AND d.district_norm = normalize_ar(v1.district_ar)';
begin
  select pg_get_viewdef('public.listing_native_location_v2'::regclass, true) into src;
  if src is null then raise exception 'listing_native_location_v2 not found'; end if;
  if position('district_only_city_inference' in src) > 0 then
    raise notice 'already gated - no-op'; return;
  end if;

  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'udid anchor appears % times, expected exactly 1 - refusing to splice', n; end if;

  newsrc := replace(src, anchor, replacement);
  if position('district_only_city_inference' in newsrc) = 0 then
    raise exception 'splice produced no gate - refusing';
  end if;
  -- the rest of the view must be untouched: exactly one substitution, same length delta
  if length(newsrc) - length(src) <> length(replacement) - length(anchor) then
    raise exception 'splice changed more than the single anchor - refusing';
  end if;

  execute 'create or replace view public.listing_native_location_v2 as ' || newsrc;
end $$;

-- ── Prove it moved nothing ─────────────────────────────────────────────────────────────────────
do $$
declare lost int; gained int; changed int;
begin
  select count(*) into lost from public.listing_native_location_v2 v
    join public.ops_v2_snapshot_run29b s on s.source_table=v.source_table and s.listing_id=v.listing_id
   where s.city_id is not null and v.city_id is null;
  select count(*) into gained from public.listing_native_location_v2 v
    join public.ops_v2_snapshot_run29b s on s.source_table=v.source_table and s.listing_id=v.listing_id
   where s.city_id is null and v.city_id is not null;
  select count(*) into changed from public.listing_native_location_v2 v
    join public.ops_v2_snapshot_run29b s on s.source_table=v.source_table and s.listing_id=v.listing_id
   where s.city_id is not null and v.city_id is not null and s.city_id <> v.city_id;

  if lost <> 0 or gained <> 0 or changed <> 0 then
    raise exception 'expected a no-op, got lost=% gained=% changed=%', lost, gained, changed;
  end if;
end $$;

-- ── Barrier: the inference must not come back silently ─────────────────────────────────────────
create or replace function public.mon_detect_district_only_city_inference()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; flag_on bool; live_rows int; sample jsonb;
begin
  select coalesce(bool_or(enabled), false) into flag_on
    from public.ops_location_inference_flags where name = 'district_only_city_inference';

  -- Rows whose city can only have come from a district name: no city and no region upstream.
  select count(*) into live_rows
    from public.listing_native_location_v1 v1
    join public.search_listings_ar s
      on s.source_table = v1.source_table and s.listing_id = v1.listing_id
   where v1.city_id is null and v1.city_ar is null and v1.region_id is null
     and v1.district_ar is not null and s.city_id is not null
     and not exists (select 1 from public.listings_arabic_locations l
                      where l.source_table = s.source_table and l.listing_id = s.listing_id
                        and l.matched and l.city_ar is not null);

  if flag_on or live_rows > 0 then
    select jsonb_agg(x) into sample from (
      select s.source_table, s.listing_id, v1.district_ar, s.city_ar, s.city_id
        from public.listing_native_location_v1 v1
        join public.search_listings_ar s
          on s.source_table = v1.source_table and s.listing_id = v1.listing_id
       where v1.city_id is null and v1.city_ar is null and v1.region_id is null
         and v1.district_ar is not null and s.city_id is not null
         and not exists (select 1 from public.listings_arabic_locations l
                          where l.source_table = s.source_table and l.listing_id = s.listing_id
                            and l.matched and l.city_ar is not null)
       limit 20) x;

    n := public.mon_raise('P1', 'district_only_city_inference', 'all', 'district_only_city_inference',
      jsonb_build_object(
        'flag_enabled', flag_on,
        'rows_with_district_only_city', live_rows,
        'sample', sample,
        'why', 'A listing is being given a CITY that its source never published, inferred from a '
               'district name alone. loc_catalog_district covers 161 of 4,582 cities (3.5%), so a '
               'district name appearing once in it measures our own gaps: «الياسمين» maps to رماح '
               'while Riyadh''s district of that name is not held at all. A wrong city served with '
               'confidence is worse than an honestly unlocated listing.',
        'do_not', 'Do NOT resolve this by adding just the districts you happen to need - that '
                  'recreates the same false uniqueness one row at a time. Either the source publishes '
                  'a city/region, or the listing stays unlocated.'));
  else
    perform public.mon_resolve_key('district_only_city_inference', 'district_only_city_inference');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_district_only_city_inference() is
  'P1. Fires if the district-only city inference is re-enabled (ops_location_inference_flags) or if '
  'any served listing has a city that could only have come from a district name. Added by run #29 '
  'after the unlocated-cohort audit found 11 listings that would have been assigned a city the '
  'source never published - «الياسمين»->رماح, «المحمدية»->بلجرشي, «الإسكان»->العلا - purely because '
  'the district catalog covers 3.5% of cities. Zero rows depended on the inference when it was '
  'disabled.';

do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_district_only_city_inference''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then raise exception 'mon_run_all_detectors not found - refusing to wire blindly'; end if;
  if position('mon_detect_district_only_city_inference' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1', (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1', before_n, after_n;
  end if;
  if position('mon_detect_district_only_city_inference' in src) = 0
     or position('mon_detect_english_overlay_stranded_city' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;
  execute src;
end
$do$;

drop table if exists public.ops_v2_snapshot_run29b;
