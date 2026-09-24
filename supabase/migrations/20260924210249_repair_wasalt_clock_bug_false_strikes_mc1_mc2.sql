-- REPAIR: reset wasalt missing_count in {1,2} to 0 — every one of these strikes was produced
-- entirely by the enum-rollup clock bug (ops_incident, routine #11, 2026-09-24), never by real
-- absence.
--
-- THE BUG (see scrapers/wasalt/liveness.py::rollup_started_at() for the full writeup, fixed in the
-- same PR as this migration). run_enum_rollup() stamped its published `platform='wasalt'` scrape_runs
-- row with begin_run()'s own clock — the ROLLUP job's start time, which by design (`needs: [enum,
-- rollup]`) always runs AFTER every shard has already finished. Measured on the run this was caught
-- on: shards started 2026-09-23T21:03:07, the rollup that summed them published at
-- 2026-09-24T00:38:56 — 2h48m later. run_enum_strike() reads that timestamp as "when the enumeration
-- began" and strikes every active row whose last_seen_at predates it. Every listing genuinely
-- refreshed during the real ~3h enumeration window therefore looked "unseen," on every run since the
-- sharded design shipped (2026-09-20).
--
-- WHY THIS IS SAFE TO RESET UNCONDITIONALLY, NOT JUST PLAUSIBLE. The control-group guard
-- (control_ok(), untouched by the fix) requires a non-empty sample of known-live rows before it will
-- let ANY flip through, and the corrupted clock made that sample empty on every run since 2026-09-12
-- (three strike runs since, 09-20/22/24, all logged `control group=0` / `aborted_flips=True`). Zero
-- flips means zero self-heals — nothing has reset a wasalt missing_count for any reason, buggy or
-- not, in twelve days. So a currently-nonzero missing_count of 1 or 2 could only have been produced
-- by a strike written during that exact broken window: there is no code path by which a legitimate,
-- correctly-measured value could exist here right now. Resetting to 0 does not guess who is actually
-- alive — it undoes exactly and only the effect of the clock bug, restoring these rows to the state
-- they would carry had the bug never fired. `active` is never touched by this migration; no listing
-- is deactivated, reactivated, or hidden by it.
--
-- WHY mc=3 IS NOT INCLUDED HERE. A row at the grace threshold is one confirm away from deactivation,
-- and the same clock bug corrupted WHEN it got there, not whether the confirm verdict is honest.
-- Per the owner's explicit instruction, those rows get a real, right-now direct check (a repaired
-- verdict, not a blind reset or a blind kill) — see the follow-up `repair-clock-bug-backlog` CI job,
-- which treats a confirmed-dead verdict as ONE freshly-earned strike (mc=1), never an instant kill.
--
-- Measured immediately before this migration: 49,797 + 480 residential, 786 + 19 commercial = 51,082
-- rows affected. Recorded here (not just in scrape_runs) because this table's own row count is the
-- audit trail for a repair migration, matching this repo's convention for prior one-off wasalt
-- repairs (e.g. migration 20260919010944).

update wasalt_residential_listings
   set missing_count = 0
 where active
   and missing_count in (1, 2);

update wasalt_commercial_listings
   set missing_count = 0
 where active
   and missing_count in (1, 2);
