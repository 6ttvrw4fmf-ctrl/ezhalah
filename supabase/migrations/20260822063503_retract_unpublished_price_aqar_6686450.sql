-- Ezhalah served a 500,000 SAR price on a listing whose source publishes NO price (senior run #35).
--
-- THE SOURCE, probed live 2026-08-22. aqar ad 6686450 (aqar_residential_listings id 86101,
-- Commercial Land, 600 m², حي ولي العهد / مكة المكرمة). Its App-Router payload listing object reads:
--     "price": 500000, "published": false, "price_text": "طلب تسويق",
--     "meter_price": 500000, "rega_total_price": null, "area": 600, "status": 0, "closed": false
-- `published:false` is the ONE case where aqar's payload carries a number it does not show: the
-- price slot renders «طلب تسويق» and the human sees no figure. scrapers/aqar/enrich_residential.py
-- `_structured_price()` documents exactly this and returns (None, authoritative=True) — "importing
-- that number would put a price on our card that the source page does not display, so it stays
-- NULL — aqar's non-publication is itself the published fact."
--
-- THE ENRICHER OBEYED THAT RULE AND THE ROW KEPT THE PRICE ANYWAY. This row's own capture records
-- the enricher's decision: source_capture->'price_evidence'->>'stored' IS NULL — it stored no
-- price. The 500,000 in the column is older, and survived because
-- db._unknown_must_not_overwrite_known() deletes any key whose value is None before the upsert.
-- That guard (owner rule 2026-08-09) cannot tell "this fetch could not read the field" from "the
-- source authoritatively states there is no value", so an authoritative NULL is dropped exactly
-- like an unreadable one and the stale figure survives every future crawl.
-- This is the same trap 20260821224203 names for city: "the fourth-plus occurrence" (alhoshan
-- instalments, eastabha EA21188, aqar residential areas, aqar commercial area) — here in price.
--
-- SCOPE OF THE CLASS IS NOT ASSUMED HERE. 444 active aqar residential rows have
-- price_evidence.stored IS NULL while carrying a price; that number is an UPPER BOUND and most of
-- it is the guard working as designed (a pass that simply could not read the price). Only rows
-- whose CURRENT payload says published:false are defects, and separating them needs a live probe
-- per row. This migration therefore retracts exactly ONE row — the one probed — and the systemic
-- question (should the guard learn to distinguish an authoritative NULL?) goes to the owner, since
-- it changes a fleet-wide safety gate.
--
-- price_per_meter is LEFT UNTOUCHED: meter_price=500000 is a figure aqar's own payload publishes,
-- and «سعر المتر» is rendered on the page. Extreme-but-published values are preserved (owner rule);
-- only the figure the source declines to publish is retracted.
--
-- The retraction sticks without any further change: the next crawl sends price_total=None, the
-- guard drops the key, and the stored NULL survives. A price only ever returns if aqar publishes one.

create table if not exists public.ops_price_repair_backup_20260822 (
  source_table      text        not null,
  listing_id        bigint      not null,
  ad_number         text,
  price_total_before bigint,
  price_per_meter_before integer,
  retracted_at      timestamptz not null default now(),
  evidence          text        not null,
  primary key (source_table, listing_id)
);

do $$
declare
  v_price bigint;
  v_ppm   integer;
  v_ad    text;
  v_control bigint;
  v_before bigint;
  v_after  bigint;
begin
  select price_total, price_per_meter, ad_number
    into v_price, v_ppm, v_ad
    from public.aqar_residential_listings where id = 86101;

  if v_price is null then
    raise notice 'already retracted; nothing to do';
    return;
  end if;

  if v_ad <> '6686450' or v_price <> 500000 then
    raise exception 'refusing to retract: expected ad 6686450 price_total 500000, found ad % price %',
      v_ad, v_price;
  end if;

  -- CONTROL: a row whose price the enricher DID store must survive untouched. This is what stops a
  -- targeted retraction turning into a sweep.
  select price_total into v_control
    from public.aqar_residential_listings
   where active and price_total is not null
     and (source_capture->'price_evidence'->>'stored') is not null
   limit 1;
  if v_control is null then
    raise exception 'no control row with a stored price found — refusing to write blind';
  end if;

  select count(*) into v_before
    from public.aqar_residential_listings where active and price_total is not null;

  insert into public.ops_price_repair_backup_20260822
    (source_table, listing_id, ad_number, price_total_before, price_per_meter_before, evidence)
  values ('aqar_residential_listings', 86101, v_ad, v_price, v_ppm,
    'senior run #35 live probe 2026-08-22: GET sa.aqar.fm ad 6686450 -> HTTP 200; listing object '
    || '"price":500000 with "published":false and "price_text":"طلب تسويق" — aqar publishes NO price '
    || 'for this ad. _structured_price() returns (None, authoritative) for published:false; the row''s '
    || 'own source_capture->price_evidence->>stored is NULL, confirming the enricher stored nothing. '
    || 'The 500000 predates that decision and survived because _unknown_must_not_overwrite_known() '
    || 'drops a None key rather than writing NULL. price_per_meter (meter_price=500000, rendered as '
    || '«سعر المتر») is source-published and deliberately NOT retracted.')
  on conflict (source_table, listing_id) do nothing;

  update public.aqar_residential_listings
     set price_total = null
   where id = 86101;

  select count(*) into v_after
    from public.aqar_residential_listings where active and price_total is not null;

  if v_after <> v_before - 1 then
    raise exception 'expected exactly one row to lose its price, before=% after=%', v_before, v_after;
  end if;

  -- the control must be untouched
  if (select price_total from public.aqar_residential_listings
       where active and price_total is not null
         and (source_capture->'price_evidence'->>'stored') is not null limit 1) is null then
    raise exception 'control row lost its price — the retraction was not targeted';
  end if;
end $$;
