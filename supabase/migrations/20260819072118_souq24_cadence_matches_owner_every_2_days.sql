-- Data Integrity Engineer run #31 (2026-08-19), second finding.
--
-- souq24 had NO platform_cadence row, so every cadence-aware barrier silently defaulted it to 24h.
-- Its real cadence is 48h, and that is an OWNER decision, not an accident:
-- .github/workflows/small-sources-sync.yml line 94 carries `every_n_days: 2` with the comment
-- "Per-source cadence (owner 2026-07-07): most small sources run daily (every_n_days unset = 1),
-- but a few (souq24) scrape every N days to cut metered-proxy bandwidth" -- souq24 probes ~1,300
-- candidate ids per run through the metered Saudi proxy for only ~52 active listings. It is the
-- ONLY platform in the whole workflow matrix with a non-daily cadence (verified by grep).
--
-- So the monitoring was measuring a clock the platform had been deliberately taken off -- §24b,
-- "a barrier must measure the thing it protects, never another stage's clock". The consequence was
-- not merely noise: souq24 sat permanently ~2x over a 24h expectation, which is indistinguishable
-- from a real stall, and run #31's corrected mon_detect_silent_scraper_death consequently rated one
-- ordinary missed cycle (50.9h) as a P0 death.
--
-- This is NOT silencing a barrier to make it green (§21/§0.1). The severity is being made to
-- DISCRIMINATE, and both directions were proven before and after applying:
--   * legacy freshness still fires -- souq24 at 50.9h is genuinely past its own 48h cadence, so the
--     missed cycle stays visible at P2. Its 2026-08-19 04:38 attempt died as "killed by SIGINT
--     before end_run() -- the CI job hit its timeout-minutes budget" (tmo: 150), which is a real
--     scraper-health item and remains reported.
--   * silent_scraper_death now needs max(2 x 48, 24) = 96h, i.e. TWO consecutive missed cycles,
--     before it calls souq24 dead. That is the correct meaning of death for a 48h platform.
--
-- No listing data is touched. souq24 holds 42 active / 13 inactive rows and nothing was inactivated
-- by the failed run: the coverage gate correctly withheld it (stale_coverage_gate:souq24), which is
-- the §4 rule "scraper failure != inactive" working as designed.

insert into public.platform_cadence (platform, expected_hours, note, is_active)
values ('souq24', 48,
  'Owner 2026-07-07: every_n_days=2 in small-sources-sync.yml to cut metered-proxy bandwidth (~1,300 GETs per run for ~52 active listings). Recorded here by run #31 so cadence-aware barriers stop defaulting it to 24h. Keep in step with the workflow matrix.',
  true)
on conflict (platform) do update
  set expected_hours = excluded.expected_hours,
      note           = excluded.note,
      is_active      = excluded.is_active;
