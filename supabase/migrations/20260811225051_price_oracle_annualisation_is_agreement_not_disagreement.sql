-- FIXING A FALSE-POSITIVE CLASS I CREATED IN THE MIGRATION AN HOUR AGO.
--
-- Extending the corroboration oracle to dealapp took >=10x hits from 23 to 85. 52 of the 52 new
-- dealapp hits are the same arithmetic identity:
--     dealapp_residential  49 of 49  stored = source_price x 12
--     dealapp_commercial    3 of 3   stored = source_price x 12
-- That is not a defect. price_evidence.stored records the RAW offers.price, while price_annual holds
-- the ANNUAL figure by schema contract (the app divides by 12 for the monthly card). For a monthly
-- rental the two SHOULD differ by exactly 12. I compared an annualised column against a
-- pre-annualisation witness and called the difference corruption.
--
-- This is precisely the failure I warned about in the header of 20260811125945 — "a barrier that
-- cries wolf is the failure mode of 2026-08-08" — committed by me, one migration later. 52 false
-- positives in a P1 payload would have trained the next reader to skim past the 22 real aqar rows
-- sitting in the same alert.
--
-- THE FIX IS NARROW, NOT A THRESHOLD. x12 counts as agreement only where it is genuinely the
-- annualisation identity:
--   * the row's own stored period is 'monthly' (so annualising was the correct operation), AND
--   * the arm is not the wasalt rent-yearly arm, where the SOURCE explicitly says yearly and any
--     x12 is therefore the bug, not the contract.
-- That second clause is what keeps wasalt 462024 (wasalt publishes 5,000/YEAR, we serve 60,000) and
-- 515338 (4,000/yr served as 48,000) visible. Gating on x12 alone would have hidden both.
create or replace view public.mon_price_source_corroboration as
with wasalt_buy as (
  select 'wasalt_residential_listings'::text as source_table, id as listing_id,
         price_total::numeric as stored,
         ((ar_data -> 'propertyInfo') ->> 'salePrice')::numeric as source_price,
         'ar_data.propertyInfo.salePrice'::text as evidence_field,
         true as drift_meaningful, null::text as stored_period
    from public.wasalt_residential_listings
   where active and transaction_type = 'Buy' and price_total is not null
     and ((ar_data -> 'propertyInfo') ->> 'salePrice') ~ '^\d+(\.\d+)?$'
),
wasalt_rent_yearly as (
  select 'wasalt_residential_listings'::text, id, price_annual::numeric,
         ((ar_data -> 'propertyInfo') ->> 'expectedRent')::numeric,
         'ar_data.propertyInfo.expectedRent (rentFreq default=yearly)'::text,
         true, rent_period
    from public.wasalt_residential_listings
   where active and transaction_type = 'Rent' and price_annual is not null
     and ((ar_data -> 'propertyInfo') ->> 'expectedRent') ~ '^\d+(\.\d+)?$'
     and (select k from jsonb_each((ar_data -> 'propertyInfo') -> 'rentFreq') e(k, v)
           where (v ->> 'default_freq')::boolean limit 1) = 'yearly'
),
evidence as (
  select 'aqar_residential_listings'::text, id, coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false, rent_period
    from public.aqar_residential_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'aqar_commercial_listings'::text, id, coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false, rent_period
    from public.aqar_commercial_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'dealapp_residential_listings'::text, id, coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false, rent_period
    from public.dealapp_residential_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'dealapp_commercial_listings'::text, id, coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false, rent_period
    from public.dealapp_commercial_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
),
all_arms as (
  select * from wasalt_buy
  union all select * from wasalt_rent_yearly
  union all select * from evidence
)
select source_table, listing_id, stored, source_price, evidence_field,
       case
         when stored = source_price then 'agree'
         -- the annualisation identity: price_annual = a monthly source figure x 12, by contract
         when stored = source_price * 12
              and stored_period = 'monthly'
              and evidence_field not like '%rentFreq default=yearly%' then 'agree_annualised'
         when stored > 0 and source_price >= stored * 10 then 'stored_understated_10x'
         when source_price > 0 and stored >= source_price * 10 then 'stored_overstated_10x'
         else 'differs_minor'
       end as verdict,
       drift_meaningful, stored_period
  from all_arms;

do $mut$
declare v_hits bigint; v_annualised bigint; v_dealapp_hits bigint; v_wasalt_period_hits bigint;
begin
  select count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')),
         count(*) filter (where verdict = 'agree_annualised'),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')
                            and source_table like 'dealapp%')
    into v_hits, v_annualised, v_dealapp_hits
    from public.mon_price_source_corroboration;

  if v_annualised = 0 then
    raise exception 'the annualisation identity matched nothing — the false positives are still hits';
  end if;
  if v_dealapp_hits <> 0 then
    raise exception 'dealapp still contributes % >=10x hits; every one measured was exactly x12', v_dealapp_hits;
  end if;

  -- CONTROL, and the whole reason the fix is narrow: the two wasalt rows where the SOURCE says
  -- yearly and we annualised anyway are real defects and MUST survive. Gating on x12 alone hides them.
  select count(*) into v_wasalt_period_hits
    from public.mon_price_source_corroboration
   where verdict in ('stored_understated_10x','stored_overstated_10x')
     and evidence_field like '%rentFreq default=yearly%';
  if v_wasalt_period_hits = 0 then
    raise exception 'CONTROL LOST: the wasalt source-says-yearly-but-we-annualised rows were suppressed';
  end if;

  raise notice '>=10x hits % (dealapp %, wasalt-yearly-period %), reclassified as annualisation identity: %',
    v_hits, v_dealapp_hits, v_wasalt_period_hits, v_annualised;
end $mut$;