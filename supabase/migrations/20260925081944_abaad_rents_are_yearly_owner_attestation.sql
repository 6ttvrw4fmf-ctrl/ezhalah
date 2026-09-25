-- abaad's API carries NO rent-period field at all: a rent record is a bare `price` and nothing else
-- (/api/v1/estate/get-estate/all, read live 2026-09-25 — no period key exists in the schema). So the
-- platform makes no period statement, and the only one available is the owner's. Shown five
-- period-silent ads (details/975 فيلا الملقا 275,000, 898 فيلا النخيل 230,000, 964 شقة الصواري
-- 42,000, 963 فيلا الرمال 100,000, 962 فيلا المونسية 90,000), the owner answered: «those are all
-- yearly» (2026-09-25). Same class of platform-level statement as wadod (20260924224146), tamyaz
-- (20260924231422) and azure/rightcompound (20260924171605).
--
-- scrapers/abaad/run.py now falls back to rent_period='annual' when an ad states no period, with the
-- price stored EXACTLY as published — 'annual' converts nothing, so no figure can move.
--
-- THE ATTESTATION IS ABOUT SILENCE, AND THREE GATES ENFORCE THAT. All 116 live rents were classified
-- and then adversarially re-judged, and the sweep found ads where a blind yearly label would be a
-- price claim the source does not make:
--   G1 a SUB-YEAR period word — 583 «للايجار الشهري واليومي … السعر / 3800 بالشهر» and 646 «استديو
--      فاخر للإيجار الشهري» publish MONTHLY figures, so annual would understate them 12x; «نصف سنوي»
--      and «ربع سنوي» are named explicitly because they are sub-year periods spelled with the word
--      for year. Bare year-words are deliberately ignored: «تسع سنوات» / «سنتين» is BUILDING AGE on
--      13 of the 116, and a year-word can at worst agree with annual.
--   G2 the prose prints a DIFFERENT price — 526 stores 67,000 while its only price line reads
--      «السعر / 670000»; 899 prints three prices for three assets against one stored figure; 945's
--      long_description is ANOTHER property's ad entirely, which is why this field cannot be trusted
--      as a witness to its own row.
--   G3 the figure is PER UNIT — 918 is a عمارة whose body says «لإيجار 4 شقق … السعر : 30,000 ريال
--      للشقة». The platform's own annual anchors for one Abha flat (917: 24,000, 920: 25,000,
--      943: 26,000, 968: 23,000) are what prove that scope.
-- Measured over the live corpus: 72 of 116 rents take the attestation, 44 are held. Each gate is
-- executed on the platform's VERBATIM captured body in
-- scrapers/common/tests/test_abaad_land_ppm_rent_period_and_pdpl.py.
--
-- One ad was flagged by the adversarial pass and is still published as-is: 871, a rent-typed ad with
-- price 1,000,000 and no period word, argued to be likelier a sale price or a mistyped zero. Acting
-- on that would be a plausibility gate, which this repo treats as a regression — a source-published
-- price is never hidden, repaired, or swapped for one that looks better.
--
-- These rows keep mon_detect_manufactured_rent_period quiet once each table holds 20 rent rows, the
-- same way wadod's and tamyaz's do. BOTH tables are registered: abaad publishes rents in each
-- (106 residential, 9 commercial as of this migration).
insert into public.ops_rent_period_single_value_ok (table_name, only_value, reason)
select v.t, 'annual',
       'owner attestation 2026-09-25 ("those are all yearly") after opening five period-silent ads: abaad''s API has NO rent-period field, so a silent ad is the only case; scrapers/abaad/run.py falls back to annual with the price unconverted, and three measured gates hold it back — a sub-year period word (incl. نصف/ربع سنوي), a prose price that disagrees with the stored one, or a per-unit qualifier on a whole-building row. 72 of 116 live rents qualify, 44 are held.'
  from (values ('abaad_residential_listings'), ('abaad_commercial_listings')) v(t)
 where not exists (select 1 from public.ops_rent_period_single_value_ok o where o.table_name = v.t);

DO $verify$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.ops_rent_period_single_value_ok
   WHERE table_name IN ('abaad_residential_listings','abaad_commercial_listings')
     AND only_value = 'annual';
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected both abaad tables registered as annual-only, found %', n;
  END IF;
  RAISE NOTICE 'abaad''s yearly attestation is registered for both tables';
END $verify$;
