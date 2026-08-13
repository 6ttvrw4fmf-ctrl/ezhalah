-- price_eq_area_or_ppm P1 (alert 491, 2026-08-13 03:29, count=2) — ADJUDICATED SOURCE-REAL.
-- Senior Production Engineer run #15.
--
-- Both flagged rows are dealapp عرعر residential-land ads whose stored price equals their area.
-- That shape is the signature of the area-as-price parser artifact (the 55-row incident of
-- 2026-08-10), so the detector is right to ask. It is NOT what happened here: each row's own
-- price_evidence witness records the figure coming from dealapp's OWN schema.org structured field,
-- with no pipeline arithmetic anywhere in the path.
--
--   1134805 (حي قرطبة, قطعة 569, 720 m2): price_evidence = {field: offers.price, raw: "720",
--     origin: structured, found: true, stored: 720}. The ad's own text states «مساحة 720م».
--   2872995 (حي غرناطة, قطع 437+439, 25m street): price_evidence = {field: offers.price, raw: "660",
--     origin: structured, found: true, stored: 660}.
--
-- `origin: structured` + `found: true` means the number was read from the source document's
-- offers.price, not computed — the price stored is byte-identical to the price dealapp publishes.
--
-- This is the SAME bar, the SAME city and the SAME seller convention already adjudicated on
-- 2026-08-12 for four neighbouring عرعر plots (1039957 720/720, 1134815 630/630, 1134818 704/704,
-- and 1134750, whose description says outright «البيع المتر بريال فقط» — selling per meter for
-- riyals only, which is exactly why these ads carry a near-nominal total). A recurring local
-- listing convention is not a parser bug, and under the owner's absolute fidelity rule an unusual
-- but source-published figure is preserved exactly, never repriced or hidden for looking wrong.
--
-- Nothing here touches listing data: the rows keep the prices dealapp published. This records the
-- per-listing adjudication so a proven-source-real row stops re-raising a P1 forever, while a
-- genuine artifact on any OTHER row still fires — the waiver is per listing_id, never a rule that
-- price==area is acceptable in general.
insert into public.ops_price_eq_area_verified (source_table, listing_id, evidence) values
 ('dealapp_residential_listings', 1134805,
  'أرض سكنية للبيع, عرعر (حي قرطبة), قطعة 569, 720 m2, price_total=720 (price_per_meter=1). '
  'price_evidence witness: field=offers.price raw="720" origin=structured found=true stored=720 — '
  'read from dealapp''s own schema.org offers.price, byte-identical, no pipeline computation. Ad '
  'text independently states «مساحة 720م». Same عرعر nominal-total seller convention adjudicated '
  '2026-08-12 for 1039957/1134815/1134818/1134750. Source-published; preserved under the '
  'source-fidelity rule.'),
 ('dealapp_residential_listings', 2872995,
  'أرض سكنية للبيع, عرعر (حي غرناطة), قطع 437+439, شارع 25م, area_m2=660, price_total=660 '
  '(price_per_meter=1). price_evidence witness: field=offers.price raw="660" origin=structured '
  'found=true stored=660 — read from dealapp''s own schema.org offers.price, byte-identical, no '
  'pipeline computation. Same عرعر nominal-total seller convention adjudicated 2026-08-12 for '
  '1039957/1134815/1134818/1134750. Source-published; preserved under the source-fidelity rule.')
on conflict (source_table, listing_id) do nothing;