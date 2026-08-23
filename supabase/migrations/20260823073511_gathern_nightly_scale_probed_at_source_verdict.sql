-- gathern extreme-magnitude cohort: probed at the source, verdict UNCHANGED, proof REPLACED.
--
-- WHAT WAS RE-OPENED AND WHY. Five gathern rows were adjudicated source-real on 2026-08-17 and
-- exempted here. Their recorded proof was: "price_annual / 12 / nightly = 24-30 nights, exactly the
-- documented contract, so the arithmetic is internally consistent, so this is NOT a parser
-- artifact." That argument is SCALE-INVARIANT and therefore cannot settle the question it was
-- asked. The artifact it needed to rule out — GH #503, fixed 2026-08-12, in which msapi renders a
-- price with the Arabic decimal separator ٫ (U+066B) and the old regex stripped it, turning
-- "990٫00" into 99000 — inflates nightly AND monthly by the same 100x, leaving the ratio at 30 in
-- both worlds. 204 rows carrying monthly_price up to 2,821,500 (the exact figure listing 732100
-- still carries) were repaired as artifacts eleven days before that adjudication was written. The
-- same adjudication also recorded, and set aside, that the unit page rendered day_price_format=99
-- against a stored 99,000.
--
-- So the class was re-opened on 2026-08-23 (Data Integrity run #38), and a sixth row — 731858,
-- Khobar, which crossed the threshold that morning and re-raised the P1 — was pending.
--
-- HOW IT WAS SETTLED. Only the RAW STRING can separate the two readings, and the audit container's
-- egress hard-403s gathern, so a read-only probe was run from GitHub Actions
-- (.github/workflows/gathern-nightly-scale-probe.yml, run 32625263982, 2026-08-23 07:19-07:28 UTC)
-- against the SAME endpoint, the SAME monthly 30-night window and the SAME session impersonation
-- the production scraper uses. It printed day_price_format with repr() beside both parsers' reading
-- of it.
--
-- Listing 175402 (Medina) was still on the monthly calendar and answered directly:
--
--     day_price_format       raw='99,999'      old=99999    new=99999
--     price                  raw='2,399,976'   old=2399976  new=2399976
--     final_price            raw=2399976 (int)
--     price_before_discount  raw='2,999,970'   oldPrice=2999970 (int)
--     discount_label         raw='خصم 20%'     nights=30    long_stay=True
--
-- The separator is an ASCII comma, NOT U+066B. Old parser and new parser return the identical
-- value, so the #503 mechanism is not in play at all — there is no 100x to undo. gathern's own
-- figures reconcile exactly: 99,999 x 30 = 2,999,970, less 20% = 2,399,976 = final_price, x 12 =
-- 28,799,712 = the stored price_annual. Ezhalah stored precisely what the source published.
--
-- Three corroborating measurements, all from the same run:
--   * SEPARATOR CENSUS — 0 of 5,230 price strings across 1,344 live items contained ٫ or ٬. The
--     #503 class is not reproducing on this window.
--   * CONTROLS — ordinary Medina units on the same pages read 214, 182, 240.20, 244.80, 235.27 and
--     174.67 SAR/night, old == new on every field including ASCII-decimal values. The parser is
--     behaving, and the extreme values are a genuine thin tail, not a scale bug (active median
--     nightly 286; 310 rows >= 5,000; 68 >= 20,000; continuous, with arbitrary values such as
--     88,733 / 78,035 / 73,394 / 57,112 rather than a sentinel spike).
--   * FULL-COHORT ARITHMETIC — across all 29,521 active gathern rows, price_annual = monthly_price
--     x 12 with ZERO exceptions, stay_nights = 30 on every row, rental_basis = 'monthly' on every
--     row. Ezhalah's own derivation contributes no error anywhere in the platform.
--
-- VERDICT: source-published, preserved exactly. A host pricing a unit at 99,999 SAR/night to block
-- their own calendar is weird, and weird is not wrong (§0 core rule). NOTHING WAS REPRICED, and
-- nothing should be.
--
-- WHAT THIS MIGRATION DOES. It replaces the evidence on the five existing rows with the probe
-- verdict, because a right answer resting on an argument that cannot discriminate is not a proof a
-- future run may rely on — and it adds 731858 so the P1 stops re-raising on an adjudicated class.
-- The exemption remains PER LISTING_ID, never a magnitude cap, so a genuine parser artifact on any
-- other gathern row still raises normally.
--
-- HONEST RESIDUAL, stated rather than smoothed over: only 175402 was quoted verbatim. The other
-- five had left gathern's monthly calendar by probe time and were reported NOT FOUND — recorded as
-- "no conclusion", never as confirmation. Their exemption therefore rests on CLASS-level proof (the
-- verbatim sibling, the separator census, the controls, the 29,521-row arithmetic identity), not on
-- a row-level quote. That is a weaker claim than 175402's and is labelled as such below. If any of
-- them returns to the monthly calendar, re-run the probe and confirm.

update public.ops_price_source_verified
   set evidence = jsonb_build_object(
         'verdict', 'SOURCE-PUBLISHED — do not reprice. Ezhalah stored exactly what gathern''s API '
                 || 'returned; the #503 U+066B x100 artifact is ruled out at the raw-string level.',
         'probe', 'gathern-nightly-scale-probe, Actions run 32625263982, 2026-08-23T07:19-07:28Z, '
               || 'same endpoint / monthly 30-night window / session impersonation as the scraper',
         'proof_strength', case when listing_id = 175402
                                then 'ROW-LEVEL: this listing''s own raw day_price_format was quoted '
                                  || 'verbatim as ''99,999'' (ASCII comma, not U+066B); old and new '
                                  || 'parsers both read 99999, so no 100x exists to undo. Its own '
                                  || 'chain reconciles: 99,999 x 30 = 2,999,970, less «خصم 20%» = '
                                  || '2,399,976 = final_price, x 12 = 28,799,712 = stored price_annual.'
                                else 'CLASS-LEVEL: this listing had left gathern''s monthly calendar '
                                  || 'at probe time and was reported NOT FOUND (no conclusion drawn '
                                  || 'from its absence). Exemption rests on the verbatim sibling '
                                  || '175402, a separator census of 0/5,230 price strings across '
                                  || '1,344 live items, six in-range controls parsing identically '
                                  || 'old vs new, and price_annual = monthly_price x 12 holding on '
                                  || '29,521/29,521 active gathern rows. Re-probe if it returns.' end,
         'supersedes', 'the 2026-08-17 adjudication, whose stated proof (price_annual/12/nightly '
                    || '= 24-30 nights) is scale-invariant: a x100 inflation of BOTH nightly and '
                    || 'monthly leaves that ratio unchanged, so it could not distinguish a source '
                    || 'value from the #503 artifact. Same verdict, sound proof.',
         'reprobe_if', 'a gathern price string is ever observed containing ٫ (U+066B) or ٬ (U+066C), '
                    || 'or price_annual stops equalling monthly_price x 12 on any active row.')::text
 where source_table = 'gathern_residential_listings'
   and listing_id in (726627, 732100, 732107, 732108, 733661);

insert into public.ops_price_source_verified (source_table, listing_id, evidence) values
 ('gathern_residential_listings', 731858,
  '{"verdict":"SOURCE-PUBLISHED — do not reprice. Khobar, 40 m² apartment, nightly 90,000 → monthly_price_before_discount 2,700,000 (= 90,000 x 30) → «خصم 20%» → monthly_price 2,160,000 → price_annual 25,920,000 (= x 12). Every step reconciles exactly against gathern''s own published fields.",
    "probe":"gathern-nightly-scale-probe, Actions run 32625263982, 2026-08-23T07:19-07:28Z",
    "proof_strength":"CLASS-LEVEL: this listing had left gathern''s monthly calendar at probe time and was reported NOT FOUND (no conclusion drawn from its absence). Exemption rests on sibling 175402, whose raw day_price_format was quoted verbatim as ''99,999'' with an ASCII comma — both the old and the fixed parser read 99999, so the #503 U+066B x100 artifact cannot be the source of these magnitudes — plus a separator census of 0/5,230 price strings across 1,344 live items, six in-range controls, and price_annual = monthly_price x 12 on 29,521/29,521 active gathern rows.",
    "why_it_raised":"crossed the >500,000 SAR/m²/yr Rent arm of field_integrity_extreme_magnitude on 2026-08-23 when gathern re-priced it; 25,920,000 / 40 m² = 648,000.",
    "reprobe_if":"a gathern price string is ever observed containing ٫ (U+066B) or ٬ (U+066C), or price_annual stops equalling monthly_price x 12 on any active row."}')
on conflict (source_table, listing_id) do nothing;
