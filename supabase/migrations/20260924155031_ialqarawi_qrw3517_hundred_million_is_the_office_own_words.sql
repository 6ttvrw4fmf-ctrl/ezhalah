-- routine-3 DATA INTEGRITY, 2026-09-24. Clears a STANDING FALSE POSITIVE with evidence, and does
-- not weaken the barrier that raised it.
--
-- field_integrity_phone_price:ialqarawi_commercial_listings has been open since 2026-09-21 on
-- exactly one row: ialqarawi_commercial_listings 12595310 (QRW3517, «للبيع أرض زراعية جنوب غرب
-- الحرابي بمدينة خميس مشيط»), price_total = 100,000,000.
--
-- It is not a captured phone number or a REGA id. The office wrote the price in words and the
-- scraper stored exactly what it wrote: additional_info.som_price_raw is «100مليون» — one hundred
-- million — with price_basis «سعر السوم» and limit_price_raw «لا يوجد». The only reason it trips
-- the detector is that 100,000,000 sits at the very edge of the REGA/ID artifact band
-- [100.0M, 101.0M], which is a heuristic over magnitude, not over provenance.
--
-- Nor is the figure implausible: the plot is 493,373 m2 of agricultural land, so the asking price
-- is 202.7 SAR/m2 — ordinary farmland in عسير.
--
-- The detector's own remedy text names this exact route: "Source-verified rows belong in
-- ops_price_source_verified, never repriced." So the row is REGISTERED, not repriced and not
-- silenced: the price stays exactly as the source published it (owner rule — an extreme but
-- source-backed value is preserved), and the barrier keeps firing for any ialqarawi row that is
-- NOT registered. Weird does not mean wrong.

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'ialqarawi_commercial_listings', 12595310,
       'QRW3517, أرض زراعية خميس مشيط, 493,373 m2 at 100,000,000 SAR = 202.7 SAR/m2. The office '
       'stated the price IN WORDS and the scraper preserved it verbatim: '
       'additional_info.som_price_raw = «100مليون», price_basis = «سعر السوم», '
       'limit_price_raw = «لا يوجد». Not a phone number and not a REGA id — it only enters the '
       '[100.0M, 101.0M] artifact band because that band is a magnitude heuristic. '
       'Registered by routine-3-data-integrity 2026-09-24; price left exactly as published.',
       now()
where not exists (
  select 1 from public.ops_price_source_verified
   where source_table = 'ialqarawi_commercial_listings' and listing_id = 12595310);

do $$
begin
  if not exists (select 1 from public.ops_price_source_verified
                  where source_table = 'ialqarawi_commercial_listings' and listing_id = 12595310) then
    raise exception 'the registration did not land';
  end if;
  -- The price itself must be UNCHANGED. Registering is not repricing.
  if (select price_total from public.ialqarawi_commercial_listings where id = 12595310) <> 100000000 then
    raise exception 'the price was altered — registering a source-verified row must never reprice it';
  end if;
  raise notice 'QRW3517 registered as source-verified; price untouched at 100,000,000';
end $$;
