-- 🔧 Quality & Repair 2026-10-13: one mis-resolved listing must not poison an English city name.
--
-- A real user's «no results» (ops_zero_result_log 2026-10-13 11:52 UTC): Rent · Residential · annual, city «Khobar»,
-- district «Al Khobar Al Shamalyah» — 157 served rows match, 83 of them annual apartments, and the app answered 0.
-- Root cause, measured: city_name_bridge is rebuilt from (listing_location_index.city × served city_ar) and carried
-- «Khobar» → الخبر 16,340 / الخبراء 19 / الثقبة 1 / جدة 1. The search RPCs (location_search_candidates_ar,
-- top_cities_by_deal_ar, district_options_ar, af_eligible_count, …) accept an English city token only when the bridge
-- maps it to EXACTLY ONE Arabic city, so a single wrong resolution anywhere in the catalogue made «Khobar» — and
-- «Riyadh», «Dammam», «Mecca», «Medina», «Hail», «Najran», «Buraidah», «Dhahran» … 37 names in all — resolve to nothing.
-- Fix at the builder: a mapping stays only if it carries at least 5% of that English name's listings (the dominant
-- one always stays). Genuine one-to-many names keep all their members (Hofuf → الهفوف 58% / الاحساء 42%). The RPCs
-- are untouched; the function is what sync_search_listings_ar already calls every hour.

create or replace function public.refresh_city_name_bridge()
 returns void
 language sql
as $function$
  delete from city_name_bridge;
  insert into city_name_bridge (city_en, city_ar, n)
  select city_en, city_ar, n from (
    select li.city as city_en, s.city_ar, count(*)::int as n,
           100.0 * count(*) / sum(count(*)) over (partition by li.city) as share_pct,
           count(*) = max(count(*)) over (partition by li.city) as is_max
    from listing_location_index li
    join search_listings_ar s on s.source_table = li.source_table and s.listing_id = li.listing_id
    where li.city is not null and s.city_ar is not null
    group by li.city, s.city_ar
  ) m
  -- a minority mapping below 5% is a mis-resolved listing, not another name for the city
  where m.is_max or m.share_pct >= 5
  on conflict (city_en, city_ar) do nothing;
$function$;

select public.refresh_city_name_bridge();

-- PROOF, executed at apply (both directions): «Khobar» now maps to one city and the customer's search answers;
-- «Hofuf» still keeps both of its real members; the poisoning row «Khobar → جدة» is gone.
do $proof$
declare v_k int; v_h int; v_rpc int; v_bad int;
begin
  select count(distinct city_ar) into v_k from public.city_name_bridge where city_en = 'Khobar';
  if v_k <> 1 then raise exception 'PROOF: Khobar maps to % cities, want 1', v_k; end if;
  select count(distinct city_ar) into v_h from public.city_name_bridge where city_en = 'Hofuf';
  if v_h < 2 then raise exception 'PROOF: Hofuf lost a real member (% left)', v_h; end if;
  select count(*) into v_bad from public.city_name_bridge where city_en = 'Khobar' and city_ar = 'جدة';
  if v_bad <> 0 then raise exception 'PROOF: Khobar → جدة still in the bridge'; end if;
  select count(*) into v_rpc from public.location_search_candidates_ar('إيجار', array['Khobar'], null, null, null, null, 50,
    null, null, null, null, 'سنوي', null, null, null, null, null, null, null, null, null, null, null, 0, null, null, null,
    null, null, null, null, null, null, null, null, null, 'Residential', null, null, null, null, null, null, null, null);
  if v_rpc = 0 then raise exception 'PROOF: the customer path still answers 0 for Khobar'; end if;
  raise notice 'PROOF OK: Khobar → 1 city, Hofuf keeps %, RPC rows %', v_h, v_rpc;
end
$proof$;