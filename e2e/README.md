# Advanced Filter — real-UI E2E harness (Playwright)

Drives the **production website** like a real user and asserts, per cohort:

1. **Selection integrity (harness-safety assertion):** the params the app actually
   PUTs to the Supabase RPCs (`p_deal`, `p_types`, `p_category`, `p_cities`,
   `p_rent_period`) match what was selected in the UI. If the UI shows شقة but the
   request sends the whole group (or any foreign type), the test FAILS — this is
   how a "select شقة → get دور" regression is caught. Type is matched against the
   clean-type's expected raw-type set (`EXPECT`).
2. **Answer-landing:** starts the interview, reads the first option's chip count,
   clicks it, and asserts the landed total equals the chip (chip == landed).

Covers every enabled clean-type × deal cohort across several cities, desktop + a
mobile subset. Run: `npx playwright install chromium && node e2e/af-real-ui.mjs`
(writes `results.jsonl`). Not wired into `npm test` — it needs a real browser and
hits live production, so it is a manual/scheduled regression tool.

2026-08-16 baseline run: 39 journeys, selection-integrity 39/39, answer-landing
33/33 where the interview fired (chip == landed exact), 9 thin cohorts correctly
showed no interview. Zero product defects.
