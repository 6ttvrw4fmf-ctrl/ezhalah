-- Data Integrity run #29, self-inflicted and caught in the same session.
--
-- mon_detect_english_overlay_stranded_city() was written with the cohort "search_listings_ar has no
-- city_id AND the platform's city+region resolve uniquely" — and raised on its very first sweep,
-- immediately after the repair, because listings_arabic_locations had just been written and
-- search_listings_ar does not catch up until the hourly sync. That is EXACTLY the flaw this same
-- run had just removed from mon_detect_discarded_location_resolution: a barrier measuring the sync
-- clock instead of the thing it is protecting.
--
-- The resolver's failure is observable one step earlier and with no timing at all: if the city is
-- determinable from the platform's own fields, resolve_english_city_overlay must have WRITTEN the
-- matched listings_arabic_locations row. Whether the sync has since carried it into
-- search_listings_ar belongs to mon_detect_discarded_location_resolution limb B, which already owns
-- that question and already has a grace window for it.
--
-- So the cohort becomes: determinable AND no matched lal row carrying that city. A regression in
-- the overlay is caught on the next sweep; a row merely in flight is invisible to this detector.

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
          -- The resolver's OWN output, not the sync's: if the overlay did its job the row is gone
          -- from this cohort the moment it runs, whatever search_listings_ar still says.
          and not exists (
            select 1 from public.listings_arabic_locations l
             where l.source_table = s.source_table and l.listing_id = s.listing_id
               and l.matched and normalize_ar(l.city_ar) = normalize_ar(pin.city_ar))
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
               'region, to EXACTLY ONE canonical catalog city - and resolve_english_city_overlay (cron '
               'jobid 35, hourly at :06) has written NO matched listings_arabic_locations row carrying '
               'it. The listing is unlocated and no Filter combination can return it. The overlay either '
               'did not run, no longer covers this table, or has regressed to demanding global name '
               'uniqueness the way it did before run #29.',
        'do_not', 'Do NOT write a city onto the listing table by hand, and do NOT loosen the '
                  'count(distinct city_id)=1 rule to make this green. A name that is ambiguous even '
                  'inside its own published region must stay NULL. If the resolution EXISTS but has not '
                  'reached search_listings_ar, that is mon_detect_discarded_location_resolution limb B, '
                  'not this detector.'));
  else
    perform public.mon_resolve_key('english_overlay_stranded_city', 'english_overlay_stranded_city');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_english_overlay_stranded_city() is
  'P1. An active listing whose OWN platform published a city+region that our catalog resolves to '
  'exactly one canonical city, with NO matched listings_arabic_locations row written for it. Added '
  'by Data Integrity run #29 after resolve_english_city_overlay was found demanding global name '
  'uniqueness and stranding 9 listings («بيش» x5, «الباحة» x2, «القويعية», «المجمعة»). Deliberately '
  'measures the RESOLVER''s output, not search_listings_ar: the first version keyed on the search '
  'table and raised on rows that were merely awaiting the hourly sync - the same flaw this run '
  'removed from mon_detect_discarded_location_resolution an hour earlier. Measured cost ~200 ms.';
