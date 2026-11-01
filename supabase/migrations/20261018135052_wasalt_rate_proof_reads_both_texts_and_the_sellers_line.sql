-- APPLIED 2026-10-18 (owner session). P1 price accuracy, follow-up of 20261018123454_wasalt_rate_is_not_the_total.
--
-- THE GAP (coordinator, 10-18): wasalt 5813546 and 5813493 (467 m², حي النرجس) were still served at «6,500» while
-- rate_served_as_total read 0. What the source shows, read live 2026-10-18 on all 108 sale plots we served under 2% of
-- their city's median SAR/m²: 64 carry a description total = price × area (a per-m² rate typed into the price field),
-- 9 state the SAME small number as the total, 22 show only the headline, 1 is 404. The reader missed two shapes:
--   · wasalt's /ar payload often carries the ENGLISH template «Price: 3041220 SAR» (5813546) — only the separate English
--     description column was searched for it, and that column is never filled;
--   · a seller's own line «💰 السعر: 2200000 ﷼» (5857797, 400 m² at «5,500») — neither the word nor ﷼ was read.
--
-- FIX: one reader over BOTH texts, three shapes in a fixed order — the REGA template «سعرها N ر.س» first, then the English
-- template «Price: N SAR», then the seller's «السعر: N ريال|ر.س|﷼». The order matters only when a text carries two
-- different totals (4 live rows); the template wins, as before. The trigger (unchanged) still acts ONLY when the stated
-- total ≠ the price AND equals price × area within 1% — a text that says anything else leaves the row as the source shows
-- it. rate_served_as_total_rows() reads through this function, so the detector widens with it.
create or replace function public.wasalt_description_total(p_ar_data jsonb, p_description text)
returns numeric
language sql immutable
as $$
  select coalesce(
    (regexp_match(x.t, 'سعرها\s*:?\s*([0-9]+(\.[0-9]+)?)\s*(ر\.س|ريال|﷼)'))[1]::numeric,
    (regexp_match(x.t, 'Price\s*:\s*([0-9]+(\.[0-9]+)?)\s*SAR'))[1]::numeric,
    (regexp_match(x.t, 'السعر\s*:?\s*([0-9]+(\.[0-9]+)?)\s*(ر\.س|ريال|﷼)'))[1]::numeric)
    from (select regexp_replace(coalesce(p_ar_data #>> '{propertyInfo,description}', '') || ' ' || coalesce(p_description, ''),
                                '[,٬]', '', 'g') as t) x
$$;

-- BACKFILL through the trigger (a no-op write; trg_wrm_rate_is_not_the_total moves a proven rate) + PROOF.
do $proof$
declare n_res bigint; n_com bigint; bad bigint;
begin
  if public.wasalt_description_total('{"propertyInfo":{"description":"<p>سعرها 9800000 ر.س</p>"}}'::jsonb, null) <> 9800000
     or public.wasalt_description_total(null, 'Land Area: 467 SQM Price: 3041220 SAR') <> 3041220
     or public.wasalt_description_total('{"propertyInfo":{"description":"Land has electricity Price: 3,041,220 SAR"}}'::jsonb, null) <> 3041220
     or public.wasalt_description_total('{"propertyInfo":{"description":"<p>💰 السعر : 2200000 ﷼</p>"}}'::jsonb, null) <> 2200000
     or public.wasalt_description_total('{"propertyInfo":{"description":"<p>💰 السعر: 2000000 ريال</p><p>سعرها 2000700 ر.س</p>"}}'::jsonb, null) <> 2000700
     or public.wasalt_description_total('{"propertyInfo":{"description":"سعر المتر 5500 ريال"}}'::jsonb, 'no price') is not null then
    raise exception 'PROOF: wasalt_description_total() reads the wrong total';
  end if;
  update public.wasalt_residential_listings w set price_total = w.price_total
   where w.transaction_type = 'Buy' and w.price_total > 0 and w.area_m2 > 0
     and public.wasalt_description_total(w.ar_data, w.description) is not null
     and public.wasalt_description_total(w.ar_data, w.description) <> w.price_total
     and abs(public.wasalt_description_total(w.ar_data, w.description) - w.price_total::numeric * w.area_m2) <= 0.01 * w.price_total::numeric * w.area_m2;
  get diagnostics n_res = row_count;
  update public.wasalt_commercial_listings w set price_total = w.price_total
   where w.transaction_type = 'Buy' and w.price_total > 0 and w.area_m2 > 0
     and public.wasalt_description_total(w.ar_data, w.description) is not null
     and public.wasalt_description_total(w.ar_data, w.description) <> w.price_total
     and abs(public.wasalt_description_total(w.ar_data, w.description) - w.price_total::numeric * w.area_m2) <= 0.01 * w.price_total::numeric * w.area_m2;
  get diagnostics n_com = row_count;
  if n_res + n_com > 500 then raise exception 'PROOF: % rows matched — far beyond the measured 15; stop and look', n_res + n_com; end if;
  -- the coordinator's ad 5813546 (stored /ar payload carries «Price: 3041220 SAR») now holds the rate, no stored total
  if not exists (select 1 from public.wasalt_residential_listings
                  where listing_url ~ '-5813546$' and price_total is null and price_per_meter = 6500) then
    raise exception 'PROOF: 5813546 still stores its rate as the total';
  end if;
  select count(*) into bad from public.wasalt_residential_listings w
   where w.transaction_type = 'Buy' and w.price_total > 0 and w.area_m2 > 0
     and public.wasalt_description_total(w.ar_data, w.description) is not null
     and public.wasalt_description_total(w.ar_data, w.description) <> w.price_total
     and abs(public.wasalt_description_total(w.ar_data, w.description) - w.price_total::numeric * w.area_m2) <= 0.01 * w.price_total::numeric * w.area_m2;
  if bad <> 0 then raise exception 'PROOF: % rate-as-total rows survived the trigger', bad; end if;
  -- a total that equals the price is the source's own number: never moved (عرعر 5907541 «سعرها 660 ر.س» at 660)
  if exists (select 1 from public.wasalt_residential_listings where listing_url ~ '-5907541$' and price_total is distinct from 660) then
    raise exception 'PROOF: a row whose own text states the same total was changed';
  end if;
  raise notice 'PROOF OK: % residential + % commercial wasalt rows now hold the rate as price_per_meter', n_res, n_com;
end $proof$;
