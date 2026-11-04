-- sync-rich-attrs-wasalt (jobid 68) out of sync-search-listings-ar's run window (alert 12926, search_writer_starved).
--
-- The 2026-11-04 cron rebalance re-slotted jobid 68 from minute 46 to minute 30 of every third hour. jobid 28
-- (sync-search-listings-ar) starts at :22 and runs 12-16 min (p95 890 s), holding the search_listings_ar
-- single-writer lock until ~:37, so EVERY pass of jobid 68 since (00:30, 03:30) was refused in 0.01 s and
-- recorded `succeeded` — wasalt's rich attributes stopped reaching search. The review-time checks stayed green
-- because starvedPairs() judges only plain-hourly victims and writerCollisions() only same-instant starts;
-- scripts/lib/cronSlots.ts starvedWriters() now judges every writer's every start against every writer's window.
--
-- Minute 11 of every third hour: no single-writer job starts in 11..13 (its own ~76 s run), it is outside every
-- writer's p95 window, at most 2 jobs share the instant, and minute 0 stays empty.
do $$
declare v_old text;
begin
  select schedule into v_old from cron.job where jobid = 68 and jobname = 'sync-rich-attrs-wasalt';
  if v_old is distinct from '30 */3 * * *' then
    raise exception 'ABORT: jobid 68 schedule is % (expected 30 */3 * * *) — someone re-slotted it; re-measure first', v_old;
  end if;
  perform cron.alter_job(job_id := 68, schedule := '11 */3 * * *');
  if (select schedule from cron.job where jobid = 68) <> '11 */3 * * *' then
    raise exception 'ABORT: alter_job did not take';
  end if;
end $$;
