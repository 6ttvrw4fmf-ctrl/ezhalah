-- INCIDENT #55 — search_listings_ar has NINE writers and no single-writer rule.
--
-- The incident was filed as "query cost on the location index". It is not. The timeouts are a
-- symptom; the mechanism is a DUPLICATED WRITER RACE, and it is visible to the second in
-- cron.job_run_details on 2026-09-04:
--
--   16:14:00  jobid 28 sync-search-listings-ar starts. Its command is SEVEN writers in ONE
--             implicit transaction: sync_search_listings_ar, refresh_rnpl_flags,
--             sync_payment_monthly, sync_all_rich_attrs, sync_gathern_native_attrs,
--             refresh_photo_capture_trust, sync_all_listing_photos.
--   16:20:00  jobid 47 refresh-rnpl-flags starts THE SAME FUNCTION, refresh_rnpl_flags().
--   16:21:27  jobid 28 dies: "deadlock detected ... while locking tuple (3778,9) in relation
--             search_listings_ar", inside `update public.search_listings_ar s set
--             rent_now_pay_later = src.rnpl` — which IS refresh_rnpl_flags().
--   16:21:29  jobid 47 succeeds, two seconds later. It was the blocked party; it was released by
--             the victim's abort.
--
-- Two transactions running the same UPDATE over the same rows, taking row locks in whatever order
-- their plans happened to pick. Because pg_cron sends a multi-statement command as one implicit
-- transaction, the deadlock rolled back the WHOLE hourly chain — including the sync_search_listings_ar
-- that had already succeeded. That is the real damage: the search index silently did not update for
-- an hour while the health read looked green.
--
-- The duplication is DELIBERATE and must stay. 20260809131852 chained the three steps into jobid 28
-- and says so in its own words: "The standalone :20 refresh and the 10-minute sync_payment_monthly
-- sweep stay as independent backstops." Deleting jobid 47 or jobid 44 would remove a guard to make a
-- symptom go away. So the fix is not to forbid concurrency — it is to make it SAFE.
--
-- WHY A SKIP AND NOT A WAIT. pg_advisory_xact_lock() would block, and a blocked pg_cron job holds
-- one of only six max_worker_processes slots for the whole wait — the exact resource whose
-- exhaustion mon_detect / location_pipeline_monitor already watch as 'cron_worker_starvation'
-- (20260810111003). jobid 28 can hold its transaction for 600s; four backstops queued behind it
-- would starve the pool and then die on their own statement_timeout anyway. Every one of these
-- writers is an idempotent convergent refresher that runs again in 10–60 minutes, so the correct
-- behaviour when another writer owns the index is to do nothing this pass.
--
-- WHY NULL AND NOT 0. A skipped pass did not measure anything. Returning 0 would say "nothing needed
-- updating", which is a value we invented for a question we did not ask — the owner-locked
-- SOURCE IS TRUTH rule (silent → NULL, never unknown → a value) applies to a refresher's own report
-- exactly as it applies to a listing field. NULL is distinguishable from a real zero; 0 is not.
--
-- SCOPE. Every function that writes public.search_listings_ar and is reachable from an active cron
-- job, not just the pair that happened to deadlock. jobid 28 holds its transaction for 6–10 minutes
-- and jobs 44 (:05-:55/10), 47 (:20), 61 (:08-:58/10), 68 (06:47) and 75 (:07-:57/10) all land
-- inside that window every hour, writing the same table. refresh_rnpl_flags is the pair that was
-- caught; the class is "two writers, one table, no rule".
--
-- prune_inactive_from_search() is NOT guarded here and does not need to be: its only caller is
-- sync_search_listings_ar(), inside that function's own transaction, which already holds the lock
-- (advisory locks are re-granted to a transaction that already owns them — verified).
--
-- The bodies below are NOT re-transcribed. Each is patched in place from its live definition with a
-- fail-closed anchor, because re-issuing a full body from a hand-copied source is how the RNPL guard
-- was silently deleted in 20260809125830 → restored by 20260809160352.

create or replace function public.search_index_writer_lock()
returns boolean
language plpgsql
as $fn$
begin
  if pg_try_advisory_xact_lock(hashtext('search_listings_ar:single_writer')) then
    return true;
  end if;
  raise notice 'search_listings_ar single-writer lock is held by another transaction; this pass is a NO-OP and reports NULL (not 0)';
  return false;
end $fn$;

comment on function public.search_index_writer_lock() is
  'INCIDENT #55. One advisory key for every writer of public.search_listings_ar. Try, never wait: a '
  'blocked pg_cron job holds one of six worker slots. A writer that does not get the lock returns '
  'NULL (did not run), never 0 (ran, found nothing).';

do $do$
declare
  -- [needle, replacement, target signature]. The table-driven patch shape scripts/lib/rpcReplay.ts
  -- already models (it reads columns 1 and 2 and ignores the third), so the replay barrier can see
  -- these edits instead of reporting the migration as an uninterpretable change.
  edits text[][] := array[
    [
'begin
  -- every source table that (1) actually feeds search_listings_ar',
'begin
  if not public.search_index_writer_lock() then return null; end if;
  -- every source table that (1) actually feeds search_listings_ar',
'public.refresh_rnpl_flags()'
    ],
    [
'begin
  with want as (
    select s.source_table, s.listing_id,
      coalesce(',
'begin
  if not public.search_index_writer_lock() then return null; end if;
  with want as (
    select s.source_table, s.listing_id,
      coalesce(',
'public.sync_payment_monthly()'
    ],
    [
'begin
  with want as (
    select s.source_table, s.listing_id,
      -- Rule 1 + 2.',
'begin
  if not public.search_index_writer_lock() then return null; end if;
  with want as (
    select s.source_table, s.listing_id,
      -- Rule 1 + 2.',
'public.sync_gathern_native_attrs()'
    ],
    [
'begin
  with candidates as (',
'begin
  if not public.search_index_writer_lock() then return null; end if;
  with candidates as (',
'public.propagate_dealapp_resolved_locations()'
    ],
    [
'begin
  for rec in
    select c.table_name',
'begin
  if not public.search_index_writer_lock() then return null; end if;
  for rec in
    select c.table_name',
'public.sync_search_first_seen_at()'
    ],
    [
'begin
  with cand as (',
'begin
  if not public.search_index_writer_lock() then return; end if;
  with cand as (',
'public.backfill_location_display_labels(integer)'
    ],
    [
'begin
  select coalesce(max(last_updated), now() - interval ''30 days'') - interval ''2 hours''',
'begin
  if not public.search_index_writer_lock() then return; end if;
  select coalesce(max(last_updated), now() - interval ''30 days'') - interval ''2 hours''',
'public.sync_search_listings_ar()'
    ],
    [
'  select trusted into is_trusted from public.ops_photo_capture_trust where source_table = p_source_table;',
'  if not public.search_index_writer_lock() then return null; end if;

  select trusted into is_trusted from public.ops_photo_capture_trust where source_table = p_source_table;',
'public.sync_listing_photos(text)'
    ],
    [
'  cols := public._rich_attr_columns();',
'  if not public.search_index_writer_lock() then return null; end if;

  cols := public._rich_attr_columns();',
'public.sync_listing_rich_attrs(text)'
    ]
  ];
  i int;
  v_def text;
  sig text;
  needle text;
  repl text;
begin
  for i in 1 .. array_length(edits, 1) loop
    needle := edits[i][1];
    repl   := edits[i][2];
    sig    := edits[i][3];

    v_def := pg_get_functiondef(sig::regprocedure);

    if position('search_index_writer_lock' in v_def) > 0 then
      raise notice 'already guarded, leaving alone: %', sig;
      continue;
    end if;
    -- Fail closed. If the body moved, the guard's placement is a guess, and a guess about where a
    -- lock goes is worse than no lock.
    if position(needle in v_def) = 0 then
      raise exception 'REFUSING: anchor not found in % — the body moved; re-derive the anchor rather than guessing where the guard goes', sig;
    end if;

    execute replace(v_def, needle, repl);

    v_def := pg_get_functiondef(sig::regprocedure);
    if position('search_index_writer_lock' in v_def) = 0 then
      raise exception 'REFUSING: guard did not take on %', sig;
    end if;
  end loop;
end $do$;
