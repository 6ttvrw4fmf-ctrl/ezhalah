-- Close the two age-registry gaps the readiness detector raised — one admitted, one refused, both
-- on live source evidence rather than on the presence of a populated column (2026-09-03).
--
-- ── SANADAK: ADMITTED ───────────────────────────────────────────────────────────────────────────
-- sanadak.sa is a Next.js RSC site, so a plain curl proves nothing: the listing object lives in an
-- escaped flight payload. Probing it properly (unescape, then read the object whose
-- advertisementNumber matches the row) shows the age field is "buildingAge", labelled «عمر البناء».
--
--   LIVE PROBE 2026-09-03, ad-number-scoped, 5/5 EXACT:
--     7201051563  buildingAge 4  -> stored 4
--     7200751907  buildingAge 1  -> stored 1
--     7201023952  buildingAge 0  -> stored 0
--     7201059139  buildingAge 11 -> stored 11
--     7201025208  buildingAge 11 -> stored 11
--
-- The 0 was interrogated rather than assumed, because a dominant 0 is exactly the aldarim
-- year_built sentinel trap. It is NOT a sentinel here: 0 is 31.3% of sanadak's aged rows, which is
-- BELOW two already-trusted peers — aqar 57.7% (34,745 rows) and raghdan 71.7% — where 0 is the
-- established encoding of «جديد». And 11 is a literal published integer, not a bucket: both 11-rows
-- probed return buildingAge 11 verbatim. So sanadak stores what the source publishes, unchanged.
--
-- Strategy is canonical_column: the value already sits in property_age. NOTE for whoever maintains
-- scrapers/sanadak/run.py — that file no longer writes property_age at all, so these values are
-- frozen per-row from an earlier capture and new rows arrive age-less. Re-adding the buildingAge
-- read is the follow-up that makes this coverage grow instead of decay.
--
-- ── MUKTAMEL: REFUSED, with the reason recorded ─────────────────────────────────────────────────
-- muktamel.com IS live and DOES publish an age, and 2 of 3 probes matched exactly:
--     32001  «عمر العقار 2 سنة»  -> stored 2   MATCH
--     31787  «عمر العقار 6 سنة»  -> stored 6   MATCH
--     32221  «عمر العقار +10 سنة» -> stored 11  MISMATCH
-- "+10" is an OPEN-ENDED BUCKET meaning "10 or more". Storing it as 11 invents precision the source
-- never published: an AF query for age=11 would falsely match those rows, and age>=10 vs age=10
-- would disagree with the advertisement. 43 active rows carry that fabricated 11 (against just 4
-- genuine 10s), so this is not a rounding nit — it is a source-truth defect in the ingest.
-- muktamel therefore stays UNREGISTERED and its 486 aged rows stay UNKNOWN to the Advanced Filter,
-- which is the correct outcome: absent beats wrong. Admitting it would publish 43 listings under an
-- age the advertiser did not state.
insert into public.age_source_registry (source_table, strategy, trusted, note, jsonb_key)
values
  ('sanadak_residential_listings', 'canonical_column', true,
   'TRUSTED 2026-09-03 (RSC-aware probe): sanadak.sa renders its listing object into an escaped RSC '
   || 'flight payload; unescaped and scoped by advertisementNumber, the field is "buildingAge" '
   || '(«عمر البناء»). 5/5 exact vs stored: 7201051563=4, 7200751907=1, 7201023952=0, 7201059139=11, '
   || '7201025208=11. The 0 is NOT the aldarim sentinel — at 31.3% it sits below trusted peers aqar '
   || '(57.7%) and raghdan (71.7%), where 0 encodes «جديد»; and 11 is a literal published integer, '
   || 'not an open bucket. CAVEAT: scrapers/sanadak/run.py no longer writes property_age, so this '
   || 'coverage is frozen per-row and will not grow until the buildingAge read is restored.', null),
  ('sanadak_commercial_listings', 'canonical_column', true,
   'as residential — same buildingAge field in the same RSC payload, same 2026-09-03 probe.', null)
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted,
      note = excluded.note, jsonb_key = excluded.jsonb_key, updated_at = now();

-- muktamel is recorded as DECIDED-AND-REFUSED so the readiness detector stops reporting it as
-- merely undecided, and so the reason survives in the database rather than only in a commit message.
insert into public.age_source_registry (source_table, strategy, trusted, note, jsonb_key)
values
  ('muktamel_residential_listings', 'canonical_column', false,
   'REFUSED 2026-09-03: source publishes an open-ended «+10 سنة» bucket that the ingest stores as a '
   || 'precise 11 (listing 32221 probed live: page shows «عمر العقار +10 سنة», row holds 11). 43 active '
   || 'rows carry that fabricated precision vs 4 genuine 10s. Exact matches DO hold for plain values '
   || '(32001 «2 سنة»=2, 31787 «6 سنة»=6), so the fix is to map the +10 bucket to NULL (or a '
   || 'min-bound) in scrapers/muktamel/run.py and re-probe — not to trust the column as it stands.', null),
  ('muktamel_commercial_listings', 'canonical_column', false,
   'as residential — same «+10» bucket defect, same 2026-09-03 probe.', null)
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted,
      note = excluded.note, jsonb_key = excluded.jsonb_key, updated_at = now();

select source_table, trusted from public.age_source_registry
where source_table like 'sanadak%' or source_table like 'muktamel%' order by 1;
