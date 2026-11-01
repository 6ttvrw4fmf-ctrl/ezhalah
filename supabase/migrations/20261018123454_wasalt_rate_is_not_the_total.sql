-- APPLIED 2026-10-18 (owner session). P1 price accuracy (owner: «we can get sued»).
--
-- WHAT THE SOURCE SHOWS (rendered /ar and /en, 2026-10-18 — coordinator's three ads, حي النرجس، الرياض):
--   5848132  1,225 m²  headline «8,000 ﷼» · «7 ﷼/متر مربع» (wasalt's own division) · «55,200% أقل من متوسط السعر»
--            description (REGA template): «سعرها 9800000 ر.س» / «Price: 9800000 SAR» = 8,000 × 1,225
--   5867449  2,000 m²  headline «9,200» · «5 /متر مربع» · «77,320% أقل…» · «سعرها 18400000 ر.س» = 9,200 × 2,000
--   5813546  467.88 m² headline «6,500» · «14 /متر مربع» · «27,550% أقل…» · en «Price: 3041220 SAR» = 6,500 × 467.88 — the
--            /ar description has no total and we store no /en description, so this one has no stored proof (see PROOF).
-- The seller typed the per-m² RATE into wasalt's price field; wasalt shows it as the headline and divides it by the area
-- again. The listing's OWN description states the total, and it equals rate × area exactly. We stored and served
-- «8,000 SAR» for a 9.8M plot, and it matched every «under 10,000» budget.
--
-- RULE (the source's own arithmetic, never a guess): a wasalt SALE row whose description total T ≠ price and
-- |T − price × area| ≤ 1% of price × area holds a RATE → price_per_meter := price, price_total := NULL. The search layer then
-- shows ≈ rate × area «محتسب من سعر المتر × المساحة — غير معلن من المصدر» and budget search finds it
-- (feedback_ppm-times-area-becomes-a-shown-searchable-total: price_total_effective, sale-only, ≤ 500M). The prose total is
-- only the PROOF of the unit — it is never stored as a price. No description total, or one that equals the price, or one
-- that matches nothing → the row is left exactly as the source shows it (extreme-price rule: never «fix» by plausibility).
--
-- WHERE: a BEFORE INSERT OR UPDATE trigger on both wasalt tables — the list sweep re-writes price_total from salePrice on
-- every crawl and never sees the description, so a data-only repair would revert within a day (the 2026-08-04 lesson,
-- verify-wasalt-price-total-never-ppm). Named to run after trg_wrl_preserve_detail (alphabetical), so the stored detail
-- payload is already in NEW. wasalt_preserve_detail() is not touched.

create or replace function public.wasalt_description_total(p_ar_data jsonb, p_description text)
returns numeric
language sql immutable
as $$
  select coalesce(
    (regexp_match(regexp_replace(coalesce(p_ar_data #>> '{propertyInfo,description}', ''), '[,٬]', '', 'g'),
                  'سعرها\s*:?\s*([0-9]+(\.[0-9]+)?)\s*(ر\.س|ريال)'))[1]::numeric,
    (regexp_match(regexp_replace(coalesce(p_description, ''), '[,٬]', '', 'g'),
                  'Price\s*:\s*([0-9]+(\.[0-9]+)?)\s*SAR'))[1]::numeric)
$$;

create or replace function public.wasalt_rate_is_not_the_total()
returns trigger
language plpgsql
as $function$
declare t numeric;
begin
  if NEW.transaction_type = 'Buy' and NEW.price_total > 0 and NEW.area_m2 > 0 then
    t := public.wasalt_description_total(NEW.ar_data, NEW.description);
    if t is not null and t <> NEW.price_total
       and abs(t - NEW.price_total::numeric * NEW.area_m2) <= 0.01 * NEW.price_total::numeric * NEW.area_m2 then
      NEW.price_per_meter := NEW.price_total;
      NEW.price_total := null;
    end if;
  end if;
  return NEW;
end $function$;

drop trigger if exists trg_wrm_rate_is_not_the_total on public.wasalt_residential_listings;
create trigger trg_wrm_rate_is_not_the_total before insert or update on public.wasalt_residential_listings
  for each row execute function public.wasalt_rate_is_not_the_total();
drop trigger if exists trg_wrm_rate_is_not_the_total on public.wasalt_commercial_listings;
create trigger trg_wrm_rate_is_not_the_total before insert or update on public.wasalt_commercial_listings
  for each row execute function public.wasalt_rate_is_not_the_total();

-- BACKFILL + PROOF (rows the rule matches today; ≤ 25k per batch — it is a few hundred)
do $proof$
declare n_res bigint; n_com bigint; bad bigint;
begin
  -- truth table on the three recorded pages + controls (executed through the same function)
  if public.wasalt_description_total('{"propertyInfo":{"description":"<p>سعرها 9800000 ر.س</p>"}}'::jsonb, null) <> 9800000
     or public.wasalt_description_total(null, 'Land Area: 467 SQM Price: 3041220 SAR') <> 3041220
     or public.wasalt_description_total('{"propertyInfo":{"description":"<p>سعرها 9,800,000 ر.س</p>"}}'::jsonb, null) <> 9800000
     or public.wasalt_description_total('{"propertyInfo":{"description":"لا يوجد سعر"}}'::jsonb, 'no price') is not null then
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
  if n_res + n_com > 25000 then raise exception 'PROOF: % rows matched — far beyond the measured few hundred; stop and look', n_res + n_com; end if;

  -- the two recorded ads whose stored description proves the unit now hold the rate as price_per_meter, no stored total
  select count(*) into bad from public.wasalt_residential_listings
   where listing_url ~ '-(5848132|5867449)$'
     and not (price_total is null and price_per_meter in (8000, 9200));
  if bad <> 0 then raise exception 'PROOF: % of the two proven ads still store the rate as the total', bad; end if;
  -- 5813546: its total is only on the /en page and we store no English description — no stored proof, so it is left
  -- exactly as the source shows it (never guessed); it heals the moment a description with its total is stored.
  if not exists (select 1 from public.wasalt_residential_listings where listing_url ~ '-5813546$' and price_total = 6500) then
    raise exception 'PROOF: an ad with no stored proof was changed';
  end if;

  -- nothing the rule matches is left with a stored total
  select count(*) into bad from public.wasalt_residential_listings w
   where w.transaction_type = 'Buy' and w.price_total > 0 and w.area_m2 > 0
     and public.wasalt_description_total(w.ar_data, w.description) is not null
     and public.wasalt_description_total(w.ar_data, w.description) <> w.price_total
     and abs(public.wasalt_description_total(w.ar_data, w.description) - w.price_total::numeric * w.area_m2) <= 0.01 * w.price_total::numeric * w.area_m2;
  if bad <> 0 then raise exception 'PROOF: % rate-as-total rows survived the trigger', bad; end if;

  -- a later sweep re-writing the rate cannot bring it back (fires the trigger on a recorded ad, rolled back)
  begin
    update public.wasalt_residential_listings set price_total = 8000 where listing_url ~ '-5848132$';
    if exists (select 1 from public.wasalt_residential_listings where listing_url ~ '-5848132$' and price_total is not null) then
      raise exception 'PROOF: a sweep re-writing 8,000 brought the rate back as the total';
    end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  raise notice 'PROOF OK: % residential + % commercial wasalt rows now hold the rate as price_per_meter', n_res, n_com;
end $proof$;
