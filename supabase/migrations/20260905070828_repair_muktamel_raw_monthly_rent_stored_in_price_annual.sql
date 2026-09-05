-- INCIDENT #38 — the §21 retraction trap, in its purest form.
--
-- price_annual is a YEARLY column: src/data/listings.ts divides it by 12 for any row whose
-- rent_period is monthly, so the card shows the monthly rent the source published. muktamel's
-- run.py did `price_annual = price` for BOTH periods, so every row it labelled monthly holds the
-- RAW monthly figure and rendered at 1/12 of the advertised rent (2,500/mo shown as «ر.س 208»).
--
-- The scraper was fixed on 2026-09-05 (commit 4c06c07 — it now calls normalize.annualize_rent)
-- and the class barrier scripts/verify-rent-scrapers-annualise.ts went green. Neither touched the
-- rows the old code had already written, and gh-muktamel-weekly (cron jobid 14) is active=false,
-- so no future crawl will ever correct them. A fixed scraper and a green barrier are not a fixed
-- database.
--
-- WHY THIS IS A REPAIR AND NOT A REWRITE OF SOURCE DATA. We are not inventing, estimating or
-- rounding anything. muktamel publishes ONE figure (offer.price) plus its own period flag
-- (offer.isRentPerYear), and we archive that flag per row in additional_info.is_rent_per_year.
-- It reads FALSE on 130 of 130 rows in this cohort — the source itself says these figures are
-- per-month. The stored price_annual IS offer.price verbatim (the old code applied no transform),
-- so ×12 is Ezhalah's own documented unit contract applied to the source's own declared period.
-- It is exactly what the fixed scraper emits today. The source's published figure stays fully
-- recoverable: ops_rent_annualisation_repair records price_before for every row.
--
-- NOT A MAGNITUDE HEURISTIC. Nothing here keys on "the number looks too small" (§8: weird is not
-- wrong). The discriminator is the source's own boolean, archived at scrape time.

create table if not exists ops_rent_annualisation_repair (
  id            bigserial primary key,
  source_table  text        not null,
  listing_id    bigint      not null,
  price_before  bigint      not null,
  price_after   bigint      not null,
  period_flag   text        not null,
  evidence      text        not null,
  repaired_at   timestamptz not null default now(),
  unique (source_table, listing_id)
);

comment on table ops_rent_annualisation_repair is
  'Per-row provenance for rent figures re-annualised after a scraper stored a raw sub-annual figure '
  'in price_annual (incident #38, muktamel). price_before preserves the source''s own published '
  'figure verbatim, so the repair is reversible and the source value is never lost.';

do $$
declare
  v_res_before int;
  v_com_before int;
  v_flagged    int;
  v_updated    int;
  v_ctl_res    int;
  v_ctl_com    int;
  v_bad        int;
begin
  -- ── PRE-STATE, asserted. The cohort must be exactly what was adjudicated. ──────────────────
  select count(*) into v_res_before from muktamel_residential_listings
    where active and rent_period = 'monthly';
  select count(*) into v_com_before from muktamel_commercial_listings
    where active and rent_period = 'monthly';

  select (select count(*) from muktamel_residential_listings
            where active and rent_period = 'monthly'
              and additional_info->>'is_rent_per_year' = 'false')
       + (select count(*) from muktamel_commercial_listings
            where active and rent_period = 'monthly'
              and additional_info->>'is_rent_per_year' = 'false')
    into v_flagged;

  if v_res_before + v_com_before <> v_flagged then
    raise exception 'REFUSING: % monthly rows but only % carry the source flag is_rent_per_year=false. '
                    'A row whose period the source did not declare must not be annualised.',
                    v_res_before + v_com_before, v_flagged;
  end if;

  -- CONTROL (§21): the annual rows are the untouched half of this platform. Pin them now.
  select count(*) into v_ctl_res from muktamel_residential_listings
    where active and rent_period = 'annual';
  select count(*) into v_ctl_com from muktamel_commercial_listings
    where active and rent_period = 'annual';

  -- ── LEDGER FIRST, so the source's published figure is preserved before anything changes ────
  insert into ops_rent_annualisation_repair
        (source_table, listing_id, price_before, price_after, period_flag, evidence)
  select 'muktamel_residential_listings', id, price_annual, price_annual * 12, 'false',
         'muktamel offer.isRentPerYear=false (archived in additional_info.is_rent_per_year); '
         'price_annual held offer.price verbatim (old run.py did price_annual = price for both '
         'periods); x12 per the price_annual yearly-column contract, matching the fixed scraper.'
    from muktamel_residential_listings
   where active and rent_period = 'monthly'
     and additional_info->>'is_rent_per_year' = 'false'
     and price_annual is not null
  on conflict (source_table, listing_id) do nothing;

  insert into ops_rent_annualisation_repair
        (source_table, listing_id, price_before, price_after, period_flag, evidence)
  select 'muktamel_commercial_listings', id, price_annual, price_annual * 12, 'false',
         'muktamel offer.isRentPerYear=false (archived in additional_info.is_rent_per_year); '
         'price_annual held offer.price verbatim (old run.py did price_annual = price for both '
         'periods); x12 per the price_annual yearly-column contract, matching the fixed scraper.'
    from muktamel_commercial_listings
   where active and rent_period = 'monthly'
     and additional_info->>'is_rent_per_year' = 'false'
     and price_annual is not null
  on conflict (source_table, listing_id) do nothing;

  -- ── THE REPAIR. Idempotent by construction: a row is multiplied only while the ledger still
  -- shows it holding price_before. A re-run finds price_annual = price_after and does nothing. ──
  with upd as (
    update muktamel_residential_listings l
       set price_annual = r.price_after
      from ops_rent_annualisation_repair r
     where r.source_table = 'muktamel_residential_listings'
       and r.listing_id = l.id
       and l.price_annual = r.price_before
       and l.price_annual <> r.price_after
    returning 1)
  select count(*) into v_updated from upd;

  with upd as (
    update muktamel_commercial_listings l
       set price_annual = r.price_after
      from ops_rent_annualisation_repair r
     where r.source_table = 'muktamel_commercial_listings'
       and r.listing_id = l.id
       and l.price_annual = r.price_before
       and l.price_annual <> r.price_after
    returning 1)
  select count(*) into v_updated from upd, (select v_updated) _ ;

  -- ── POST-STATE, asserted. Every monthly row must now equal its ledgered price_after. ────────
  select (select count(*) from muktamel_residential_listings l
            join ops_rent_annualisation_repair r
              on r.source_table = 'muktamel_residential_listings' and r.listing_id = l.id
           where l.price_annual <> r.price_after)
       + (select count(*) from muktamel_commercial_listings l
            join ops_rent_annualisation_repair r
              on r.source_table = 'muktamel_commercial_listings' and r.listing_id = l.id
           where l.price_annual <> r.price_after)
    into v_bad;
  if v_bad <> 0 then
    raise exception 'REFUSING: % repaired rows do not match the ledger', v_bad;
  end if;

  -- CONTROL held: the annual cohort must be exactly as many rows as before and untouched by the
  -- ledger. A repair that starts sweeping the annual half is data loss, not a fix.
  if (select count(*) from muktamel_residential_listings
        where active and rent_period = 'annual') <> v_ctl_res
     or (select count(*) from muktamel_commercial_listings
           where active and rent_period = 'annual') <> v_ctl_com then
    raise exception 'REFUSING: the annual control cohort moved';
  end if;

  if exists (select 1 from ops_rent_annualisation_repair r
               join muktamel_residential_listings l on l.id = r.listing_id
              where r.source_table = 'muktamel_residential_listings'
                and l.rent_period <> 'monthly') then
    raise exception 'REFUSING: an annual row entered the repair ledger';
  end if;

  raise notice 'muktamel rent annualisation repair: res_before=% com_before=% flagged=% ledgered=%',
    v_res_before, v_com_before, v_flagged,
    (select count(*) from ops_rent_annualisation_repair);
end $$;
