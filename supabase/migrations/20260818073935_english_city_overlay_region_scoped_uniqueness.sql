-- Data Integrity run #29 (2026-08-18): the English-city overlay threw away resolutions it had
-- already computed WITH the region.
--
-- resolve_english_city_overlay() joins loc_city_map -> loc_catalog_region -> loc_catalog_city, so
-- the candidate city is already pinned INSIDE the region the platform itself published. It then
-- discarded the answer unless the name was unique across the WHOLE catalog:
--
--     and (select count(*) from loc_catalog_city gc where gc.city_norm = normalize_ar(pin.city_ar)) = 1
--
-- Saudi place names repeat across regions legitimately - «الباحة» exists in منطقة الباحة (city_id
-- 1542, 835 served rows) and in منطقة حائل (2693); «القويعية» in four regions; «بيش» in two - so
-- that guard rejected every listing whose city merely SHARES a name with a city somewhere else,
-- even though the platform published the region and exactly one catalog city carries the name
-- inside it. Nine active listings were unreachable by every Filter combination as a result:
--
--   sanadak_residential 664896, 1039565, 8221005, 8221007 | sanadak_commercial 630284
--       «بيش» Baysh -> city_id 3462, منطقة جازان        (name count across catalog: 2)
--   dealapp_commercial 8481914 | dealapp_residential 8480954
--       «الباحة» Al Baha -> city_id 1542, منطقة الباحة   (2)
--   dealapp_residential 8481138
--       «القويعية» Al Quwayiyah -> city_id 880, منطقة الرياض (4)
--   aqarmonthly_residential 1097370
--       «المجمعة» Al Majmaah -> city_id 24, منطقة الرياض   (4)
--
-- This is NOT a relaxation of the never-guess rule; it is the SAME rule the rest of the pipeline
-- already applies. listing_native_location_v2's ulg2 lateral and
-- mon_detect_discarded_location_resolution's branch (b) both accept "ambiguous by name, unambiguous
-- inside the region recorded beside it" as a confident match. The overlay was the one stage still
-- demanding global name uniqueness.
--
-- The anti-ambiguity protection MOVES rather than disappears: the lateral now aggregates and
-- requires `having count(distinct cc.city_id) = 1`, so a key mapping to two regions, or a region
-- genuinely holding two same-named cities, still resolves to NOTHING. Honest NULL beats a guess.

create or replace function public.resolve_english_city_overlay()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t record; total int := 0; n int;
begin
  for t in
    select tb.table_name tn from information_schema.tables tb
    where tb.table_schema='public' and tb.table_name like '%\_listings'
      and tb.table_name not like 'deal\_%' and tb.table_name !~ '^aqar_' and tb.table_type='BASE TABLE'
      and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.table_name and c.column_name='city')
      and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.table_name and c.column_name='id')
  loop
    begin
      execute format($q$
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, matched, review_reason)
        select s.source_table||':'||s.listing_id::text, s.platform, s.source_table, s.listing_id,
               case when s.deal_ar='بيع' then 'buy' else 'rent' end,
               btrim(r.city), pin.city_ar, pin.region_ar, true, 'english_map_overlay'
        from public.search_listings_ar s
        join public.%I r on r.id = s.listing_id and s.source_table = %L
        join lateral (
          -- ONE canonical city, or nothing. Unique inside the region the platform published is a
          -- confident match (same rule as listing_native_location_v2's ulg2); unique across the
          -- whole catalog was never the question being asked here.
          select min(cc.city_ar) as city_ar, min(cr.region_ar) as region_ar
          from public.loc_city_map cm
          join public.loc_catalog_region cr on cr.region_ar = cm.region_ar
          join public.loc_catalog_city cc on cc.region_id = cr.region_id
               and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
                    or exists (select 1 from public.loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
          where cm.city_key = lower(btrim(r.city))
          having count(distinct cc.city_id) = 1
        ) pin on true
        where s.city_id is null
        on conflict (index_id) do update
          set city_ar = excluded.city_ar, region_ar = excluded.region_ar,
              matched = true, review_reason = 'english_map_overlay'
          where public.listings_arabic_locations.city_ar is distinct from excluded.city_ar
      $q$, t.tn, t.tn);
      get diagnostics n = row_count;
      total := total + n;
    exception when others then null;
    end;
  end loop;
  return total;
end $function$;

comment on function public.resolve_english_city_overlay() is
  'Writes listings_arabic_locations from a platform''s own English city column via loc_city_map. '
  'Confident-match rule (run #29): exactly ONE canonical city inside the region the platform '
  'published - not "unique across the whole catalog", which discarded 9 live listings whose city '
  'merely shares a name with a city in another region («الباحة», «القويعية», «بيش», «المجمعة»). '
  'Ambiguity still resolves to NOTHING: the lateral aggregates and requires count(distinct city_id)=1.';

-- ── Repair the rows the old guard stranded, and prove the count ─────────────────────────────────
do $$
declare gained int; before_rows int; after_rows int;
begin
  select count(*) into before_rows from public.listings_arabic_locations where review_reason='english_map_overlay';
  gained := public.resolve_english_city_overlay();
  select count(*) into after_rows from public.listings_arabic_locations where review_reason='english_map_overlay';

  if gained <> 9 then
    raise exception 'expected exactly the 9 stranded listings, overlay wrote % rows (before=% after=%)',
      gained, before_rows, after_rows;
  end if;

  -- Pinned controls (§21): one per platform shape, asserted by city_id, not by "it is not null".
  if not exists (select 1 from public.listings_arabic_locations
                  where source_table='dealapp_residential_listings' and listing_id=8481138
                    and city_ar='القويعية' and region_ar='منطقة الرياض' and matched) then
    raise exception 'control dealapp 8481138 did not land on القويعية / منطقة الرياض';
  end if;
  if not exists (select 1 from public.listings_arabic_locations
                  where source_table='sanadak_commercial_listings' and listing_id=630284
                    and city_ar='بيش' and region_ar='منطقة جازان' and matched) then
    raise exception 'control sanadak 630284 did not land on بيش / منطقة جازان';
  end if;
end $$;

-- ── Barrier: the resolver must never again strand a city the source published ──────────────────
-- The existing mon_detect_discarded_location_resolution cannot see this class at all: it requires a
-- matched listings_arabic_locations row, and here the resolver never wrote one. Third blind spot in
-- the same pipeline (run #26: v1.best precedence; run #29 limb B: sync lag; this: the overlay's own
-- uniqueness gate).
create or replace function public.mon_detect_english_overlay_stranded_city()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t record; n int := 0; cnt int; total int := 0; sample jsonb := '[]'::jsonb; j jsonb;
begin
  for t in
    select tb.table_name tn from information_schema.tables tb
    where tb.table_schema='public' and tb.table_name like '%\_listings'
      and tb.table_name not like 'deal\_%' and tb.table_name !~ '^aqar_' and tb.table_type='BASE TABLE'
      and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.table_name and c.column_name='city')
      and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.table_name and c.column_name='id')
  loop
    execute format($q$
      select count(*), coalesce(jsonb_agg(x),'[]'::jsonb) from (
        select s.source_table, s.listing_id, btrim(r.city) as raw_city_en, pin.city_ar, pin.region_ar
        from public.search_listings_ar s
        join public.%I r on r.id = s.listing_id and s.source_table = %L
        join lateral (
          select min(cc.city_ar) as city_ar, min(cr.region_ar) as region_ar
          from public.loc_city_map cm
          join public.loc_catalog_region cr on cr.region_ar = cm.region_ar
          join public.loc_catalog_city cc on cc.region_id = cr.region_id
               and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
                    or exists (select 1 from public.loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
          where cm.city_key = lower(btrim(r.city))
          having count(distinct cc.city_id) = 1
        ) pin on true
        where s.city_id is null
        limit 10
      ) x $q$, t.tn, t.tn) into cnt, j;
    if coalesce(cnt,0) > 0 then
      total := total + cnt;
      sample := sample || j;
    end if;
  end loop;

  if total > 0 then
    n := public.mon_raise('P1', 'english_overlay_stranded_city', 'all', 'english_overlay_stranded_city',
      jsonb_build_object(
        'count', total,
        'sample', sample,
        'why', 'The platform published an English city that loc_city_map resolves, together with the '
               'region, to EXACTLY ONE canonical catalog city - and search_listings_ar still carries no '
               'city_id, so no Filter combination can return these listings. resolve_english_city_overlay '
               '(cron jobid 35, hourly at :06) either did not run, no longer covers this table, or has '
               'regressed to demanding global name uniqueness the way it did before run #29.',
        'do_not', 'Do NOT write a city onto the listing table by hand, and do NOT loosen the '
                  'count(distinct city_id)=1 rule to make this green. A name that is ambiguous even '
                  'inside its own published region must stay NULL.'));
  else
    perform public.mon_resolve_key('english_overlay_stranded_city', 'english_overlay_stranded_city');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_english_overlay_stranded_city() is
  'P1. An active listing whose OWN platform published a city+region that our catalog resolves to '
  'exactly one canonical city, still unlocated in search_listings_ar. Added by Data Integrity run '
  '#29 after resolve_english_city_overlay was found requiring global name uniqueness and stranding '
  '9 listings («بيش» x5, «الباحة» x2, «القويعية», «المجمعة»). Measured cost 201 ms.';

-- Roster wiring, in the SAME migration. Guarded needle-edit, never a re-pasted body.
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_english_overlay_stranded_city''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then raise exception 'mon_run_all_detectors not found - refusing to wire blindly'; end if;
  if position('mon_detect_english_overlay_stranded_city' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install', before_n, after_n;
  end if;
  if position('mon_detect_english_overlay_stranded_city' in src) = 0
     or position('mon_detect_run_log_timestamps_inverted' in src) = 0
     or position('mon_detect_discarded_location_resolution' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;
