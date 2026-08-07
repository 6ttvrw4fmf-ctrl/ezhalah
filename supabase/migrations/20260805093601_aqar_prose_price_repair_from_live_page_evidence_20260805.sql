-- Repair 2 aqar rows whose stored price_total was harvested from DESCRIPTION PROSE, not the
-- source's price field. Proof is per-row and format-independent (feedback_price-repair-standard):
--   id 79498 (ad 6699811): stored 1900 = «القسط الشهري ١٩٠٠ ريال» (monthly instalment in prose).
--                          live page listing.price = 550000, status=0 (live), page ppm = null.
--   id 74477 (ad 6711624): stored 2400 = «صيانة في البرج سنوية 2400ريال» (annual maintenance fee).
--                          live page listing.price = 430000, status=0 (live), page ppm = null.
-- price_per_meter (11 / 31) is a DERIVED value the source never published (page ppm is null) and
-- was derived from the already-wrong total -> reset to NULL per the aqar source-published-only rule.

CREATE TABLE IF NOT EXISTS public.ops_price_repair_backup_20260805 (
  source_table       text        NOT NULL,
  listing_id         bigint      NOT NULL,
  ad_no              text        NOT NULL,
  old_price_total    numeric,
  new_price_total    numeric     NOT NULL,
  old_price_per_meter numeric,
  evidence           text        NOT NULL,
  backed_up_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, listing_id)
);

INSERT INTO public.ops_price_repair_backup_20260805
  (source_table, listing_id, ad_no, old_price_total, new_price_total, old_price_per_meter, evidence)
SELECT 'aqar_residential_listings', l.id, v.ad_no, l.price_total, v.new_price, l.price_per_meter, v.evidence
FROM (VALUES
  (79498, '6699811', 550000::numeric, 'live page listing.price=550000; stored 1900 traced to prose «القسط الشهري ١٩٠٠ ريال»'),
  (74477, '6711624', 430000::numeric, 'live page listing.price=430000; stored 2400 traced to prose «صيانة في البرج سنوية 2400ريال»')
) AS v(id, ad_no, new_price, evidence)
JOIN public.aqar_residential_listings l ON l.id = v.id
ON CONFLICT (source_table, listing_id) DO NOTHING;
