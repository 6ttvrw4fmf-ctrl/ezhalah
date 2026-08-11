-- Make the rich columns DURABLE instead of hand-maintained.
--
-- sync_search_listings_ar() writes 33 of search_listings_ar's 63 columns. The 27 rich columns are
-- not among them, so they survive an UPDATE but are reset to NULL by any delete-then-reinsert —
-- and prune_inactive_from_search() deletes unguarded. Every rich value in the index today was
-- hand-written over MCP and would silently disappear on the next flap.
--
-- Chained onto the EXISTING hourly job (jobid 28, '14 * * * *') rather than scheduled as a new one:
-- this instance runs max_worker_processes=6 against max_running_jobs=32, so adding cron jobs is not
-- free (see the 2026-08-10 worker-starvation incident). Appended AFTER sync_search_listings_ar()
-- deliberately — that call is what can reinsert a row and blank its rich columns, so repairing
-- before it would fix nothing.
--
-- Measured cost of all three calls together on a no-op run: 25 ms. The literal source_table lets
-- the planner prune the other UNION ALL branches; without that constant the whole ~19s view would
-- re-materialise on every call.
--
-- abeea and eastabha have NO branch in listing_rich_attrs yet, so their calls match zero rows today.
-- They are wired now on purpose: when those branches land the data starts flowing with no cron edit,
-- and until then they cost nothing.
--
-- Scoped to the three small platforms ON PURPOSE. Running this for aqar/wasalt/sanadak would rewrite
-- 655 pre-existing cells (10 wasalt furnishing_level, 644 sanadak deed_location_text, 1 aqar row).
-- An adversarial pass verified all 655 resolve in the view's favour, but rewriting other platforms'
-- data is a separate decision and is left for an explicit owner call.
do $$
declare cur text; want text;
begin
  select command into cur from cron.job where jobid = 28;
  if cur is null then
    raise exception 'cron jobid 28 not found - refusing to guess which job is the sync';
  end if;
  if cur not like '%sync_search_listings_ar()%' then
    raise exception 'jobid 28 is not the search sync job (command: %) - refusing to edit', left(cur, 200);
  end if;
  if cur like '%sync_listing_rich_attrs%' then
    raise notice 'already chained - nothing to do';
    return;
  end if;

  want := rtrim(btrim(cur), ';') || ';'
       || ' select public.sync_listing_rich_attrs(''raghdan_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''abeea_residential_listings'');'
       || ' select public.sync_listing_rich_attrs(''eastabha_residential_listings'');';

  perform cron.alter_job(28, command => want);

  -- prove the edit preserved the original work and added exactly what we intended
  select command into cur from cron.job where jobid = 28;
  if cur not like '%sync_search_listings_ar()%'
     or cur not like '%refresh_rnpl_flags()%'
     or cur not like '%sync_payment_monthly()%'
     or cur not like '%raghdan_residential_listings%' then
    raise exception 'post-edit command lost a call: %', cur;
  end if;
end $$;
