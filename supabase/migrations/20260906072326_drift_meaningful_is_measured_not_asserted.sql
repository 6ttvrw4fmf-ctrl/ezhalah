-- Data Integrity Engineer, 2026-09-06. THE REPAIR.
--
-- drift_meaningful stops being the literal `true` on the wasalt arms and becomes the relation it
-- always claimed: the evidence was fetched no more than 48h before the row's own source capture.
-- NULL-safe on both sides via coalesce(..., false) — an unknown pair is stale evidence, which is
-- the arm that forbids repairing anything, never the arm that invites it.
--
-- WHAT THIS MOVES, measured immediately before applying:
--   stored_overstated_10x, drift_meaningful=true : 10 -> 0   (all 10 had evidence 68-72 days old)
--   stored_overstated_10x, drift_meaningful=false:  1 -> 11
-- Nothing is dropped from monitoring. The 10 rows land in the P2 that already exists for exactly
-- this shape and that names the live source probe they need. The P1 they leave is the one whose
-- instruction is "repair to the source-displayed value" — following it on these rows would have
-- overwritten nine fresh 579,000 SAR prices with a 72-day-old 579.
--
-- THIS IS NOT A WEAKENING, and here is the proof rather than the assertion:
--   * the 10x threshold, the verdict expression and every arm's membership are untouched;
--   * the P1 stays REACHABLE — 1,461 rows currently satisfy the contemporaneity test and would
--     raise it the moment one of them disagreed by 10x;
--   * on those 1,461 contemporaneous rows the stored price agrees with the source EXACTLY, 1,461
--     of 1,461, so the P1 is not merely reachable, it is truthfully clean;
--   * the vacuity limb of the barrier in mon_detect_price_source_mismatch refuses to accept a
--     state where either side of the test is empty, so this cannot decay into a dead arm.
create or replace view public.mon_price_source_corroboration as
with wasalt_buy as (
  select 'wasalt_residential_listings'::text as source_table,
         id as listing_id,
         price_total::numeric as stored,
         ((ar_data -> 'propertyInfo') ->> 'salePrice')::numeric as source_price,
         'ar_data.propertyInfo.salePrice'::text as evidence_field,
         coalesce(ar_fetched_at >= raw_captured_at - interval '48 hours', false) as drift_meaningful,
         null::text as stored_period,
         ar_fetched_at as evidence_fetched_at,
         raw_captured_at as row_captured_at
    from wasalt_residential_listings
   where active and transaction_type = 'Buy' and price_total is not null
     and ((ar_data -> 'propertyInfo') ->> 'salePrice') ~ '^\d+(\.\d+)?$'
), wasalt_rent_yearly as (
  select 'wasalt_residential_listings'::text,
         id,
         price_annual::numeric,
         ((ar_data -> 'propertyInfo') ->> 'expectedRent')::numeric,
         'ar_data.propertyInfo.expectedRent (rentFreq default=yearly)'::text,
         coalesce(ar_fetched_at >= raw_captured_at - interval '48 hours', false),
         rent_period,
         ar_fetched_at,
         raw_captured_at
    from wasalt_residential_listings
   where active and transaction_type = 'Rent' and price_annual is not null
     and ((ar_data -> 'propertyInfo') ->> 'expectedRent') ~ '^\d+(\.\d+)?$'
     and (select e.k from jsonb_each((ar_data -> 'propertyInfo') -> 'rentFreq') e(k, v)
           where (e.v ->> 'default_freq')::boolean limit 1) = 'yearly'
), evidence as (
  select 'aqar_residential_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text,
         false, rent_period, null::timestamptz, null::timestamptz
    from aqar_residential_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'aqar_commercial_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text,
         false, rent_period, null::timestamptz, null::timestamptz
    from aqar_commercial_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'dealapp_residential_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text,
         false, rent_period, null::timestamptz, null::timestamptz
    from dealapp_residential_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'dealapp_commercial_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text,
         false, rent_period, null::timestamptz, null::timestamptz
    from dealapp_commercial_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
), all_arms as (
  select * from wasalt_buy
  union all
  select * from wasalt_rent_yearly
       wasalt_rent_yearly(source_table, listing_id, stored, source_price, evidence_field,
                          drift_meaningful, stored_period, evidence_fetched_at, row_captured_at)
  union all
  select * from evidence
       evidence(source_table, listing_id, stored, source_price, evidence_field,
                drift_meaningful, stored_period, evidence_fetched_at, row_captured_at)
)
select source_table,
       listing_id,
       stored,
       source_price,
       evidence_field,
       case
         when stored = source_price then 'agree'
         when stored = (source_price * 12) and stored_period = 'monthly'
              and evidence_field not like '%rentFreq default=yearly%' then 'agree_annualised'
         when stored > 0 and source_price >= (stored * 10) then 'stored_understated_10x'
         when source_price > 0 and stored >= (source_price * 10) then 'stored_overstated_10x'
         else 'differs_minor'
       end as verdict,
       drift_meaningful,
       stored_period,
       evidence_fetched_at,
       row_captured_at
  from all_arms;
