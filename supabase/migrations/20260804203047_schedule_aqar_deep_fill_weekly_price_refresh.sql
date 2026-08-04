-- PRICE = SOURCE, refresh coverage (owner-approved 2026-08-04).
--
-- PROBLEM (measured, not assumed): 43,112 of 79,151 active aqar rows (54.5%) have never been
-- re-upserted since capture stamping, and 29,282 are frozen at the 2026-07-01 backfill instant.
-- Their prices are therefore whatever the source said weeks ago. Cause is COVERAGE, not parsing:
-- the scheduled sweep (aqar-sweep.yml, --pages 3) only re-reads the top ~60 results per
-- (type × deal × city) slice, and aqar-deep-fill.yml — which walks 150 pages per slice and IS
-- proven in production — was workflow_dispatch-only with no schedule. Nothing was keyed on data
-- staleness, and last_seen_at (refreshed daily by the liveness sweep) masked the drift.
--
-- FIX, reuse-first: schedule the job that already exists. Every re-discovered ad flows through
-- enrich → upsert → trg_aqar_parse, so price_total / price_original / discount_pct are rewritten
-- from the source — the same path that already maintains 8,290 correctly-discounted rows.
--
-- Cadence: weekly, Saturday 01:00 UTC. Deliberately OFF the 8-hourly sweep hours (05/13/21 +:05)
-- and off the daily liveness hour (01:00 is aqar-liveness's slot on jobid 6 — so we take 02:00),
-- to avoid two heavy aqar jobs contending for the same rows and proxy budget.
select cron.schedule(
  'gh-aqar-deep-fill-weekly',
  '0 2 * * 6',
  $$select public.trigger_gh_workflow('aqar-deep-fill.yml')$$
);

comment on extension pg_cron is
  'Scheduler. gh-aqar-deep-fill-weekly (2026-08-04): weekly full-depth aqar re-crawl so stored prices are re-read from source; added after 54.5% of active rows were found frozen since capture.';