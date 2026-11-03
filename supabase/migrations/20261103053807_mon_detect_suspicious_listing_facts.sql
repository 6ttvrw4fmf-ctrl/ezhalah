-- THE SUSPICIOUS-FACTS ROBOT (owner 2026-11-03: «we need to create something to check it — a robot that flags things
-- that are suspicious», after a card showed «10 bedrooms» that the ad's text tied to age, and one villa twelve times).
-- One detector on the mon_run_all_detectors() roster (twice an hour), reading only the served index, so it is cheap.
-- It FLAGS for adjudication; it never edits a listing (weird ≠ wrong; data is corrected only when Ezhalah is proven
-- to have created the error — docs/ops/DATA_INTEGRITY_ENGINEER.md). Each class has its own dedup key and resolves by
-- itself when the class clears:
--   rooms_vs_area   — a dwelling (apartment/studio/floor/duplex) whose bedrooms leave under 9 m² each (measured
--                     2026-11-03: 165, e.g. aqar «58 غرفة» on a 48 m² flat — the site's own header);
--   age_as_bedrooms — bedrooms equal to a stated building age while the age column is empty (the sakan 100289 shape:
--                     JSON-LD numberOfBedrooms 10 beside «عمر العقار: اكثر من عشر سنوات»), counted on the source
--                     description for listings seen in the last 3 days, so new listings are checked as they arrive;
--   same_site_dupes — a platform whose same-site duplicate share (same spot, deal, price, area, type, bedrooms)
--                     rises above 35% of its pinned rows (measured 2026-11-03: rakez 45%, muhaysini 29%, wasalt 21%;
--                     the map counts them once since 20261103052811 — this watches the source side).
set local lock_timeout = '5s';
create or replace function public.mon_detect_suspicious_listing_facts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_cnt bigint; v_top jsonb;
begin
  -- 1. rooms that cannot fit the area
  select count(*), (select jsonb_agg(jsonb_build_object('t', x.source_table, 'id', x.listing_id, 'beds', x.bedrooms, 'm2', x.area_m2))
                      from (select source_table, listing_id, bedrooms, area_m2 from public.search_listings_ar
                             where type_ar in ('شقة','استوديو','دور','دوبلكس') and bedrooms > 1 and area_m2 > 0 and area_m2::numeric / bedrooms < 9
                             order by area_m2::numeric / bedrooms limit 10) x)
    into v_cnt, v_top
    from public.search_listings_ar
   where type_ar in ('شقة','استوديو','دور','دوبلكس') and bedrooms > 1 and area_m2 > 0 and area_m2::numeric / bedrooms < 9;
  if v_cnt > 0 then
    live := live || 'suspicious_listing_facts:rooms_vs_area'::text;
    n := n + public.mon_raise('P2', 'suspicious_listing_facts', 'all', 'suspicious_listing_facts:rooms_vs_area',
      jsonb_build_object('rows', v_cnt, 'sample', v_top,
        'why', 'A dwelling whose bedrooms leave under 9 m² each. Often the site''s own number (aqar «58 غرفة» on 48 m²), sometimes a misread field.',
        'action', 'Open the sample on the source. If the site published it, it stays (SOURCE IS TRUTH); if Ezhalah misread a field, fix the parser and repair with evidence.'));
  end if;

  -- 2. a stated age stored as bedrooms (new listings, last 3 days, on the source text)
  with recent as (
    select 'sakan_residential_listings' t, id, bedrooms, property_age, description d from public.sakan_residential_listings
     where active and bedrooms >= 5 and property_age is null and last_seen_at >= now() - interval '3 days'
    union all
    select 'muktamel_residential_listings', id, bedrooms, property_age, description from public.muktamel_residential_listings
     where active and bedrooms >= 5 and property_age is null and last_seen_at >= now() - interval '3 days'
    union all
    select 'aqar_residential_listings', id, bedrooms, property_age, description from public.aqar_residential_listings
     where active and bedrooms >= 5 and property_age is null and last_seen_at >= now() - interval '3 days'
    union all
    select 'wasalt_residential_listings', id, bedrooms, property_age, description from public.wasalt_residential_listings
     where active and bedrooms >= 5 and property_age is null and last_seen_at >= now() - interval '3 days'
  ), hit as (
    select t, id, bedrooms from recent
     where translate(coalesce(d, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789')
           ~ ('(عمر العقار|العمر|عمره|عمرها)\s*[:：*]*\s*\+?\s*' || bedrooms::text || '(\D|$)')
  )
  select count(*), (select jsonb_agg(jsonb_build_object('t', h.t, 'id', h.id, 'beds', h.bedrooms)) from (select * from hit limit 10) h)
    into v_cnt, v_top from hit;
  if v_cnt > 0 then
    live := live || 'suspicious_listing_facts:age_as_bedrooms'::text;
    n := n + public.mon_raise('P2', 'suspicious_listing_facts', 'all', 'suspicious_listing_facts:age_as_bedrooms',
      jsonb_build_object('rows', v_cnt, 'sample', v_top,
        'why', 'Bedrooms equal the building age the ad states, and the age column is empty — the shape of an age read as bedrooms (sakan 100289: JSON-LD numberOfBedrooms 10 beside «اكثر من عشر سنوات»).',
        'action', 'Fetch each sample page: if the site''s structured bedrooms is the age, the scraper must stop taking it as bedrooms (silent→NULL); repair with the page as evidence.'));
  end if;

  -- 3. a platform drowning in same-site duplicates
  select count(*), jsonb_agg(jsonb_build_object('platform', platform, 'dupes', dupes, 'total', total) order by dupes::numeric / total desc)
    into v_cnt, v_top
    from (select platform, count(*) total,
                 count(*) - count(distinct (source_table, latitude, longitude, deal_ar, price_total, price_annual, area_m2, type_ar, bedrooms)) dupes
            from public.search_listings_ar where latitude is not null
           group by platform having count(*) >= 500) p
   where dupes::numeric / total > 0.35;
  if v_cnt > 0 then
    live := live || 'suspicious_listing_facts:same_site_dupes'::text;
    n := n + public.mon_raise('P2', 'suspicious_listing_facts', 'all', 'suspicious_listing_facts:same_site_dupes',
      jsonb_build_object('platforms', v_top,
        'why', 'Over 35% of the platform''s pinned rows repeat another of its rows (same spot, deal, price, area, type, bedrooms). The map counts them once; the Filter still shows them.',
        'action', 'Check whether the site posts the same ad repeatedly or the scraper splits one page into many rows (rakez: one project page → many identical units).'));
  end if;

  perform public.mon_resolve_stale_keys('suspicious_listing_facts', live);
  return n;
end
$function$;

revoke execute on function public.mon_detect_suspicious_listing_facts() from public, anon, authenticated;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_suspicious_listing_facts' in src) > 0 then
    raise notice 'mon_detect_suspicious_listing_facts already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aqar_price_over_authoritative_absent'',',
    E'    ''mon_detect_aqar_price_over_authoritative_absent'',\n    ''mon_detect_suspicious_listing_facts'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- PROOF at apply: the detector runs and is on the roster; a planted 9-bedroom 40 m² flat is caught, then rolled back.
do $$
declare v_hit int; v_t text; v_id bigint;
begin
  perform public.mon_detect_suspicious_listing_facts();
  begin
    select source_table, listing_id into v_t, v_id from public.search_listings_ar where type_ar = 'شقة' and bedrooms = 2 and area_m2 > 60 limit 1;
    update public.search_listings_ar set bedrooms = 9, area_m2 = 40 where source_table = v_t and listing_id = v_id;
    update public.alert_event set resolved_at = now() where dedup_key = 'suspicious_listing_facts:rooms_vs_area' and resolved_at is null;
    perform public.mon_detect_suspicious_listing_facts();
    select count(*) into v_hit from public.alert_event
     where dedup_key = 'suspicious_listing_facts:rooms_vs_area' and resolved_at is null;
    if v_hit = 0 then raise exception 'PROOF: a planted 9-bedroom 40 m² flat was not caught'; end if;
    raise exception '__suspicious_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__suspicious_selftest_rollback__' then raise; end if;
  end;
  if position('mon_detect_suspicious_listing_facts' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
end $$;
