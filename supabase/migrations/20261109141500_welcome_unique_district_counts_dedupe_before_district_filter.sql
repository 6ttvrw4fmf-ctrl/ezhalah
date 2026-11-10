-- 🔧 2026-11-09 — CodeRabbit on #11508 (Minor, taken): the guard's district ranking must fold twins EXACTLY the way the
-- builder folds them (welcome_fold_licence_twins, 20261109133000), or the «أكثر حي» check can rank a different copy.
-- Two differences, both fixed here:
--   1. the builder keeps the first copy by (platform, listing_id::text) — text order; this function ordered by the
--      bigint, so twins «9» and «10» could keep different copies when their districts differ;
--   2. this function dropped null / «غير معروف» districts BEFORE folding, so when the kept copy has no district and its
--      twin has one, the builder counts nothing while this function counted the twin.
-- Fold first, then filter the district. Read-only on listing data; no ops row is written.
create or replace function public.welcome_unique_district_counts(p_city text, p_deal text, p_types text[])
returns table (district_ar text, n bigint)
language sql
stable
set search_path to 'public'
as $function$
  with lic as (
    select license_number from public.search_listings_ar
     where production_ready and license_number ~ '^[0-9]{6,}$'
     group by 1 having count(*) <= 5
  ), r as (
    select s.platform, s.listing_id, s.district_ar,
           case when l.license_number is not null and s.city_id is not null and s.type_ar is not null and s.deal_ar is not null
                then 'L:' || s.license_number || '|' || s.city_id || '|' || s.type_ar || '|' || s.deal_ar
                else 'R:' || s.platform || ':' || s.listing_id end as k
      from public.search_listings_ar s
      left join lic l on l.license_number = s.license_number
     where s.production_ready and s.city_ar = p_city
       and (p_deal is null or s.deal_ar = p_deal)
       and (p_types is null or s.type_ar = any(p_types))
  ), u as (
    -- the builder's order: (platform, listing_id::text) — the SAME copy survives here and there
    select distinct on (k) district_ar from r order by k, platform, listing_id::text
  )
  select district_ar, count(*) from u
   where nullif(nullif(trim(district_ar), ''), 'غير معروف') is not null
   group by 1;
$function$;
revoke execute on function public.welcome_unique_district_counts(text, text, text[]) from public, anon, authenticated;

-- Proof (read-only): the function answers for a real city, never names an empty or unknown district, and every
-- district count is at most that district's raw served count (a fold can only lower a count, never raise it).
do $$
declare bad int; over int; total int;
begin
  select count(*) into total from public.welcome_unique_district_counts('الرياض', 'إيجار', null);
  if total = 0 then raise exception 'PROOF: welcome_unique_district_counts returned no district for الرياض/إيجار'; end if;
  select count(*) into bad from public.welcome_unique_district_counts('الرياض', 'إيجار', null) d
   where nullif(nullif(trim(d.district_ar), ''), 'غير معروف') is null;
  if bad > 0 then raise exception 'PROOF: % empty/unknown district row(s) survived the filter', bad; end if;
  select count(*) into over
    from public.welcome_unique_district_counts('الرياض', 'إيجار', null) d
    join (select s.district_ar, count(*) raw from public.search_listings_ar s
           where s.production_ready and s.city_ar = 'الرياض' and s.deal_ar = 'إيجار' group by 1) w
      on w.district_ar = d.district_ar
   where d.n > w.raw;
  if over > 0 then raise exception 'PROOF: % district(s) count MORE after the fold than raw', over; end if;
  raise notice 'PROOF OK: % district(s) for الرياض/إيجار, none empty, none above raw', total;
end $$;
