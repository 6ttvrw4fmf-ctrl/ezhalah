-- Data Integrity Engineer, 2026-09-06. DETECT-ONLY, step 2 of 3.
--
-- Purely ADDITIVE: mon_price_source_corroboration gains the two timestamps whose relationship
-- drift_meaningful claims to describe. NO classification changes here — drift_meaningful is still
-- the literal `true` on the wasalt arms, and the verdict expression is untouched, so this
-- migration cannot move a single row between the P1 and P2 arms. It exists so the barrier can be
-- evaluated in the SAME pass that already scans the view instead of joining back to a 50k-row
-- table (the join form measured 14.9s on its own, which would have pushed the twice-hourly
-- detector sweep past its budget — a barrier that times out is a barrier that does not run).
--
-- Columns are APPENDED last, which is what CREATE OR REPLACE VIEW allows.
create or replace view public.mon_price_source_corroboration as
with wasalt_buy as (
  select 'wasalt_residential_listings'::text as source_table,
         id as listing_id,
         price_total::numeric as stored,
         ((ar_data -> 'propertyInfo') ->> 'salePrice')::numeric as source_price,
         'ar_data.propertyInfo.salePrice'::text as evidence_field,
         true as drift_meaningful,
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
         true,
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
