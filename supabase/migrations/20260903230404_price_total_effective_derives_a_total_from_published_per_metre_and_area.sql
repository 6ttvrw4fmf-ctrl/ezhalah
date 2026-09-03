-- OWNER RULE (2026-09-03): when a listing publishes only a PER-SQUARE-METRE price, multiply it by
-- the source's own area and use that total for Filter matching and display.
--
-- WHY. The Filter asks for a TOTAL budget — nobody types a price per metre into it. So a per-m²-only
-- listing could never match any budget search, and the number on its card ("1,700") sat next to
-- totals in the millions and read as nonsense. 2,677 Buy + 50 Rent listings were in that state.
--
-- WHERE, AND WHY NOT IN THE SCRAPER. This is a SEARCH-LAYER derivation, deliberately not an ingest
-- one. scrapers/ stays bound by the fleet-wide no-derived-price rule (owner 2026-07-27,
-- scripts/verify-no-derived-price.ts): the base tables keep exactly what the source published, and
-- price_total continues to mean "the source stated this total". The derived value lives in its own
-- clearly-named column, so nothing ever confuses it for a published price and it can be withdrawn
-- by dropping one column.
--
-- A GENERATED column, not a synced one: it recomputes itself from the row it lives on, so it can
-- never drift from price_total / price_per_meter / area_m2 the way a sync-maintained copy would.
--
-- THE CREDIBILITY BOUND, and why it is not a plausibility gate on a source price. Multiplying two
-- source fields amplifies any error in either: the raw products run up to 7,000,000,000,000 SAR
-- (7 trillion), with 37 rows above 500M against a median of 618,000. Publishing those as totals
-- would be inventing an absurd number, so above the bound we DERIVE NOTHING and the row keeps its
-- per-metre price and stays out of budget matching — UNKNOWN, not wrong. This gates a value WE
-- computed; it never hides a price the source itself published (that remains forbidden —
-- verify-no-hidden-source-prices / the 2026-08 owner rule).
alter table public.search_listings_ar
  add column if not exists price_total_effective bigint
  generated always as (
    case
      -- 1. A source-published total always wins. Nothing is derived when the source spoke.
      when price_total is not null then price_total
      -- 2. Derive ONLY from two real source values: a per-metre price and a real area.
      when price_per_meter is not null and area_m2 is not null and area_m2 > 0
           and price_per_meter::bigint * area_m2 <= 500000000
        then price_per_meter::bigint * area_m2
      -- 3. Otherwise UNKNOWN — no area, or a product we cannot stand behind.
      else null
    end
  ) stored;

comment on column public.search_listings_ar.price_total_effective is
  'Buy-side total used for Filter matching and display: the SOURCE-PUBLISHED price_total when it '
  'exists, otherwise price_per_meter x area_m2 when both are real source values and the product is '
  'credible (<= 500,000,000 SAR). NULL when neither holds. price_total keeps its stricter meaning — '
  'a total the source itself stated — so a derived figure can never be mistaken for a published one. '
  'Owner rule 2026-09-03; the no-derived-price ban still applies to scrapers/ and the base tables.';

create index if not exists slar_price_total_effective_idx
  on public.search_listings_ar (price_total_effective)
  where price_total_effective is not null;

select count(*) filter (where price_total is not null) source_totals,
       count(*) filter (where price_total is null and price_total_effective is not null) newly_derived,
       count(*) filter (where price_total is null and price_per_meter is not null and area_m2 > 0
                          and price_total_effective is null) refused_not_credible,
       max(price_total_effective) max_effective
from public.search_listings_ar;
