-- Companion to 20260911221734/20260911222018 (ops_incident #189: aqarmonthly district-suffix
-- backfill for 3 fallback-resolved listings), required by verify-repair-migrations-are-guarded.ts:
-- a data repair without a standing detector is a claim that decays. Narrowly scoped to the exact
-- 3 repaired rows (not the whole table) — the migration's own header already names a 4th flagged
-- listing left deliberately unfixed (genuinely unresolvable city), so a table-wide detector would
-- immediately fire on pre-existing, documented debt this repair never claimed to close. This watches
-- only whether the SPECIFIC repair it guards still holds.
--
-- Regression path: aqarmonthly's scraper writes district_ar at scrape time using ONLY its own
-- platform-parsed city (root cause of #189) — it never consults the region-scoped fallback
-- (listings_arabic_locations) this backfill used. If any of these 3 listings is re-scraped, its
-- district_ar reverts to the raw glued value and this detector must catch it.
create or replace function public.mon_detect_aqarmonthly_district_suffix_repair_regressed()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  v_reverted int;
begin
  select count(*) into v_reverted
    from public.aqarmonthly_residential_listings r
    join public.listings_arabic_locations l
      on l.source_table = 'aqarmonthly_residential_listings' and l.listing_id = r.id
   where r.id in (762041, 762272, 1097370)
     and r.district_ar is not null
     and l.matched and l.city_ar is not null
     and public.strip_district_city_suffix(r.district_ar, l.city_ar) <> r.district_ar;

  if v_reverted > 0 then
    n := n + public.mon_raise('P3', 'aqarmonthly_district_suffix_repair_regressed', 'aqarmonthly',
      'aqarmonthly_district_suffix_repair_regressed:reverted',
      jsonb_build_object(
        'reverted_rows', v_reverted,
        'why', 'ops_incident #189''s backfill (762041/762272/1097370) stripped a glued city-name '
            || 'suffix from district_ar using the region-scoped fallback city. A re-scrape of '
            || 'aqarmonthly writes district_ar from its own platform-parsed city only, which is '
            || 'NULL for these listings — so a re-scrape reverts them. Re-apply '
            || 'strip_district_city_suffix from listings_arabic_locations, or fix the scraper to '
            || 'consult the fallback before writing district_ar. See migration 20260911221734.'));
  else
    perform public.mon_resolve_key('aqarmonthly_district_suffix_repair_regressed', 'aqarmonthly_district_suffix_repair_regressed:reverted');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_aqarmonthly_district_suffix_repair_regressed() is
  'Watches the 3 rows repaired by 20260911221734/222018 (ops_incident #189): district_ar must stay '
  'equal to strip_district_city_suffix(district_ar, fallback city_ar) — a re-scrape writing the raw '
  'glued suffix back is the one way this specific repair decays. P3, on mon_run_all_detectors().';

-- ROSTER — needle-edited (pg_get_functiondef + replace), never a remembered/hand-pasted body.
do $mig$
declare def text;
  anchor constant text := '''mon_detect_service_facility_types_regressed''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() is missing — refusing to invent a roster';
  end if;
  if position('mon_detect_aqarmonthly_district_suffix_repair_regressed' in def) > 0 then
    return; -- idempotent
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor is not unique — refusing to needle-edit blindly';
  end if;
  def := replace(def, anchor, anchor || ',' || chr(10) || '    ''mon_detect_aqarmonthly_district_suffix_repair_regressed''');
  execute def;
end $mig$;

-- Proves the detector is reachable and currently green, in the same migration that creates it.
do $verify$
declare v_raised int;
begin
  select public.mon_detect_aqarmonthly_district_suffix_repair_regressed() into v_raised;
  if v_raised <> 0 then
    raise exception 'mon_detect_aqarmonthly_district_suffix_repair_regressed() raised % immediately '
      'after the repair it is meant to confirm — the repair is not actually holding', v_raised;
  end if;
end
$verify$;
