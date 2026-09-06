-- COMPANION to 20260905070828 (the muktamel rent re-annualisation) and 20260905071148 (the
-- detector). It exists because `scripts/verify-repair-migrations-are-guarded.ts` is right: a repair
-- that lands one migration apart from its detector never reaches a mon_detect_* in executed SQL,
-- so from the barrier's side it is indistinguishable from a bare backfill nothing watches.
--
-- This is the same shape as the two 2026-08 precedents (20260824115704, 20260828230419): RE-ASSERT
-- the repair idempotently from its own ledger, then RUN the detector that watches the class.
--
-- Re-assertion is meaningful here even though muktamel's cron is disabled — that is precisely why.
-- A repair whose platform is never re-crawled can only ever be undone by something OTHER than the
-- scraper (a restore, a bulk edit, a future re-enable of an older scraper build). The ledger holds
-- price_before AND price_after per row, so "has this repair decayed?" is a question with an exact
-- answer, and this migration re-answers it at deploy time while the detector re-answers it twice an
-- hour.
--
-- It corrects only rows that still hold the exact pre-repair value recorded in the ledger. A row
-- that has since moved to a THIRD value is deliberately left alone and reported: that is a fact
-- somebody needs to look at, not something to overwrite (§0.1 — evidence before the write).

do $$
declare
  v_reasserted int := 0;
  v_third      int := 0;
  v_detector   int;
begin
  with upd as (
    update muktamel_residential_listings l
       set price_annual = r.price_after
      from ops_rent_annualisation_repair r
     where r.source_table = 'muktamel_residential_listings'
       and r.listing_id = l.id
       and l.price_annual = r.price_before
    returning 1)
  select count(*) into v_reasserted from upd;

  with upd as (
    update muktamel_commercial_listings l
       set price_annual = r.price_after
      from ops_rent_annualisation_repair r
     where r.source_table = 'muktamel_commercial_listings'
       and r.listing_id = l.id
       and l.price_annual = r.price_before
    returning 1)
  select v_reasserted + count(*) into v_reasserted from upd;

  -- A row sitting at neither price_before nor price_after has been changed by something else.
  select (select count(*) from muktamel_residential_listings l
            join ops_rent_annualisation_repair r
              on r.source_table = 'muktamel_residential_listings' and r.listing_id = l.id
           where l.price_annual is distinct from r.price_after)
       + (select count(*) from muktamel_commercial_listings l
            join ops_rent_annualisation_repair r
              on r.source_table = 'muktamel_commercial_listings' and r.listing_id = l.id
           where l.price_annual is distinct from r.price_after)
    into v_third;

  if v_third <> 0 then
    raise warning 'rent annualisation repair: % ledgered row(s) hold a value that is neither '
                  'price_before nor price_after - left untouched, investigate before overwriting',
                  v_third;
  end if;

  -- RUN the detector that watches this class, in the same migration.
  select public.mon_detect_unannualised_rent_cohort() into v_detector;

  raise notice 'rent annualisation: reasserted=% third_value=% detector_raised=%',
    v_reasserted, v_third, v_detector;
end $$;
