-- Data Integrity run #26 (2026-08-17). THE COST OF THIS RUN'S OWN FIXES, measured and paid.
--
-- Two repairs earlier in this run each raised a NEW P1 within the hour, and both were mine:
--
--  (a) impossible_price_size_displayed (15) and filter_barrier_leak — the price/size gate was
--      taught to honour ops_price_source_verified, so 15 source-PROVEN listings are searchable
--      again. Two barriers still counted exactly those rows as defects. Left alone this is worse
--      than the original bug: mon_raise() returns 0 for an already-open dedup key, so a
--      permanently-red key on known-good rows SUPPRESSES every future genuine raise of the same
--      class (§23a). A barrier must be able to go green.
--
--  (b) unverified_inactivation (5) — the dealapp duplicate retraction set active=false on rows
--      whose missing_count is 0, which is precisely the shape mon_unverified_inactivations_24h
--      exists to catch. The detector was RIGHT to fire: it cannot tell a source-adjudicated
--      classification retraction from a time-based sweep flipping rows nobody verified.
--
-- The fix for (b) is NOT to fabricate strike evidence on those rows -- writing missing_count = 3
-- would be inventing a liveness history that never happened, to silence a monitor. It is to record
-- WHY each row was retracted, in an evidence table, and let the detector exclude only rows with a
-- recorded adjudication. Same discipline as ops_price_source_verified and ops_price_eq_area_verified:
-- never silence a barrier, make it distinguish cases, and make the exemption FK-gated to evidence.

create table if not exists ops_adjudicated_retraction (
  source_table  text        not null,
  listing_id    bigint      not null,
  reason        text        not null,
  evidence      jsonb       not null,
  retracted_at  timestamptz not null default now(),
  primary key (source_table, listing_id)
);

comment on table ops_adjudicated_retraction is
  'Rows deactivated by a source-adjudicated decision that is NOT a liveness call -- e.g. a duplicate misfiled into the wrong category table, withdrawn while its correctly-classified twin keeps serving. Recording the adjudication here is what lets mon_unverified_inactivations_24h stay strict about genuine unverified inactivations without firing on a proven repair. An entry must carry the source evidence that justified it.';

-- The 5 dealapp residential duplicates retracted earlier this run, with dealapp's own page titles
-- as the evidence. Each ad continues to serve through its commercial twin.
insert into ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'dealapp_residential_listings', r.id,
       'duplicate_misclassified_residential_twin',
       jsonb_build_object(
         'listing_url', r.listing_url,
         'stored_residential_type', r.property_type,
         'commercial_twin_id', c.id,
         'commercial_twin_type', c.property_type,
         'source_titles_probed_2026_08_17', jsonb_build_object(
            '549199', 'ارض تجارية للبيع',
            '540978', 'محطة بنزين للبيع',
            '499170', 'محطة بنزين للإيجار'),
         'note', 'Commercial twin is source-correct and remains active and production_ready; only the misfiled residential duplicate was withdrawn. No liveness claim.')
  from dealapp_residential_listings r
  join dealapp_commercial_listings c on c.listing_url = r.listing_url and c.active
 where r.active = false
   and r.deactivated_at >= now() - interval '6 hours'
   and (r.property_type in ('محطة بنزين','Gas Station','Commercial Land','Commercial Building',
                            'Office','Shop','Showroom','Warehouse','Workshop','Factory','Kiosk')
        or (r.property_type = 'Residential Land' and c.property_type = 'Commercial Land'))
on conflict (source_table, listing_id) do nothing;

-- (b) the unverified-inactivation view now excludes ONLY rows carrying a recorded adjudication.
create or replace view mon_unverified_inactivations_24h as
select (coalesce(sum(n), 0::bigint))::integer as unverified_inactivations_24h
from (
  select ((xpath('/row/c/text()'::text,
           query_to_xml(
             format(
               'select count(*) c from public.%I t where t.active = false '
               'and coalesce(t.missing_count,0) < 3 '
               'and t.deactivated_at >= now() - interval ''24 hours'' '
               'and not exists (select 1 from public.ops_adjudicated_retraction r '
               '                 where r.source_table = %L and r.listing_id = t.id)',
               pg_tables.tablename, pg_tables.tablename),
             false, true, ''::text)))[1]::text)::integer as n
    from pg_tables
   where pg_tables.schemaname = 'public'::name
     and pg_tables.tablename ~ '_(residential|commercial)_listings$'::text) s;

-- (a) both price/size barriers now honour the same evidence table the trigger honours.
create or replace function public.mon_detect_impossible_price_size()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_cnt bigint; v_open boolean; n int := 0;
begin
  select count(*) into v_cnt
    from public.search_listings_ar s
   where s.production_ready
     and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
     and not exists (select 1 from public.ops_price_source_verified v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id);
  v_open := exists (select 1 from public.alert_event where dedup_key='impossible_price_size_displayed' and resolved_at is null);
  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('impossible_price_size_displayed','search_index'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P1','impossible_price_size_displayed','search_index','impossible_price_size_displayed',
      jsonb_build_object('count', v_cnt,
        'why','a SEARCHABLE listing carries a physically-impossible price or size (ppm>5M SAR/m², total/annual>50B, or area>5M m²) AND has no source evidence — data must match the source, never display a fabricated number. Rows PROVEN to carry source-published values (ops_price_source_verified) are exempt: the owner rule is that a source price is never hidden at any magnitude, so counting them here would hold this key permanently red and suppress every genuine re-occurrence.'));
  end if;
  return n;
end $function$;

create or replace view mon_filter_barrier_leaks as
select count(*) as filter_visible_total,
       count(*) filter (
         where price_size_impossible(price_total, price_annual, area_m2)
           and not exists (select 1 from ops_price_source_verified v
                            where v.source_table = s.source_table and v.listing_id = s.listing_id)
       ) as leak_impossible_price_size,
       count(*) filter (where city_id is null)   as leak_no_city,
       count(*) filter (where region_id is null) as leak_no_region,
       count(*) filter (where deal_ar is null)   as leak_no_deal,
       count(*) filter (where area_m2 < 0)       as leak_negative_area,
       count(*) filter (where price_total < 0::numeric or price_annual < 0::numeric) as leak_negative_price,
       now() as as_of
  from search_listings_ar s
 where production_ready;

comment on view mon_filter_barrier_leaks is
  'Hard-barrier leaks reachable by the Normal Filter. leak_impossible_price_size deliberately EXCLUDES rows recorded in ops_price_source_verified (run #26): a source-published extreme is never hidden by owner rule, so counting it as a leak would hold the barrier permanently red on known-good data and, because mon_raise() dedups on an open key, silence genuine leaks of the same class.';
