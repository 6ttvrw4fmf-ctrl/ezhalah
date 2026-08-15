-- Senior audit run #21 (2026-08-15). Two adjudications against LIVE source re-probes, plus the
-- repair of a distinct ppm artifact. Idempotent: the writes were applied during the run; this
-- records them so production and git agree.
--
-- A) SOURCE-PUBLISHED, PRESERVE (barrier was firing on correct data).
--    aqar ad 6749040 — live GET of the stored listing_url -> 200; aqar's RSC payload publishes
--    "price":100000000, "area":4475, "status":0. 4,475 m2 office/showroom building on King
--    Abdulaziz Rd, Riyadh = 22,346 SAR/m2, entirely ordinary; it alerts only because it lands in
--    the REGA/ID artifact band [100.0M,101.0M].
--    dealapp DA523875 — live GET https://dealapp.sa/ar/ad-details/523875 -> 200; ng-state payload
--    publishes "price":"524320800" verbatim (2 occurrences), and capture-time provenance agrees
--    (price_evidence.field=offers.price, origin=structured, raw="524320800"). The seller's free
--    text says «السوم 510 الف», so dealapp's structured price disagrees with its own description —
--    a SOURCE-side inconsistency, not an Ezhalah parse error. Fidelity rule forbids substituting a
--    free-text figure for the published structured price.
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select v.source_table, v.listing_id, v.evidence, now()
from (values
  ('aqar_residential_listings'::text, 1639844::bigint,
   'ad 6749040: live re-probe 2026-08-15 -> 200, RSC publishes price=100000000 area=4475 status=0; stored byte-identical. Source-published, preserve. Senior run #21.'::text),
  ('dealapp_residential_listings', 2305501,
   'DA523875: live re-probe 2026-08-15 -> 200, ng-state publishes "price":"524320800" verbatim; capture price_evidence.origin=structured/offers.price. Source-published, preserve. Senior run #21.')
) as v(source_table, listing_id, evidence)
where not exists (
  select 1 from public.ops_price_source_verified e
  where e.source_table = v.source_table and e.listing_id = v.listing_id);

-- B) REPAIR a distinct artifact: price_per_meter holding a VERBATIM COPY of price_total.
--    aqar publishes no per-meter figure on these pages (no «السعر بالمتر» label on any of the
--    live re-probes; correctly-parsed ad 6749040 has ppm NULL), so a ppm equal to the total is a
--    fabricated value, not a derivation. Honest NULL beats a guess. price_total is NOT touched —
--    it stays exactly as the source published it.
--    Rows: 86101 (ad 6686450), 241495 (ad 6728026), 7922029 (ad 6820795).
update public.aqar_residential_listings
set price_per_meter = null
where id in (86101, 241495, 7922029) and price_per_meter is not null and price_per_meter = price_total;

update public.search_listings_ar s
set price_per_meter = null
where s.source_table = 'aqar_residential_listings'
  and s.listing_id in (86101, 241495, 7922029)
  and s.price_per_meter is not null
  and not exists (select 1 from public.aqar_residential_listings b
                  where b.id = s.listing_id and b.price_per_meter is not null);
