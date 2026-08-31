-- DERIVED-STORE REGISTRY — phases 1 + 3 of docs/ops/DERIVED_STORE_FRESHNESS.md (owner-approved
-- 2026-08-31, observability only). This migration changes NOTHING about what users are served: it
-- adds an ops metadata table and a detector. No resolver, view, index or listing row is touched.
--
-- WHY. On 2026-08-31 two per-listing derived stores were found serving listings in the wrong city
-- and the wrong district. Neither had anything watching it, and one of the two monitors that could
-- have caught it (mon_district_contradicts_source) was a VIEW with no detector and no roster entry
-- — it read 6 for weeks while every barrier was green. The lesson generalises: a store that feeds
-- live location resolution and has nothing asking "does this still match the source?" is a defect
-- waiting to be invisible.
--
-- The bug class is NOT "a missing cron job". listings_arabic_locations HAS six scheduled writers
-- and still went stale, because every one is gated `where s.city_id is null` — only unresolved
-- listings — and none of them writes the district at all. A row, once written, is never revisited.
--
-- WHAT IS REGISTERED. Only PER-LISTING derived stores that feed listing_native_location_v1, the
-- resolver behind search_listings_ar. Curated geography catalogs (loc_catalog_*, loc_*_map,
-- loc_city_alias_ar) are deliberately EXCLUDED: they describe Saudi Arabia, not listings, and being
-- static is correct for them.
--
-- HOW A STORE STAYS HONEST. Each row must name either a watcher detector that exists, or an
-- explicit unwatched_reason. A store with neither raises P1. That keeps aqar_shadow_resolved
-- visible without creating an unclearable alert: it genuinely has no valid source oracle today
-- (its city_ar_parsed is Arabic while the listing's own city column is English, so comparing them
-- is meaningless — measured 2026-08-31, a 100% "mismatch" that was purely a language difference),
-- and that fact is recorded rather than forgotten. Same discipline as scripts/test-exclusions.txt:
-- an exclusion must name a reason.
--
-- max_age_hours is intentionally NULL everywhere. Expiry/demotion is phase 4b and needs owner
-- approval; leaving it NULL means "no expiry policy set", which nothing acts on.

create table if not exists public.ops_derived_store_registry (
  store_name              text primary key,
  appears_in_resolver_as  text,        -- the view name the resolver reads, when indirect
  feeds                   text not null,
  writer                  text not null,
  watcher_detector        text,        -- a mon_detect_* that compares this store against SOURCE
  unwatched_reason        text,        -- required when watcher_detector is null
  max_age_hours           integer,     -- phase 4b; NULL = no expiry policy set (nothing acts on it)
  note                    text,
  registered_at           timestamptz not null default now(),
  constraint watched_or_explained check (watcher_detector is not null or unwatched_reason is not null)
);

comment on table public.ops_derived_store_registry is
  'Per-listing derived stores that feed listing_native_location_v1. Every entry must name a watcher '
  'detector or an explicit unwatched_reason. Curated geography catalogs are out of scope. See '
  'docs/ops/DERIVED_STORE_FRESHNESS.md.';

insert into public.ops_derived_store_registry
  (store_name, appears_in_resolver_as, feeds, writer, watcher_detector, unwatched_reason, note)
values
  ('listings_arabic_locations', null,
   'listing_native_location_v1 final SELECT: COALESCE(<upstream district>, lal.district_ar)',
   '6 scheduled fns (resolve_english_city_overlay, resolve_aqar_locations, resolve_dealapp_city, '
     'resolve_dealapp_districts, resolve_raghdan_city, resolve_small_platform_cities) — ALL gated '
     '`where s.city_id is null`, and NONE writes raw_district/district_ar',
   'mon_detect_district_contradicts_source', null,
   'For the phasea platforms the upstream district arm is always NULL, so this store IS the served '
     'district. 6 rows served a district the source never published (repaired 2026-08-31).'),

  ('phasea_src_arabic', 'phasea_shadow_resolution',
   'phasea_shadow_resolution -> listing_native_location_v1 city_id/region_id',
   'NONE — frozen one-off snapshot captured during the 2026-08-21 phasea work',
   'mon_detect_phasea_snapshot_stale_vs_source', null,
   'The resolver''s candidate ordering prefers this snapshot''s city_ar_src over shadow_city. 3 rows '
     'served the wrong city (repaired 2026-08-31), incl. a Jeddah apartment served as Abha.'),

  ('aqar_shadow_resolved', null,
   'listing_native_location_v1 aqar arm: parsed_city_id -> city_id/region_id',
   'NONE — frozen snapshot, no cron job and no function writes it',
   null,
   'No valid source oracle exists yet. The listing''s own city column is ENGLISH ("Riyadh") while '
     'city_ar_parsed is ARABIC («الرياض»), so a direct comparison is meaningless — measured '
     '2026-08-31 it reported a 100% mismatch across all 84,698 active rows, which was purely the '
     'language difference. Its sibling column today_city is NOT a usable oracle either: the '
     'disagreements run in BOTH directions between the same cities (الدمام<->الخبر, الدمام->الظهران) '
     'and one pair is «البدائع»->«البدائع», the same name under a duplicate catalog id. Building an '
     'oracle here needs a real Arabic-vs-Arabic source field, not a re-derivation.',
   '141,539 rows, 18,275 of them pointing at aqar listings that no longer exist.')
on conflict (store_name) do nothing;

-- A registered store that nothing watches, or whose named watcher does not exist, is the
-- orphaned-view failure generalised. Fires P1; clears by naming a real detector or an explicit
-- reason. Cheap: reads one small ops table plus pg_proc.
create or replace function public.mon_detect_unwatched_derived_store()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  seen text[] := array[]::text[];
begin
  for r in
    select s.store_name, s.watcher_detector, s.feeds,
           (s.watcher_detector is not null
            and not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                             where ns.nspname = 'public' and p.proname = s.watcher_detector))
             as watcher_missing
      from public.ops_derived_store_registry s
     where s.watcher_detector is null and s.unwatched_reason is null
        or (s.watcher_detector is not null
            and not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                             where ns.nspname = 'public' and p.proname = s.watcher_detector))
  loop
    seen := seen || r.store_name;
    n := n + public.mon_raise(
      'P1', 'unwatched_derived_store', 'location',
      'unwatched_derived_store:' || r.store_name,
      jsonb_build_object(
        'store_name', r.store_name,
        'feeds', r.feeds,
        'watcher_detector', r.watcher_detector,
        'watcher_missing', r.watcher_missing,
        'why', case when r.watcher_missing
                    then 'This store names watcher ' || coalesce(r.watcher_detector,'?') ||
                         ', but no such function exists — the watcher was renamed or dropped and '
                         'the store is now unwatched.'
                    else 'This store feeds live location resolution and has NOTHING comparing it '
                         'against the source, and no recorded reason why not.' end ||
               ' A per-listing derived store with no watcher is how two frozen snapshots served '
               'listings in the wrong city and district for weeks on 2026-08-31 with every barrier '
               'green. FIX: add a mon_detect_* that compares this store against the LIVE SOURCE '
               'PAYLOAD (never against another derived layer, and never against raw-string drift), '
               'then set watcher_detector. If no valid oracle exists yet, record unwatched_reason '
               'explaining exactly why — do not leave it blank.'));
  end loop;

  perform public.mon_resolve_key('unwatched_derived_store', 'unwatched_derived_store:' || s.store_name)
    from public.ops_derived_store_registry s
   where not (s.store_name = any(seen));

  return n;
end $function$;

-- Roster entry in the SAME migration, idempotent, failing closed if the anchor is gone.
do $mig$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors() not found — roster wiring cannot be verified';
  end if;

  if position('mon_detect_unwatched_derived_store' in def) = 0 then
    if position('''mon_detect_phasea_offregion_pick''' in def) = 0 then
      raise exception 'roster anchor mon_detect_phasea_offregion_pick missing — refusing to guess';
    end if;
    def := replace(def,
      '''mon_detect_phasea_offregion_pick''',
      '''mon_detect_phasea_offregion_pick'','
        || chr(10) || '    ''mon_detect_unwatched_derived_store''');
    execute def;
  end if;
end $mig$;
