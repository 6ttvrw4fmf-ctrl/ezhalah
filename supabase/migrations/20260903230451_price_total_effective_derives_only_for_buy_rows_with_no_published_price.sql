-- Tighten the derivation shipped minutes ago: it was too broad and I caught it on the counts.
--
-- THE DEFECT. The first version derived whenever price_total was null. That is true of every RENT
-- row — their price lives in price_annual — so any rent listing that also carried a per-metre figure
-- got a fabricated "total" that means nothing for a rental. It derived 5,954 rows where only ~2,700
-- were genuinely price-less, i.e. ~3,200 rent rows acquired a sale-shaped total they should not have.
--
-- THE RULE, stated precisely: derive a total ONLY for a row that
--   (a) is a SALE (deal_ar = 'بيع') — a per-metre x area product is a sale price, never a rent, and
--   (b) has NO published price of any kind (price_total AND price_annual both null), and
--   (c) publishes a real per-metre price and a real area (> 0), and
--   (d) yields a credible product (<= 500,000,000 SAR).
-- Anything else keeps whatever the source published, or stays UNKNOWN.
alter table public.search_listings_ar drop column if exists price_total_effective;

alter table public.search_listings_ar
  add column price_total_effective bigint
  generated always as (
    case
      -- A source-published total always wins; nothing is derived when the source spoke.
      when price_total is not null then price_total
      -- Sale rows with no published price at all, from two real source values, within a credible bound.
      when deal_ar = 'بيع'
           and price_annual is null
           and price_per_meter is not null
           and area_m2 is not null and area_m2 > 0
           and price_per_meter::bigint * area_m2 <= 500000000
        then price_per_meter::bigint * area_m2
      else null
    end
  ) stored;

comment on column public.search_listings_ar.price_total_effective is
  'Buy-side total for Filter matching and display: the SOURCE-PUBLISHED price_total when present, '
  'else price_per_meter x area_m2 for a SALE row that publishes no price at all, from two real '
  'source values, capped at a credible 500,000,000 SAR. NULL otherwise. Never derived for rent '
  '(their price is price_annual) and never overwrites a published total. price_total keeps its '
  'stricter meaning: a total the source itself stated. Owner rule 2026-09-03; scrapers/ and the base '
  'tables remain bound by the no-derived-price ban.';

create index if not exists slar_price_total_effective_idx
  on public.search_listings_ar (price_total_effective)
  where price_total_effective is not null;

select count(*) filter (where price_total is not null and price_total_effective = price_total) source_totals_passed_through,
       count(*) filter (where price_total is not null and price_total_effective is distinct from price_total) source_total_altered_must_be_0,
       count(*) filter (where price_total is null and price_total_effective is not null) derived,
       count(*) filter (where price_total is null and price_total_effective is not null and deal_ar <> 'بيع') derived_for_rent_must_be_0,
       count(*) filter (where price_total is null and price_annual is not null and price_total_effective is not null) derived_over_a_rent_price_must_be_0
from public.search_listings_ar;
