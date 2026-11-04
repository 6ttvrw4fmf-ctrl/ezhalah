-- 🦅 Falcon 2026-11-03, applied by the owner session. liveness_checking_stalled:wasalt opened between runs by construction:
-- job 36 dispatched wasalt-enum-liveness.yml every OTHER day while the stall window is least(sla 48 h, 30 h) = 30 h.
-- Measured 11-03: 95,775 active rows, 0 checked in 30 h. The workflow's concurrency group (cancel-in-progress: false)
-- prevents overlap, and a full enumeration took 3h26m on 11-01, so a daily start never stacks. Minute :09 kept (its own
-- slot). Do NOT clear the alert by widening the window or raising sla_hours (LISTING_LIVENESS.md §7).
select cron.alter_job(36, schedule := '9 21 * * *');
