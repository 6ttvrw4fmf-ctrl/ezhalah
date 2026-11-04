-- A PER-METRE PRICE TYPED INTO THE TOTAL BOX ON A LAND SALE (owner 2026-11-04: «build the best solution, a strong guard»).
--
-- abwbna 10777645 (الأحساء / المطيرفي الغربي, 375 m²) publishes «1,700» as the total. Land there sells at ~500–2,700
-- SAR/m², so 1,700 is the per-metre price and the plot is ≈ 637,500. Customers saw a 1,700-riyal plot and a 500k–700k
-- budget search could never find it. Measured 2026-11-04 (served land sales, total < 20,000, total ÷ area < 50/m²): 362.
--
-- THIS MIGRATION ONLY ADDS THE RULE, ITS INPUTS AND THE REVIEW LIST. Nothing is served differently until the next
-- migration wires the rule into enforce_price_size_sanity(). PRICE = SOURCE: the platform tables and scrapers keep the
-- source figure; the derived total lives only in the search index (search_listings_ar), flagged ppm_typed_as_total, and
-- the card shows it with «≈» + «محتسب من سعر المتر × المساحة» while keeping the seller's figure visible.
--
-- THE RULE (all must hold) — land_ppm_typed_as_total_ar():
--   a. land for sale (not agricultural), total > 0 and < 20,000, area ≥ 100, total ÷ area < 50
--   b. the source's own per-metre box does NOT agree with the total (ppm × area within 5% = real cheap land: الفوارة 13/m²)
--   c. the typed figure sits inside the plausible per-metre band of that district (≥ 20 healthy rows) or city (≥ 30):
--      [max(100, 0.75 × p10), 1.5 × p90] of healthy land sales (total ≥ 20,000, ≥ 50/m²), refreshed daily
--   d. the typed figure is not the area copied into the price box (|total − area| ≤ 1 is its own typo class)
--   e. it is not the thousands typo: the ad's own text writes «<the same number> الف», or — with no word either way —
--      total × 1000 ÷ area is ALSO inside the band (then per-metre vs thousands is ambiguous → review, never a guess);
--      the ad's text saying «للمتر / في المتر / سعر المتر / ريال م2 / N/م» settles that ambiguity for per-metre
--   f. the derived total ≤ 500,000,000 (the existing derived-total bound)
-- Anything that fails b–f stays as the source wrote it and is listed in land_price_unit_review_ar.

set local lock_timeout = '5s';
alter table public.search_listings_ar add column if not exists ppm_typed_as_total boolean not null default false;
comment on column public.search_listings_ar.ppm_typed_as_total is
  'True when enforce_price_size_sanity() read the source total as a PER-METRE price (land_ppm_typed_as_total_served_ar) and serves price_total = that figure × area, with price_per_meter = the source figure. The platform table keeps the source value. Owner 2026-11-04.';

-- The per-metre band of healthy land sales, by district (n ≥ 20) and city (district_ar = '', n ≥ 30).
create table if not exists public.land_sale_ppm_band (
  city_ar      text        not null,
  district_ar  text        not null default '',
  lo           numeric     not null,
  hi           numeric     not null,
  n            integer     not null,
  refreshed_at timestamptz not null default now(),
  primary key (city_ar, district_ar)
);
alter table public.land_sale_ppm_band enable row level security;
revoke all on public.land_sale_ppm_band from anon, authenticated;

-- What the ad's own words say about its price unit (read by the daily detector; a tie-breaker, never a price source).
create table if not exists public.land_price_unit_text_evidence (
  source_table  text        not null,
  listing_id    bigint      not null,
  says_per_m2   boolean     not null,
  says_thousands boolean    not null,
  read_at       timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.land_price_unit_text_evidence enable row level security;
revoke all on public.land_price_unit_text_evidence from anon, authenticated;

-- The pure rule. Returns the derived total, or NULL when the figure must stay as published.
create or replace function public.land_ppm_typed_as_total_ar(p numeric, area integer, ppm numeric, band_lo numeric, band_hi numeric,
                                                            says_per_m2 boolean, says_thousands boolean)
returns numeric
language sql
immutable
as $function$
  select p * area
   where p > 0 and p < 20000 and area >= 100 and p / area < 50
     and abs(p - area) > 1
     and not (ppm is not null and abs(ppm * area - p) <= 0.05 * p)
     and band_lo is not null and band_hi is not null and p between band_lo and band_hi
     and p * area <= 500000000
     and not coalesce(says_thousands, false)
     and (coalesce(says_per_m2, false) or not (p * 1000 / area between band_lo and band_hi))
$function$;

-- The rule with its inputs looked up (band + text evidence). Cheap exit for every row outside signature (a).
create or replace function public.land_ppm_typed_as_total_served_ar(p_source_table text, p_listing_id bigint, p numeric, area integer,
                                                                   ppm numeric, p_type text, p_city text, p_district text)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare v_lo numeric; v_hi numeric; v_pm boolean; v_k boolean;
begin
  if p is null or area is null or p <= 0 or p >= 20000 or area < 100 or p / area >= 50
     or p_type is null or p_type not like 'أرض%' or p_type like '%زراع%' or p_city is null then
    return null;
  end if;
  select b.lo, b.hi into v_lo, v_hi
    from public.land_sale_ppm_band b
   where b.city_ar = p_city and b.district_ar in (coalesce(p_district, ''), '')
   order by (b.district_ar = '') limit 1;
  select e.says_per_m2, e.says_thousands into v_pm, v_k
    from public.land_price_unit_text_evidence e
   where e.source_table = p_source_table and e.listing_id = p_listing_id;
  return public.land_ppm_typed_as_total_ar(p, area, ppm, v_lo, v_hi, v_pm, v_k);
end
$function$;
revoke execute on function public.land_ppm_typed_as_total_served_ar(text, bigint, numeric, integer, numeric, text, text, text) from public, anon, authenticated;

create or replace function public.refresh_land_sale_ppm_band()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare n int;
begin
  delete from public.land_sale_ppm_band;
  insert into public.land_sale_ppm_band (city_ar, district_ar, lo, hi, n, refreshed_at)
  select city_ar, case when g = 1 then '' else d end, lo, hi, cnt, now()
    from (select h.city_ar, h.d, count(*)::int cnt, grouping(h.d) g,
                 greatest(100, 0.75 * percentile_cont(0.1) within group (order by h.ppm)) lo,
                 1.5 * percentile_cont(0.9) within group (order by h.ppm) hi
            from (select s.city_ar, coalesce(s.district_ar, '') d, s.price_total / s.area_m2 ppm
                    from public.search_listings_ar s
                   where s.deal_ar = 'بيع' and s.production_ready and not s.ppm_typed_as_total
                     and s.type_ar like 'أرض%' and s.type_ar not like '%زراع%' and s.city_ar is not null
                     and s.price_total >= 20000 and s.area_m2 between 100 and 1000000
                     and s.price_total / s.area_m2 >= 50) h
           group by grouping sets ((h.city_ar, h.d), (h.city_ar))) b
   where (g = 0 and d <> '' and cnt >= 20) or (g = 1 and cnt >= 30);
  get diagnostics n = row_count;
  return n;
end
$function$;
revoke execute on function public.refresh_land_sale_ppm_band() from public, anon, authenticated;

create or replace function public.refresh_land_price_unit_text_evidence()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare r record; v_txt text; n int := 0;
begin
  delete from public.land_price_unit_text_evidence;
  for r in
    select s.source_table, s.listing_id, s.price_total
      from public.search_listings_ar s
     where s.deal_ar = 'بيع' and s.type_ar like 'أرض%' and s.type_ar not like '%زراع%'
       and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100 and s.price_total / s.area_m2 < 50
       and s.price_total = trunc(s.price_total)
  loop
    begin
      execute format('select coalesce(title, '''') || '' '' || coalesce(description, '''') from public.%I where id = $1', r.source_table)
         into v_txt using r.listing_id;
    exception when undefined_table or undefined_column then
      v_txt := null;
    end;
    -- Arabic-Indic digits → ASCII; thousands separators dropped («٥٥٠الف» → «550الف», «165,000» → «165000»).
    v_txt := translate(coalesce(v_txt, ''), '٠١٢٣٤٥٦٧٨٩,٬', '0123456789');
    insert into public.land_price_unit_text_evidence (source_table, listing_id, says_per_m2, says_thousands)
    values (r.source_table, r.listing_id,
            v_txt ~ '(للمتر|في المتر|بالمتر|سعر المتر|المتر\s*(ب|:)|ريال\s*/?\s*م\s*[2²]|ريال\s+للم|[0-9]\s*/\s*م)',
            v_txt ~ ('(^|[^0-9])' || r.price_total::bigint::text || '\s*(الف|ألف|آلاف|الاف)'));
    n := n + 1;
  end loop;
  return n;
end
$function$;
revoke execute on function public.refresh_land_price_unit_text_evidence() from public, anon, authenticated;

-- THE REVIEW LIST: what the rule refuses to guess. Sale rows of signature (a) left as published; land rents with a tiny
-- figure for an urban-size plot (never auto-derived by price alone, owner design 2026-11-04); Property Finder offices
-- whose «area» dwarfs the rent (the text says «9000 قدم» — square FEET — a different defect, not this typo).
create or replace view public.land_price_unit_review_ar with (security_invoker = true) as
select s.source_table, s.listing_id, s.platform, s.city_ar, s.district_ar, s.type_ar, s.deal_ar, s.area_m2,
       s.price_total, s.price_annual, s.price_per_meter,
       case when abs(s.price_total - s.area_m2) <= 1          then 'sale_price_equals_area'
            when b.lo is null                                  then 'sale_no_price_band'
            when coalesce(e.says_thousands, false)             then 'sale_text_says_thousands'
            when s.price_total < b.lo                          then 'sale_below_band'
            when s.price_total > b.hi                          then 'sale_above_band'
            when s.price_total * s.area_m2 > 500000000         then 'sale_derived_total_too_big'
            else 'sale_per_m2_or_thousands' end as reason
  from public.search_listings_ar s
  left join lateral (select bb.lo, bb.hi from public.land_sale_ppm_band bb
                      where bb.city_ar = s.city_ar and bb.district_ar in (coalesce(s.district_ar, ''), '')
                      order by (bb.district_ar = '') limit 1) b on true
  left join public.land_price_unit_text_evidence e on e.source_table = s.source_table and e.listing_id = s.listing_id
 where s.production_ready and s.deal_ar = 'بيع' and not s.ppm_typed_as_total
   and s.type_ar like 'أرض%' and s.type_ar not like '%زراع%'
   and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100 and s.price_total / s.area_m2 < 50
   and not (s.price_per_meter is not null and abs(s.price_per_meter::numeric * s.area_m2 - s.price_total) <= 0.05 * s.price_total)
union all
select s.source_table, s.listing_id, s.platform, s.city_ar, s.district_ar, s.type_ar, s.deal_ar, s.area_m2,
       s.price_total, s.price_annual, s.price_per_meter, 'rent_tiny_for_plot'
  from public.search_listings_ar s
 where s.production_ready and s.deal_ar = 'إيجار' and s.type_ar like 'أرض%'
   and s.area_m2 between 100 and 19999 and s.price_annual > 0 and s.price_annual / s.area_m2 < 5
   and not (s.price_per_meter is not null and abs(s.price_per_meter::numeric * s.area_m2 - s.price_annual) <= 0.05 * s.price_annual)
union all
select s.source_table, s.listing_id, s.platform, s.city_ar, s.district_ar, s.type_ar, s.deal_ar, s.area_m2,
       s.price_total, s.price_annual, s.price_per_meter, 'office_area_vs_rent'
  from public.search_listings_ar s
 where s.production_ready and s.deal_ar = 'إيجار' and s.source_table = 'propertyfinder_commercial_listings'
   and s.area_m2 >= 5000 and s.price_annual > 0 and s.price_annual / s.area_m2 < 2;
revoke all on public.land_price_unit_review_ar from anon, authenticated;

select public.refresh_land_sale_ppm_band();
select public.refresh_land_price_unit_text_evidence();

-- Proof: the pure rule on the real shapes (bands as measured 2026-11-04).
do $proof$
begin
  -- abwbna 10777645, الأحساء / المطيرفي الغربي, 375 m², «1,700», no box, no words; band 380–2,700 → ≈ 637,500
  if public.land_ppm_typed_as_total_ar(1700, 375, null, 380, 2700, null, null) is distinct from 637500 then raise exception 'PROOF: the abwbna plot is not derived'; end if;
  -- abralosol 10301815, المبرز, 350 m², «1,700» with the site's own box also 1,700 (box ≠ total ÷ area) → 595,000
  if public.land_ppm_typed_as_total_ar(1700, 350, 1700, 1012, 2985, null, null) is distinct from 595000 then raise exception 'PROOF: the abralosol plot is not derived'; end if;
  -- الفوارة 1,158 m² at «15,055» with the box at 13/m² agreeing → real cheap land, untouched
  if public.land_ppm_typed_as_total_ar(15055, 1158, 13, 100, 200, null, null) is not null then raise exception 'PROOF: real cheap land was touched'; end if;
  -- the area copied into the price box (haraj: 406 for 406 m²) → never derived
  if public.land_ppm_typed_as_total_ar(406, 406, null, 238, 925, null, null) is not null then raise exception 'PROOF: price = area was derived'; end if;
  -- haraj 18706322, ضاحية نمار 1,008 m², «750», text «السوم 750 الف» → thousands, never per-metre
  if public.land_ppm_typed_as_total_ar(750, 1008, null, 637, 4033, false, true) is not null then raise exception 'PROOF: a thousands typo was read per-metre'; end if;
  -- the same figure with no words: 750,000 ÷ 1,008 = 744/m² is ALSO in band → ambiguous → no guess
  if public.land_ppm_typed_as_total_ar(750, 1008, null, 637, 4033, null, null) is not null then raise exception 'PROOF: an ambiguous figure was guessed'; end if;
  -- haraj 20440762, المزاحمية 550 m², «1,050», text «السعر :1050/م» → the words settle it → 577,500
  if public.land_ppm_typed_as_total_ar(1050, 550, null, 130, 2535, true, false) is distinct from 577500 then raise exception 'PROOF: a per-metre figure confirmed by the ad was not derived'; end if;
  -- out of band / no band → untouched
  if public.land_ppm_typed_as_total_ar(3500, 924, null, 380, 2700, null, null) is not null then raise exception 'PROOF: an above-band figure was derived'; end if;
  if public.land_ppm_typed_as_total_ar(1700, 375, null, null, null, true, false) is not null then raise exception 'PROOF: a row with no band was derived'; end if;
  -- the 500,000,000 bound
  if public.land_ppm_typed_as_total_ar(7500, 200000, null, 100, 28620, true, false) is not null then raise exception 'PROOF: the 500M bound did not hold'; end if;
  raise notice 'PROOF OK: per-metre plots derived; real cheap land, price=area, thousands, ambiguous, out-of-band and over-bound rows untouched';
end
$proof$;
