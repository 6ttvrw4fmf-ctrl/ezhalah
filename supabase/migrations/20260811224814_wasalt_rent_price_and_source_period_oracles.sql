-- CLOSING THE TWO LARGEST REMAINING COVERAGE GAPS, both using evidence wasalt already stores and
-- that nothing has ever read: ar_data.propertyInfo.expectedRent and .rentFreq.
--
-- (A) PRICE ORACLE FOR RENT. The corroboration view covered wasalt BUY and the aqar/dealapp capture
--     snapshot; every wasalt RENT row was outside it. wasalt publishes expectedRent per row and it
--     agrees with our stored price on 10,448 of 10,467 yearly rows = 99.82%, which is exactly what a
--     usable oracle looks like: a tight baseline that makes the 18 disagreements meaningful.
--
--     ONLY THE YEARLY ARM SHIPS. For the 400 rows whose rentFreq default is monthly, price_annual
--     equals expectedRent x 12 on just 169 of them. I do not know what the other 231 mean, and an
--     oracle I cannot explain produces confident wrong numbers — the §19 failure this routine keeps
--     repeating. The monthly arm is deliberately excluded until its semantics are established, and
--     saying so here is cheaper than a future session re-deriving it.
--
-- (B) RENT PERIOD PROVEN FROM SOURCE SEMANTICS — the capability the owner asked for.
--     mon_detect_manufactured_rent_period (shipped earlier today) only catches a column that can
--     never say anything else. It cannot catch a per-row disagreement, and it never would have found
--     these: wasalt DOES vary its period, so it passes that detector cleanly.
--
--     rentFreq is a JSON object keyed by frequency, one entry flagged default_freq. That flag is the
--     source's own statement of the billing period. Compared to what we store:
--         source yearly  -> stored annual    10,455 rows   agree
--         source monthly -> stored monthly      399 rows   agree
--         DISAGREE                               13 rows
--     and the disagreements are not cosmetic. id 462024: wasalt says 5,000 per YEAR, we stored
--     rent_period='monthly' and annualised it to 60,000 — a 12x overstatement served to users. Same
--     shape on id 515338 (4,000/yr served as 48,000). This is the aqargate x12 class, inverted.
--
--     WHAT IS NOT USED AS THE ORACLE: expectedRentType. It reads «/سنة» (per year) on 391 rows whose
--     rentFreq default is MONTHLY — it is a static display suffix, not a per-row period. Keying the
--     detector on it would have manufactured 391 false positives and missed the real 13.
create or replace view public.mon_price_source_corroboration as
with wasalt_buy as (
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
wasalt_rent_yearly as (
  -- yearly only, on purpose — see the header note about the 231 unexplained monthly rows
  select 'wasalt_residential_listings'::text, id,
         price_annual::numeric,
         ((ar_data -> 'propertyInfo') ->> 'expectedRent')::numeric,
         'ar_data.propertyInfo.expectedRent (rentFreq default=yearly)'::text,
         true
    from public.wasalt_residential_listings
   where active and transaction_type = 'Rent' and price_annual is not null
     and ((ar_data -> 'propertyInfo') ->> 'expectedRent') ~ '^\d+(\.\d+)?$'
     and (select k from jsonb_each((ar_data -> 'propertyInfo') -> 'rentFreq') e(k, v)
           where (v ->> 'default_freq')::boolean limit 1) = 'yearly'
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
  select * from wasalt_buy
  union all select * from wasalt_rent_yearly
  union all select * from evidence
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

-- ── (B) the period oracle ────────────────────────────────────────────────────────────────────────
create or replace view public.mon_rent_period_source_corroboration as
select 'wasalt_residential_listings'::text as source_table,
       id as listing_id,
       rent_period as stored_period,
       case (select k from jsonb_each((ar_data -> 'propertyInfo') -> 'rentFreq') e(k, v)
              where (v ->> 'default_freq')::boolean limit 1)
         when 'yearly'  then 'annual'
         when 'monthly' then 'monthly'
       end as source_period,
       price_annual,
       ((ar_data -> 'propertyInfo') ->> 'expectedRent')::numeric as source_amount
  from public.wasalt_residential_listings
 where active and transaction_type = 'Rent'
   and (ar_data -> 'propertyInfo') -> 'rentFreq' is not null
   and (select k from jsonb_each((ar_data -> 'propertyInfo') -> 'rentFreq') e(k, v)
         where (v ->> 'default_freq')::boolean limit 1) is not null;

create or replace function public.mon_detect_rent_period_source_mismatch()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_bad bigint; v_checked bigint; n int := 0;
begin
  select count(*) filter (where stored_period is distinct from source_period), count(*)
    into v_bad, v_checked
    from public.mon_rent_period_source_corroboration
   where source_period is not null;

  if v_bad > 0 then
    n := public.mon_raise('P1', 'rent_period_source_mismatch', 'wasalt', 'rent_period_source_mismatch',
      jsonb_build_object(
        'mismatched', v_bad, 'corroborated', v_checked,
        'sample', (select jsonb_agg(jsonb_build_object('listing_id', listing_id, 'stored', stored_period,
                                                       'source', source_period, 'price_annual', price_annual,
                                                       'source_amount', source_amount))
                     from (select * from public.mon_rent_period_source_corroboration
                            where source_period is not null and stored_period is distinct from source_period
                            order by listing_id limit 20) x),
        'why', 'The stored rent period contradicts the period the SOURCE publishes for that row '
               '(wasalt ar_data.propertyInfo.rentFreq, the entry flagged default_freq). This is not '
               'cosmetic: a yearly rent stored as monthly is annualised x12, so a 5,000/yr listing is '
               'served at 60,000/yr. Explicit source Annual -> annual; explicit source Monthly -> '
               'monthly; silent or ambiguous -> NULL. Do NOT key this on expectedRentType — it reads '
               '«/سنة» on 391 rows whose rentFreq default is monthly and carries no per-row meaning.'));
  else
    perform public.mon_resolve_key('rent_period_source_mismatch', 'rent_period_source_mismatch');
  end if;
  return n;
end $function$;

-- ── roster wiring, SANCTIONED NEEDLE-EDIT ────────────────────────────────────────────────────────
do $$
declare
  v_def text; anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text[] := array['mon_detect_rent_period_source_mismatch']; fn text; missing text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position(anchor in v_def) = 0 then raise exception 'roster anchor missing'; end if;
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n    ' || anchor);
    end if;
  end loop;
  execute v_def;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then raise exception 'roster wiring incomplete: %', array_to_string(missing,', '); end if;
  if position('open_alerts' in v_def) = 0 then raise exception 'roster return lost open_alerts'; end if;
end $$;

-- ── MUTATION TESTS ───────────────────────────────────────────────────────────────────────────────
do $mut$
declare v_cov bigint; v_rent_arm bigint; v_bad bigint; v_checked bigint; v_label_would_flag bigint;
begin
  select count(*), count(*) filter (where evidence_field like 'ar_data.propertyInfo.expectedRent%')
    into v_cov, v_rent_arm from public.mon_price_source_corroboration;
  if v_rent_arm = 0 then
    raise exception 'wasalt Rent arm added no rows — coverage did not actually grow';
  end if;

  select count(*) filter (where stored_period is distinct from source_period), count(*)
    into v_bad, v_checked from public.mon_rent_period_source_corroboration where source_period is not null;

  -- the oracle must be TIGHT: a period comparison that disagrees on a large fraction is measuring
  -- the wrong thing, not finding a defect. 99.8%+ agreement is what makes the residue meaningful.
  if v_checked = 0 then raise exception 'period oracle corroborated nothing'; end if;
  if v_bad::numeric / v_checked > 0.02 then
    raise exception 'period oracle disagrees on %/% rows — too loose to be believed', v_bad, v_checked;
  end if;
  if v_bad = 0 then
    raise exception 'period oracle found nothing on a cohort measured at 13 live mismatches minutes ago';
  end if;

  -- MUTATION: prove the field choice matters. Keying on expectedRentType instead of rentFreq would
  -- flag every row whose label is «/سنة» but whose default_freq is monthly — hundreds of false
  -- positives. If that count is not far larger than the real one, the two fields agree and the
  -- header's justification for choosing rentFreq is wrong.
  select count(*) into v_label_would_flag
    from public.wasalt_residential_listings
   where active and transaction_type='Rent'
     and (ar_data->'propertyInfo'->>'expectedRentType') like '%سنة%'
     and rent_period = 'monthly';
  if v_label_would_flag <= v_bad then
    raise exception 'field-choice mutation failed: expectedRentType would flag % vs rentFreq %, so the '
                    'two are equivalent and the stated reason for preferring rentFreq does not hold',
                    v_label_would_flag, v_bad;
  end if;

  raise notice 'price coverage % rows (rent arm %); period oracle %/% mismatched; label-keyed oracle would have flagged % instead',
    v_cov, v_rent_arm, v_bad, v_checked, v_label_would_flag;
end $mut$;
