-- Senior audit run #21 (2026-08-15). Two barrier corrections for wasalt rent-period fidelity.
--
-- ── 1. mon_rent_period_source_corroboration: carry the SNAPSHOT AGE ────────────────────────────
-- The detector compared `rent_period` (English search-list, refreshed every 8h) against ar_data
-- (Arabic detail page). enrich_ar selects ONLY `ar_fetched=false`, so a successfully enriched row's
-- ar_data is written once and NEVER refreshed: measured 42.1 days stale on average, 50.7 max, with
-- 10,533 of 10,688 rows older than 7 days. The barrier was therefore comparing the same field ~6
-- weeks apart and reporting ordinary price drift as a source contradiction — unresolvable by
-- construction, which is why it sat "blocked" for days.
--
-- This does NOT silence it. It splits the population and proves both directions:
--   contemporaneous (ar snapshot <=48h old):  46 compared, 0 mismatched  (0.000%)
--   stale           (ar snapshot  >48h old): 10,648 compared, 11 mismatched (0.103%)
-- ALL 11 standing mismatches are in the stale bucket; there is not one disagreement between the two
-- endpoints when both describe the same moment. So the endpoints are NOT in conflict, and the 11
-- rows must not be "repaired" from a six-week-old snapshot (already tried once: migration
-- 20260813064929 repaired listing 4334897 from ar_data and it reverted 205 run.py runs later).
create or replace view public.mon_rent_period_source_corroboration as
 select 'wasalt_residential_listings'::text as source_table,
    id as listing_id,
    rent_period as stored_period,
    case (select e.k
            from jsonb_each((wasalt_residential_listings.ar_data -> 'propertyInfo') -> 'rentFreq') e(k, v)
           where (e.v ->> 'default_freq')::boolean limit 1)
      when 'yearly'  then 'annual'::text
      when 'monthly' then 'monthly'::text
      else null::text
    end as source_period,
    price_annual,
    ((ar_data -> 'propertyInfo') ->> 'expectedRent')::numeric as source_amount,
    ar_fetched_at,
    last_seen_at,
    -- Hours between the two observations. NULL ar_fetched_at is treated as maximally stale.
    round(extract(epoch from (now() - ar_fetched_at)) / 3600.0, 1) as ar_age_hours,
    (ar_fetched_at is not null and ar_fetched_at >= now() - interval '48 hours') as contemporaneous
   from wasalt_residential_listings
  where active and transaction_type = 'Rent'
    and ((ar_data -> 'propertyInfo') -> 'rentFreq') is not null
    and (select e.k from jsonb_each((wasalt_residential_listings.ar_data -> 'propertyInfo') -> 'rentFreq') e(k, v)
          where (e.v ->> 'default_freq')::boolean limit 1) is not null;

-- P1 now requires a CONTEMPORANEOUS disagreement (both endpoints describing the same moment).
-- A stale-only population is reported at P3 as a coverage signal, never as a source contradiction.
create or replace function public.mon_detect_rent_period_source_mismatch()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_bad bigint; v_checked bigint; v_stale_bad bigint; n int := 0;
begin
  select count(*) filter (where stored_period is distinct from source_period and contemporaneous),
         count(*) filter (where contemporaneous),
         count(*) filter (where stored_period is distinct from source_period and not contemporaneous)
    into v_bad, v_checked, v_stale_bad
    from public.mon_rent_period_source_corroboration
   where source_period is not null;

  if v_bad > 0 then
    n := public.mon_raise('P1', 'rent_period_source_mismatch', 'wasalt', 'rent_period_source_mismatch',
      jsonb_build_object(
        'mismatched_contemporaneous', v_bad, 'compared_contemporaneous', v_checked,
        'mismatched_stale_only', v_stale_bad,
        'sample', (select jsonb_agg(jsonb_build_object('listing_id', listing_id, 'stored', stored_period,
                         'source', source_period, 'price_annual', price_annual,
                         'source_amount', source_amount, 'ar_age_hours', ar_age_hours))
                     from (select * from public.mon_rent_period_source_corroboration
                            where source_period is not null and contemporaneous
                              and stored_period is distinct from source_period
                            order by listing_id limit 20) x),
        'why', 'The stored rent period disagrees with this row''s ar_data AND both observations are '
               'contemporaneous (ar snapshot <=48h old), so this is NOT explainable as price drift. '
               'Two different wasalt endpoints genuinely published different periods for the same '
               'moment. A yearly rent stored as monthly is annualised x12, so the served price can '
               'be 12x wrong in either direction. Adjudicate at the source before touching anything.'));
  else
    perform public.mon_resolve_key('rent_period_source_mismatch', 'rent_period_source_mismatch');
  end if;

  if v_stale_bad > 0 then
    n := n + public.mon_raise('P3', 'rent_period_stale_snapshot_only', 'wasalt',
      'rent_period_stale_snapshot_only',
      jsonb_build_object('stale_mismatches', v_stale_bad,
        'why', 'These rows differ from ar_data, but ar_data is a one-time snapshot that enrich_ar '
               'never refreshes (42.1 days stale on average). Ordinary rent changes at the source '
               'produce exactly this. NOT evidence of an Ezhalah defect and NOT repairable from '
               'ar_data — a repair would revert live prices to a weeks-old snapshot. Informational: '
               'it measures ar_data decay, not price fidelity.'));
  else
    perform public.mon_resolve_key('rent_period_stale_snapshot_only', 'rent_period_stale_snapshot_only');
  end if;
  return n;
end $function$;

-- ── 2. NEW barrier: measure the x12 annualisation exposure ────────────────────────────────────
-- Where wasalt publishes BOTH a monthly and a yearly amount and we stored monthly*12, the stored
-- annual is a DERIVED figure that contradicts the source's own published annual. Measured on
-- contemporaneous rows: 13 of 14 have yearly != monthly*12, and 9 are stored as monthly*12.
-- This is NOT auto-repaired: swapping to the published yearly would make the card's price_annual/12
-- monthly headline disagree with the source's advertised monthly instead. One column cannot carry
-- both, so which figure the card shows is an owner product decision. This barrier exists so the
-- exposure is measured and visible every hour rather than invisible while that decision is pending.
create or replace function public.mon_detect_wasalt_annualisation_fabricated()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_n bigint; v_served bigint; n int := 0;
begin
  select count(*), count(*) filter (where served) into v_n, v_served
  from (
    select (s.listing_id is not null) as served
    from public.wasalt_residential_listings w
    left join public.search_listings_ar s
      on s.source_table = 'wasalt_residential_listings' and s.listing_id = w.id and s.production_ready
    where w.active and w.transaction_type = 'Rent' and w.rent_period = 'monthly'
      and (w.ar_data->'propertyInfo'->'rentFreq'->'monthly'->>'amount') is not null
      and (w.ar_data->'propertyInfo'->'rentFreq'->'yearly' ->>'amount') is not null
      and w.price_annual = (w.ar_data->'propertyInfo'->'rentFreq'->'monthly'->>'amount')::numeric * 12
      and (w.ar_data->'propertyInfo'->'rentFreq'->'yearly'->>'amount')::numeric
          <> (w.ar_data->'propertyInfo'->'rentFreq'->'monthly'->>'amount')::numeric * 12
  ) q;

  if v_n > 0 then
    n := public.mon_raise('P2', 'wasalt_annualisation_fabricated', 'wasalt',
      'wasalt_annualisation_fabricated',
      jsonb_build_object('rows', v_n, 'served', v_served,
        'why', 'price_annual here is monthly*12 while wasalt publishes its OWN yearly amount that is '
               'not 12x the monthly (annual-prepay discounts make that normal). The stored annual is '
               'therefore a derived figure contradicting a published one. DO NOT auto-swap to the '
               'published yearly: the card renders price_annual/12 as the monthly headline, so that '
               'would misstate the advertised monthly instead. Owner decision, escalated 2026-08-15.',
        'owner_decision', 'Which figure should the card show when wasalt publishes both — the exact '
                          'monthly headline (today), or the exact published annual? Carrying both '
                          'needs a second column and a card change.'));
  else
    perform public.mon_resolve_key('wasalt_annualisation_fabricated', 'wasalt_annualisation_fabricated');
  end if;
  return n;
end $function$;
