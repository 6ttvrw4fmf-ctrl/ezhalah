-- Senior audit run #10, P1 sweep (2026-08-11), continued.
--
-- PART 1 — dealapp 7056882 is source-published, not an artifact. Its own captured price_evidence is
-- unambiguous and structured:
--     {"raw":"525000000","kind":"total","unit":"total","field":"offers.price","found":true,
--      "origin":"structured","stored":525000000}
-- dealapp's JSON-LD `offers.price` states 525,000,000 for a 750 m² plot. 700,000 SAR/m² is
-- implausible to a human, and that is precisely the judgement the source-fidelity rule forbids us
-- from making: the source published this figure, so Ezhalah preserves it exactly. Allowlisted so the
-- phone/ID band stops reporting it as an artifact; NOT repriced, NOT rounded, NOT capped.
--
-- The other five dealapp rows and all six remaining wasalt rows in that band carry no price
-- evidence at all (wasalt: {"found":null,"reason":"adapter_emitted_no_evidence","unverified":true}),
-- so their true source price CANNOT be established from stored data. They are deliberately left
-- exactly as they are — no guess, no multiplier, no inferred zero.
insert into public.ops_price_source_verified (source_table, listing_id, evidence) values
 ('dealapp_residential_listings', 7056882,
  'dealapp JSON-LD offers.price states 525000000 as a STRUCTURED total. Stored price_evidence: '
  '{"raw":"525000000","kind":"total","unit":"total","field":"offers.price","found":true,'
  '"origin":"structured","stored":525000000}. Source-published; preserved verbatim under the '
  'source-fidelity rule despite an implausible-looking 700,000 SAR/m2.')
on conflict (source_table, listing_id) do nothing;

-- PART 2 — cron minute-slot collisions (real outage risk, cleared).
-- mon_detect_cron_minute_collision reported: min 0 → jobs 17,70; min 25 → 44,63,70; min 45 → 29,44,70.
-- Every collision involves jobid 70 `repair-blanket-false-drain`, created today on `*/5 * * * *`,
-- which necessarily lands on :00, :25 and :45 alongside the matview refresh, the payment sync, the
-- ppm monitor and the location self-test. The 2026-08-10 outage was caused by exactly this class of
-- stampede, and AGENTS.md reserves :00 for the matview refresh alone.
-- Shifting to `2-57/5` keeps the identical every-5-minutes cadence (12 runs/hour) while landing on
-- :02,:07,...,:57 — none of which is an occupied slot. The job's behaviour is unchanged; only its
-- phase moves. Left active and untouched otherwise: it belongs to a concurrent Data Integrity
-- session that is mid-drain, and a phase shift cannot interrupt a drain.
select cron.alter_job(70, schedule => '2-57/5 * * * *');