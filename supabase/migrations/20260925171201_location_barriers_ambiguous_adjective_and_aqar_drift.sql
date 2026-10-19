-- Two barriers for the location-matching bug class found 2026-09-25 (owner-reported: "الشرقية"
-- resolved as a city in Asir when it was really a modifier inside a Makkah/Khobar listing; aqar
-- resolved "الجديدة" as a city for a Riyadh-region الحريق listing). Full investigation and the
-- scraper-level fixes (ialqarawi) live in the matching PR; these two close the SQL side:
-- (1) a class of Arabic word the catalog also happens to hold as an obscure, real, standalone
--     city, which must never win as a resolved CITY without strong evidence, fleet-wide; and
-- (2) aqar's shadow-resolution table, which — by a DELIBERATE 2026-07-08 owner decision
--     (20260708051924_resolve_aqar_locations_upgrade_null_rows.sql: "a row is only ever filled
--     in, never overwritten once resolved") — never re-checks a row once resolved, so a later
--     correction to loc_city_map/loc_catalog_city can never reach an already-resolved listing.
--     That freeze is NOT reverted here — it was an explicit stability decision and reverting it
--     is a separate call for the owner to make. This barrier only adds the VISIBILITY that
--     decision was missing: it measures the current gap (2,146 rows, baselined below) and alerts
--     if NEW drift accumulates past that baseline, without auto-correcting anything.

-- ── 1. AMBIGUOUS DIRECTIONAL/AGE/POSITION ADJECTIVES MUST NEVER BE A RESOLVED CITY ───────────────
--
-- The word class: Arabic relative/comparative adjectives (direction: شرقي/غربي/شمالي/جنوبي/وسطى;
-- age: جديد/قديم/حديث/محدث; relative position: عليا/سفلى/كبرى/صغرى) grammatically require a head
-- noun ("الحي الشرقي", "المدينة الجديدة") to name a place — a bare occurrence in listing text is
-- overwhelmingly a truncated modifier, not a complete place reference. The catalog also happens to
-- hold each of these, once, as a real (obscure, low-population) standalone town — checked live
-- against src/data/sa-locations.json / loc_catalog_city 2026-09-25: 18 exact collisions across 10
-- distinct words. A resolver that free-text-scans a title and accepts the first catalog hit — as
-- ialqarawi's city_from_title() did before this fix — can match the adjective instead of the real
-- city the rest of the sentence names, filing a Makkah or Khobar listing under an unrelated Asir
-- village. This is a SCRAPER-LEVEL never-guess fix (a shared stoplist, generalised from ialqarawi's
-- own fix, is the real barrier); this detector is the fleet-wide backstop — it must always read 0.
create or replace function public.mon_detect_ambiguous_adjective_resolved_as_city()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; total int := 0; sample jsonb := '[]'::jsonb;
  -- The closed linguistic class, both spellings where they differ (ة/ه already unify under
  -- normalize_ar, kept explicit here for readability). Extend this list, not the detector's SQL,
  -- if the audit finds a new member of the same class — see docs/LOCATION_RESOLUTION.md.
  risky text[] := array['الجديد','الجديدة','الحديثة','الحديث','المحدثة','المحدث',
                         'الشرقي','الشرقية','الغربي','الغربية','الشمالي','الشمالية',
                         'الجنوبي','الجنوبية','الوسطى','العليا','العلياء','السفلى',
                         'الكبرى','الصغرى','القديم','القديمة'];
begin
  with bad as (
    select s.source_table, s.listing_id, s.platform, s.city_ar, s.region_ar
    from search_listings_ar s
    where s.production_ready
      and s.city_ar = any(risky)
  )
  select count(*), coalesce(jsonb_agg(to_jsonb(bad) order by source_table, listing_id), '[]'::jsonb)
    into total, sample
  from bad;

  if total > 0 then
    n := public.mon_raise('P1', 'ambiguous_adjective_resolved_as_city', 'all',
      'ambiguous_adjective_resolved_as_city',
      jsonb_build_object(
        'count', total, 'sample', sample,
        'why', 'A production_ready listing resolved its CITY to a bare directional/age/position '
               'adjective (e.g. الشرقية/الجديدة/العليا). These words are catalog-real but almost '
               'always a truncated modifier inside a longer place name, not the place itself — '
               'found live 2026-09-25 on ialqarawi (a Makkah plot and a Khobar plot both served '
               'as being in an unrelated Asir village of that literal name).',
        'do_not', 'Do NOT silence this by removing a word from the risky list without re-auditing '
                  'live data first — see docs/LOCATION_RESOLUTION.md''s ambiguous-city-word section. '
                  'Fix the SCRAPER''s resolver (route around the shared stoplist correctly, or find '
                  'the real city elsewhere in the same listing), never this detector.'));
  else
    perform public.mon_resolve_key('ambiguous_adjective_resolved_as_city', 'ambiguous_adjective_resolved_as_city');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_ambiguous_adjective_resolved_as_city() is
'Fleet-wide backstop for the "الشرقية" bug class (found 2026-09-25, ialqarawi). Standing 0 is the
healthy reading: no scraper should ever resolve a bare directional/age/position adjective as a
listing''s city. See docs/LOCATION_RESOLUTION.md for the word class and the scraper-level fix
(ialqarawi city_from_title()''s _CITY_STOP, now generalised).';

-- ── 2. AQAR SHADOW-RESOLUTION DRIFT (visibility only — the freeze itself is a kept decision) ────
create or replace function public.mon_detect_aqar_shadow_resolution_drift()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; total int := 0; sample jsonb := '[]'::jsonb;
  baseline_residential constant int := 2063;
  baseline_commercial constant int := 83;
  cur_residential int; cur_commercial int;
begin
  with fresh_res as (
    select distinct on (a.id) a.id, cc.city_ar as fresh_city_ar
    from aqar_residential_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id
      and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
           or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    where a.active
    order by a.id, cc.city_id
  )
  select count(*) into cur_residential
  from aqar_shadow_resolved s
  join aqar_residential_listings a on a.id = s.id and a.active
  join fresh_res f on f.id = s.id
  where s.src_table = 'aqar_residential_listings'
    and normalize_ar(f.fresh_city_ar) is distinct from normalize_ar(s.city_ar_parsed);

  with fresh_com as (
    select distinct on (a.id) a.id, cc.city_ar as fresh_city_ar
    from aqar_commercial_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id
      and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
           or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    where a.active
    order by a.id, cc.city_id
  )
  select count(*) into cur_commercial
  from aqar_shadow_resolved s
  join aqar_commercial_listings a on a.id = s.id and a.active
  join fresh_com f on f.id = s.id
  where s.src_table = 'aqar_commercial_listings'
    and normalize_ar(f.fresh_city_ar) is distinct from normalize_ar(s.city_ar_parsed);

  total := greatest(0, cur_residential - baseline_residential) + greatest(0, cur_commercial - baseline_commercial);

  if total > 0 then
    n := public.mon_raise('P2', 'aqar_shadow_resolution_drift', 'aqar', 'aqar_shadow_resolution_drift',
      jsonb_build_object(
        'new_drift', total, 'current_residential', cur_residential, 'current_commercial', cur_commercial,
        'baseline_residential', baseline_residential, 'baseline_commercial', baseline_commercial,
        'why', 'aqar_shadow_resolved.parsed_city_id is frozen by design (2026-07-08 owner decision) '
               'and never re-checked once set, so a later loc_city_map/loc_catalog_city correction '
               'never reaches an already-resolved row. This alert fires only on GROWTH past the '
               '2026-09-25 baseline — the 2,146-row historical backlog itself is a known, separate, '
               'owner-reviewed item, not what this alert is for.',
        'do_not', 'Do NOT silently bulk-correct existing rows to clear this — see the historical '
                  'baseline note above; that backfill needs its own explicit review. Do NOT lower '
                  'the baseline constants without the owner confirming those rows were reviewed.'));
  else
    perform public.mon_resolve_key('aqar_shadow_resolution_drift', 'aqar_shadow_resolution_drift');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_aqar_shadow_resolution_drift() is
'Growth ratchet on aqar_shadow_resolved drift (baseline 2,146 rows, measured 2026-09-25 right after
fixing the 3 owner-reported rows). Detects NEW drift only — the historical backlog is a separate,
owner-reviewed decision (whether to bulk-backfill it), not something this detector auto-fixes or
treats as unhealthy on its own. Measured cost 2026-09-25: ~1.4s residential + a similar-order
commercial pass, both single JOIN queries with no correlated subqueries per row.';

-- Roster registration, in the SAME migration (AGENTS.md: a detector outside mon_run_all_detectors
-- is decoration, and mon_detect_orphaned_detectors fires on anything nothing reaches).
do $roster$
declare
  src text; needle text := '''mon_detect_phasea_offregion_pick'',';
  ins text := '''mon_detect_phasea_offregion_pick'',
    ''mon_detect_ambiguous_adjective_resolved_as_city'',
    ''mon_detect_aqar_shadow_resolution_drift'',';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found';
  end if;

  if position('mon_detect_ambiguous_adjective_resolved_as_city' in src) > 0 then
    raise notice 'already registered; nothing to do';
    return;
  end if;

  if (length(src) - length(replace(src, needle, ''))) / length(needle) <> 1 then
    raise exception 'roster needle not found exactly once - refusing a blind edit';
  end if;

  execute replace(src, needle, ins);
end
$roster$;

-- Reachability check: fail the migration if the roster cannot reach the new detectors.
do $check$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_ambiguous_adjective_resolved_as_city' in src) = 0
     or position('mon_detect_aqar_shadow_resolution_drift' in src) = 0 then
    raise exception 'roster registration failed - a detector would be decoration';
  end if;
end
$check$;
