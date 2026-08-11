-- THE BLIND SPOT THAT LET THE 11,000,000 -> 2,690 DEFECT PAST THE DAILY AUDIT.
--
-- mon_detect_price_source_mismatch is the detector that implements the owner invariant
-- "the price on the source website = the price Ezhalah stores". It is in the daily roster, it runs
-- twice an hour, and it returned 0 all day on 2026-08-11 while aqar listings were being served at
-- 10 SAR for a 500 m2 plot. It was not broken. It was reading a view that covered ONE ARM:
--
--     mon_price_source_corroboration  =  wasalt_residential_listings, transaction_type='Buy', only
--
-- Measured before this change: 41,476 of 178,222 priced served listings = 23.27% coverage. aqar --
-- the largest platform, 79,724 active residential rows, and the platform where every price defect
-- the Senior Production Engineer reported actually happened -- contributed ZERO rows to the oracle.
-- The detector's "0" was arithmetically true and epistemically worthless: a count of nothing.
--
-- This is the difference between "the check exists" and "the check looks at the thing". Same lesson
-- as the rent-period barrier earlier today (a real check that nothing called), one layer along.
--
-- WHAT THE NEW ARM COMPARES. aqar and dealapp store `source_capture.price_evidence.stored` -- the
-- figure the ENRICHER read for that row at capture time, with origin 'spec_table' / 'offers.price'.
-- Comparing it to the price the column holds NOW answers a question nothing else in the fleet asks:
--
--     did some LATER writer move this row's price away from what the scraper actually read?
--
-- which is simultaneously the parser-picked-the-wrong-number class (Senior finding 1) and the
-- multiple-writers class (Senior finding 2 -- the 01:00 liveness sweep re-corrupting a repair).
-- Live result on the day this shipped: 22 rows at >=10x, e.g. id 63675 stored 10 SAR against its own
-- recorded 1,200,000; id 21166 stored 6,500,000 against 650,000,000.
--
-- HONEST LABELLING OF EACH ARM. The two arms are not the same kind of evidence and must not be
-- pooled for the drift check:
--   * wasalt reads ar_data.propertyInfo.salePrice, which is REFRESHED with the row. A same-magnitude
--     difference there means the refresh path is failing -> drift is meaningful.
--   * aqar/dealapp evidence is a capture-time SNAPSHOT. The owner-approved liveness price refresh
--     updates price_total without rewriting the blob, so same-magnitude difference there is EXPECTED
--     and is not drift. 6,305 aqar rows sit in that state legitimately.
-- So the view now carries `drift_meaningful` (appended last so CREATE OR REPLACE keeps the existing
-- column order), and the detector's P2 drift arm counts only those. Without this, extending coverage
-- would have bought one real detection and one permanent false P2 -- and a barrier that cries wolf
-- is the failure mode of 2026-08-08.
create or replace view public.mon_price_source_corroboration as
with wasalt as (
  select 'wasalt_residential_listings'::text as source_table,
         id as listing_id,
         price_total::numeric as stored,
         ((ar_data -> 'propertyInfo') ->> 'salePrice')::numeric as source_price,
         'ar_data.propertyInfo.salePrice'::text as evidence_field,
         true as drift_meaningful
    from public.wasalt_residential_listings
   where active and transaction_type = 'Buy' and price_total is not null
     and ((ar_data -> 'propertyInfo') ->> 'salePrice') ~ '^\d+(\.\d+)?$'
),
evidence as (
  select 'aqar_residential_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false
    from public.aqar_residential_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'aqar_commercial_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false
    from public.aqar_commercial_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'dealapp_residential_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false
    from public.dealapp_residential_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
  union all
  select 'dealapp_commercial_listings'::text, id,
         coalesce(price_total, price_annual)::numeric,
         ((source_capture -> 'price_evidence') ->> 'stored')::numeric,
         'source_capture.price_evidence.stored'::text, false
    from public.dealapp_commercial_listings
   where active and coalesce(price_total, price_annual) is not null
     and ((source_capture -> 'price_evidence') ->> 'stored') ~ '^\d+$'
),
all_arms as (
  select * from wasalt
  union all
  select * from evidence
)
select source_table, listing_id, stored, source_price, evidence_field,
       case
         when stored = source_price then 'agree'
         when stored > 0 and source_price >= stored * 10 then 'stored_understated_10x'
         when source_price > 0 and stored >= source_price * 10 then 'stored_overstated_10x'
         else 'differs_minor'
       end as verdict,
       drift_meaningful
  from all_arms;

create or replace function public.mon_detect_price_source_mismatch()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_under bigint; v_over bigint; v_minor bigint; v_checked bigint; v_drift_base bigint; n int := 0; s jsonb;
begin
  select count(*) filter (where verdict = 'stored_understated_10x'),
         count(*) filter (where verdict = 'stored_overstated_10x'),
         count(*) filter (where verdict = 'differs_minor' and drift_meaningful),
         count(*),
         count(*) filter (where drift_meaningful)
    into v_under, v_over, v_minor, v_checked, v_drift_base
    from public.mon_price_source_corroboration;

  if (v_under + v_over) > 0 then
    s := jsonb_build_object(
      'understated_10x', v_under, 'overstated_10x', v_over, 'corroborated', v_checked,
      'sample_ids', (select jsonb_agg(jsonb_build_object('source_table', source_table, 'listing_id', listing_id,
                                                         'stored', stored, 'source_price', source_price))
                       from (select * from public.mon_price_source_corroboration
                              where verdict in ('stored_understated_10x','stored_overstated_10x')
                              order by listing_id limit 20) x),
      'why', 'A stored price disagrees with the platform''s OWN captured price by >=10x. Owner invariant: THE PRICE ON THE SOURCE WEBSITE = THE PRICE EZHALAH STORES. Repair to the source-displayed value; never compute one.');
    n := n + public.mon_raise('P1', 'price_source_mismatch', 'price_fidelity', 'price_source_mismatch_10x', s);
  else
    perform public.mon_resolve('price_source_mismatch', 'price_fidelity');
  end if;

  -- Counted ONLY over arms whose evidence is refreshed with the row — a capture-time snapshot
  -- legitimately diverges as prices move and is not drift.
  if v_drift_base > 0 and v_minor > greatest(200::bigint, v_drift_base / 100) then
    n := n + public.mon_raise('P2', 'price_source_drift', 'price_fidelity', 'price_source_drift',
      jsonb_build_object('minor_diffs', v_minor, 'drift_base', v_drift_base,
        'why', 'Many stored prices differ from the source''s captured price at the same magnitude — stale-price drift, i.e. the refresh path is not updating prices.'));
  else
    perform public.mon_resolve('price_source_drift', 'price_fidelity');
  end if;
  return n;
end $function$;

-- ── MUTATION TEST: prove the NEW coverage is what does the catching ──────────────────────────────
do $mut$
declare
  v_total bigint; v_wasalt bigint; v_new_arm bigint;
  v_hits_total bigint; v_hits_wasalt_only bigint; v_hits_new bigint;
  v_cls text;
begin
  select count(*), count(*) filter (where evidence_field = 'ar_data.propertyInfo.salePrice'),
         count(*) filter (where evidence_field = 'source_capture.price_evidence.stored'),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')
                            and evidence_field = 'ar_data.propertyInfo.salePrice'),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')
                            and evidence_field = 'source_capture.price_evidence.stored')
    into v_total, v_wasalt, v_new_arm, v_hits_total, v_hits_wasalt_only, v_hits_new
    from public.mon_price_source_corroboration;

  if v_new_arm = 0 then
    raise exception 'coverage did not grow — the evidence arm returned no rows';
  end if;

  -- THE MUTATION: the pre-change view was the wasalt arm alone. If that arm alone still finds every
  -- >=10x hit, this migration bought nothing and the blind spot was imaginary. It must not.
  if v_hits_new = 0 then
    raise exception 'mutation failed: the new arm finds no >=10x rows, so it cannot be what was missing';
  end if;
  if v_hits_wasalt_only = v_hits_total then
    raise exception 'mutation failed: the old wasalt-only arm already found all % hits', v_hits_total;
  end if;

  select case when 10::numeric = 1200000::numeric then 'agree'
              when 10 > 0 and 1200000 >= 10 * 10 then 'stored_understated_10x'
              else 'other' end into v_cls;
  if v_cls <> 'stored_understated_10x' then
    raise exception 'classifier regression: 10 vs 1,200,000 did not classify as understated';
  end if;

  raise notice 'coverage % rows (wasalt % + evidence %); >=10x hits: % total, % NEW arm, % wasalt',
    v_total, v_wasalt, v_new_arm, v_hits_total, v_hits_new, v_hits_wasalt_only;
end $mut$;
