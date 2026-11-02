-- THE METER-BOX TYPO RULE SEES THE SIBLINGS (owner 2026-10-30: «fix the root of it so it doesn't keep popping, and add a guard»).
--
-- price_typed_in_meter_box_ar() only fired when the served total tripped price_size_impossible() — a per-meter figure above
-- 5,000,000 SAR/m². A seller who typed 1,350,000 (the lot's TOTAL) into Deal App's «سعر المتر» box over 625 m² produced
-- 843,750,000 SAR = 1,350,000/m², under that bar, so the card printed 843,750,000 next to neighbours at 1.0–1.9 M.
-- PROVEN on the live site 2026-10-30 23:45 UTC (Riyadh / حي الحزم / 625 m², dealapp 20483625) AFTER PR 9479 deployed.
--
-- Measured 2026-10-30 (served sale rows, ppm ≥ 100,000 and ppm = total ÷ area within 2 SAR): 455 rows — 414 residential
-- outside the two holy cities (449 «أرض سكنية»; every one of them is a sane total once read as the box figure), 38
-- residential in مكة المكرمة / المدينة المنورة, 3 commercial. In the holy cities the same shape is REAL: Madinah land is
-- listed at 850,000 SAR/m² with the box agreeing (673,251,000 for 792 m²), so the signature cannot tell a typo from a
-- price there — those keep the old 5,000,000 bar. Commercial rows keep it too (their clean maximum is 303,030/m²).
--
-- Rule now (Buy only): the box figure is served as the total when it equals total ÷ area (±0.2%), is a sane total for the
-- area (0.1–150,000 SAR/m², not impossible), AND the served per-meter figure is implausible: above 5,000,000 anywhere, or
-- at/above 100,000 for a residential row outside the holy cities. Same inputs, one more context pair (city, commercial);
-- the TS mirror (src/lib/meterBoxPrice.ts) carries the identical rule and scripts/verify-card-price-follows-meter-box-rule.ts
-- executes both. The 3-argument signature is dropped (one overload, PGRST203 rule); its two callers are repointed below
-- by targeted text edits, never a full-function replace.
drop function if exists public.price_typed_in_meter_box_ar(numeric, integer, numeric);

create or replace function public.price_typed_in_meter_box_ar(p numeric, area integer, ppm numeric, city_ar text, commercial boolean)
returns numeric
language sql
immutable
as $function$
  select ppm
   where p is not null and ppm is not null and ppm >= 1000
     and area between 1 and 50000000
     and (public.price_size_impossible(p, null, area)
          or (not coalesce(commercial, false)
              and coalesce(city_ar, '') not in ('مكة المكرمة', 'المدينة المنورة')
              and p / area >= 100000))
     and abs(p / area - ppm) <= greatest(ppm * 0.002, 1)
     and ppm / area between 0.1 and 150000
     and not public.price_size_impossible(ppm, null, area)
$function$;

comment on function public.price_typed_in_meter_box_ar(numeric, integer, numeric, text, boolean) is
  'A sale TOTAL typed into the site''s «سعر المتر» box: returns the box figure when it equals total ÷ area and the served per-meter figure is implausible (> 5,000,000 anywhere; ≥ 100,000 for residential outside مكة المكرمة / المدينة المنورة). Mirrored in src/lib/meterBoxPrice.ts. Owner 2026-10-28 / 2026-10-30.';

-- Repoint the two callers by exact text edits.
do $edit$
declare d text; k int;
begin
  -- 1. the index trigger
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_price_size_sanity';
  k := (length(d) - length(replace(d, 'public.price_typed_in_meter_box_ar(NEW.price_total, NEW.area_m2, NEW.price_per_meter)', ''))) / length('public.price_typed_in_meter_box_ar(NEW.price_total, NEW.area_m2, NEW.price_per_meter)');
  if k <> 1 then raise exception 'enforce_price_size_sanity: expected exactly 1 call to repoint, found %', k; end if;
  execute replace(d, 'public.price_typed_in_meter_box_ar(NEW.price_total, NEW.area_m2, NEW.price_per_meter)',
                     'public.price_typed_in_meter_box_ar(NEW.price_total, NEW.area_m2, NEW.price_per_meter, NEW.city_ar, NEW.source_table like ''%commercial%'')');
  -- 2. the served-typo alarm (one call site in production; the prose mentions are not calls)
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_impossible_price_size';
  k := (length(d) - length(replace(d, 'public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter)', ''))) / length('public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter)');
  if k <> 1 then raise exception 'mon_detect_impossible_price_size: expected exactly 1 call to repoint, found %', k; end if;
  execute replace(d, 'public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter)',
                     'public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter, s.city_ar, s.source_table like ''%commercial%'')');
end $edit$;

-- Proof: the six 2026-10-28 cases still hold with no context; the sibling is corrected; the holy cities and commercial rows keep the old bar.
do $proof$
begin
  if public.price_typed_in_meter_box_ar(140360991328, 5585, 25132140, null, false) is distinct from 25132140 then raise exception 'PROOF: the proven typo is not corrected'; end if;
  if public.price_typed_in_meter_box_ar(3858750000000, 525000, 7350000, null, false) is distinct from 7350000 then raise exception 'PROOF: the 14 SAR/m² farm is not corrected'; end if;
  if public.price_typed_in_meter_box_ar(6666666667, 450, null, null, false) is not null then raise exception 'PROOF: a row with no per-meter field was guessed'; end if;
  if public.price_typed_in_meter_box_ar(3000000000150, 450, 900000, null, false) is not null then raise exception 'PROOF: a non-matching box was used'; end if;
  if public.price_typed_in_meter_box_ar(1500000, 600, 2500, 'الرياض', false) is not null then raise exception 'PROOF: a sane price was rewritten'; end if;
  if public.price_typed_in_meter_box_ar(6200990767, 62, 100015980, 'الرياض', false) is not null then raise exception 'PROOF: an absurd per-meter box was served'; end if;
  -- the sibling: dealapp 20483625, Riyadh land, 625 m², 843,750,000 served, box 1,350,000 → the box
  if public.price_typed_in_meter_box_ar(843750000, 625, 1350000, 'الرياض', false) is distinct from 1350000 then raise exception 'PROOF: the 1,350,000/m² sibling is not corrected'; end if;
  -- the same shape in Madinah is a real price (850,000/m² land with the box agreeing) → untouched
  if public.price_typed_in_meter_box_ar(673251000, 792, 850000, 'المدينة المنورة', false) is not null then raise exception 'PROOF: a holy-city price was rewritten'; end if;
  if public.price_typed_in_meter_box_ar(843750000, 625, 1350000, 'مكة المكرمة', false) is not null then raise exception 'PROOF: Makkah lost the old bar'; end if;
  -- a commercial row keeps the old bar
  if public.price_typed_in_meter_box_ar(843750000, 625, 1350000, 'الرياض', true) is not null then raise exception 'PROOF: a commercial row was rewritten under the residential bar'; end if;
  -- exactly 100,000/m² residential outside the holy cities is in
  if public.price_typed_in_meter_box_ar(40000000, 400, 100000, 'الرياض', false) is distinct from 100000 then raise exception 'PROOF: the 100,000 edge is not corrected'; end if;
  -- 99,999/m² is not
  if public.price_typed_in_meter_box_ar(39999600, 400, 99999, 'الرياض', false) is not null then raise exception 'PROOF: below the bar was rewritten'; end if;
  raise notice 'PROOF OK: six old cases hold, the sibling is corrected, holy cities and commercial keep the 5,000,000 bar';
end $proof$;

-- Re-judge the served rows now (the trigger does the work; the hourly sync re-applies it on every later upsert).
do $apply$
declare before_n bigint; after_n bigint;
begin
  select count(*) into before_n from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'بيع'
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter, s.city_ar, s.source_table like '%commercial%') is not null;
  update public.search_listings_ar s set price_total = s.price_total
   where s.production_ready and s.deal_ar = 'بيع'
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter, s.city_ar, s.source_table like '%commercial%') is not null;
  select count(*) into after_n from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'بيع'
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter, s.city_ar, s.source_table like '%commercial%') is not null;
  if after_n <> 0 then raise exception 'APPLY: % served rows still match the typo shape after the re-judge', after_n; end if;
  raise notice 'APPLY OK: % served sale rows re-judged, 0 left matching the typo shape', before_n;
end $apply$;
