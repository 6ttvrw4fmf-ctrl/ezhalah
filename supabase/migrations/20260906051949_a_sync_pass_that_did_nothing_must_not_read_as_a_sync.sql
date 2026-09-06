-- A SYNC PASS THAT DID NOTHING MUST NOT READ AS A SYNC THAT RAN.  (ops_incident #37)
--
-- WHAT #37 COULD NOT ESTABLISH. 1,562 rows (1,561 gathern + 1 mustqr) served a price in
-- search_listings_ar that disagreed with listing_native_location_v2, for ~24 hours. Every
-- precondition said the hourly sync should have repaired them: gathern rows reach v2 through the
-- catch-all branch with last_updated NULL, so the candidate predicate's time arm
-- (`v.last_updated is null`) is TRUE for EVERY gathern row on EVERY pass; the diff arm names
-- price_annual explicitly; price_annual is in the ON CONFLICT DO UPDATE set; it is not generated;
-- neither trigger on search_listings_ar preserves it (trg_price_size_sanity only nulls an
-- inapplicable 0 and flips production_ready; set_match_city_ids does not touch price); and no other
-- function in the schema writes search_listings_ar.price_annual (checked: only
-- sync_search_listings_ar does -- refresh_rnpl_flags, sync_payment_monthly, sync_gathern_native_attrs,
-- sync_search_first_seen_at, sync_listing_photos, sync_listing_rich_attrs,
-- propagate_dealapp_resolved_locations and backfill_location_display_labels all write other columns).
-- The incident closed its own root_cause with "THE MECHANISM WAS NEVER ESTABLISHED".
--
-- WHY IT COULD NOT BE ESTABLISHED -- and this is the defect this migration fixes. The single load-
-- bearing fact in #37 was "sync-search-listings-ar (jobid 28) has run and SUCCEEDED hourly ~24 times
-- since". That fact is not evidence that the upsert ran even once, because:
--
--   1. sync_search_listings_ar() opens with `if not public.search_index_writer_lock() then return;`.
--      That is a SILENT no-op: the function returns ZERO rows and raises only a NOTICE, whose own
--      text says "this pass is a NO-OP and reports NULL (not 0)". Nobody reads NOTICEs.
--   2. pg_cron job 28 runs a SEVEN-statement command, so cron.job_run_details.return_message
--      reflects the LAST statement (sync_all_listing_photos), never the sync's own (upserted,
--      deleted). The sync's return value is discarded on every run.
--   3. status='succeeded' therefore means "no statement raised", which is equally true of a pass
--      that upserted 200,000 rows and a pass that took no lock and wrote nothing.
--
-- And that same non-evidence is what BOTH monitors of this surface read:
--   search_index_freshness()  -> last_successful_sync_at / sync_recent / lag_minutes
--   price_fidelity()          -> last_successful_sync_at / sync_recent
-- both computed as `max(end_time) from cron.job_run_details where jobid = 28 and status='succeeded'`.
-- mon_detect_search_index_freshness() then raises P1 at lag_minutes > 360 -- an arm that can never
-- fire while the scheduler keeps ticking, however long the writer has actually been idle. So a
-- 24-hour writer outage is, by construction, invisible: the class recurs and is unexplainable again.
--
-- WHAT WAS RULED OUT BY EXECUTION, NOT BY READING (2026-09-06). A controlled divergence was planted
-- on a non-served gathern row (production_ready = false, so never in results): index price_annual
-- set to NULL against a source value of 194220 at 04:54:27Z. It held for 21 minutes with no writer
-- touching it, the real hourly pass ran 05:14:00-05:15:42Z, and the row read 194220 again at
-- 05:15:59Z. So the sync's candidate predicate, its DISTINCT ON, its ON CONFLICT set, the triggers
-- and any competing writer are all excluded: a diverged price IS converged by one production pass.
-- What remains is a pass that did not execute its upsert -- and that is the thing nothing recorded.
--
-- THE FIX: the writer records its own passes, and the monitors read the writer instead of the
-- scheduler.
--
--   (a) sync_search_listings_ar() writes mon_mv_refresh_log('search_listings_ar_sync_pass') AFTER
--       the lock gate -- so only a pass that actually reached the upsert can leave evidence, and a
--       no-op pass leaves the timestamp exactly where it was.
--   (b) mon_refresh_targets gains that object (warn 180m / crit 360m, matching the hourly cadence
--       and the thresholds already used for active_listing_ids_v2). mon_detect_stale_refresh() is
--       already in the twice-hourly roster, so no new detector and no orphan risk. The object name
--       is deliberately NOT a relation name: mon_detect_stale_refresh falls back to
--       pg_stat_user_tables.last_analyze when the log row is missing, and autovacuum keeps that
--       column fresh on the real table -- naming it 'search_listings_ar' would have made a missing
--       log row read as healthy. It fails CLOSED as written.
--   (c) search_index_writer_lock() records every REFUSAL, cumulatively. This is the discriminating
--       instrument #37 lacked: on the next occurrence, "was the writer being locked out?" is one
--       SELECT instead of an unfalsifiable hypothesis. It covers all four callers of the lock
--       (sync_search_listings_ar, refresh_rnpl_flags, sync_payment_monthly,
--       sync_gathern_native_attrs) from one place, which is why it lives in the lock and not in
--       each caller.
--   (d) price_fidelity() and search_index_freshness() take last_successful_sync_at from (a) instead
--       of from the scheduler, and say so in the payload. This is STRICTER, not weaker: the P1 arm
--       at lag_minutes > 360 becomes reachable for the first time.
--
-- WHAT THIS DOES NOT CLAIM. It does not claim the lock refusal WAS the 2026-09-05 mechanism. The
-- population is 0 and the evidence to decide was never recorded -- that is precisely the point. What
-- changes is that the next occurrence cannot be unexplainable: a writer that stops writing now
-- raises P1 within 6 hours, and the refusal counter says whether contention is why.
--
-- Applied as NEEDLE-EDITS of the LIVE bodies, never hand-pasted copies (AGENTS.md): these functions
-- are edited by several routines and re-pasting a remembered version silently reverts them.

-- ── (c) the lock records its refusals ────────────────────────────────────────────────────────────
do $$
declare
  v_def text; v_new text; v_hits int;
  n_old constant text := '  raise notice ''search_listings_ar single-writer lock is held by another transaction; this pass is a NO-OP and reports NULL (not 0)'';';
  n_new constant text := '  -- BEST-EFFORT DIAGNOSTIC (ops_incident #37). This function is EXECUTE-granted to anon and
  -- authenticated and is NOT security definer, while mon_mv_refresh_log has RLS and grants only to
  -- postgres/service_role. Recording a refusal must never turn a benign no-op into an exception for
  -- a caller that cannot write the log, so this record is swallowed on failure. The POSITIVE
  -- evidence in sync_search_listings_ar() is deliberately NOT swallowed: a pass that cannot record
  -- itself must fail loudly, because an unrecorded pass reads as stale and escalates (fail closed).
  begin
    insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
    values (''search_index_writer_lock_refused'', now(), 1,
            left(coalesce(current_query(), ''?''), 200))
    on conflict (object_name) do update
      set refreshed_at = excluded.refreshed_at,
          rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
          note         = excluded.note;
  exception when others then null;
  end;
  raise notice ''search_listings_ar single-writer lock is held by another transaction; this pass is a NO-OP and reports NULL (not 0)'';';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'search_index_writer_lock';
  if v_def is null then raise exception 'search_index_writer_lock not found'; end if;
  if position('search_index_writer_lock_refused' in v_def) > 0 then
    raise notice 'search_index_writer_lock already records refusals; nothing to do';
  else
    v_hits := (length(v_def) - length(replace(v_def, n_old, ''))) / length(n_old);
    if v_hits <> 1 then raise exception 'lock notice needle found % times, expected 1', v_hits; end if;
    v_new := replace(v_def, n_old, n_new);
    if v_new = v_def then raise exception 'needle-edit produced no change'; end if;
    execute v_new;
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'search_index_writer_lock';
    if position('search_index_writer_lock_refused' in v_def) = 0
       or position('pg_try_advisory_xact_lock' in v_def) = 0
       or position('return true' in v_def) = 0 then
      raise exception 'post-check: lock body lost its contract';
    end if;
  end if;
end $$;

-- ── (a) the sync records the passes that actually reached the upsert ─────────────────────────────
do $$
declare
  v_def text; v_new text; v_hits int;
  r_old constant text := '  return query select v_upserted, v_deleted;';
  r_new constant text := '  -- EVIDENCE THAT THIS PASS ACTUALLY RAN. Reached only past the writer-lock gate, so a no-op
  -- pass leaves refreshed_at exactly where it was and mon_detect_stale_refresh() escalates. See
  -- ops_incident #37: cron status ''succeeded'' is true of a pass that took no lock and wrote nothing.
  insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
  values (''search_listings_ar_sync_pass'', now(), v_upserted,
          format(''jobid28 upserted=%s deleted=%s'', v_upserted, v_deleted))
  on conflict (object_name) do update
    set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;
  return query select v_upserted, v_deleted;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if v_def is null then raise exception 'sync_search_listings_ar not found'; end if;
  if position('search_listings_ar_sync_pass' in v_def) > 0 then
    raise notice 'sync_search_listings_ar already records its passes; nothing to do';
  else
    -- Refuse to guess: the return must appear exactly once, and it must come AFTER the lock gate.
    v_hits := (length(v_def) - length(replace(v_def, r_old, ''))) / length(r_old);
    if v_hits <> 1 then raise exception 'return needle found % times, expected 1', v_hits; end if;
    if position('search_index_writer_lock()' in v_def) = 0
       or position('search_index_writer_lock()' in v_def) > position(r_old in v_def) then
      raise exception 'lock gate is missing or no longer precedes the return -- refusing to edit';
    end if;
    v_new := replace(v_def, r_old, r_new);
    if v_new = v_def then raise exception 'needle-edit produced no change'; end if;
    execute v_new;
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'sync_search_listings_ar';
    if position('search_listings_ar_sync_pass' in v_def) = 0 then
      raise exception 'post-check: pass evidence not present in live body';
    end if;
    -- Nothing else may have been lost in the rewrite.
    if position('prune_inactive_from_search' in v_def) = 0
       or position('sync_delete_circuit_breaker' in v_def) = 0
       or position('refresh_district_name_bridge' in v_def) = 0
       or position('price_annual=excluded.price_annual' in v_def) = 0 then
      raise exception 'post-check: unrelated sync behaviour disappeared';
    end if;
  end if;
end $$;

-- ── (b) register the freshness target, and bootstrap it honestly ─────────────────────────────────
-- The seed is the last time job 28 did not error. That is the BEST available evidence at install
-- time and it is labelled as a bootstrap, not as write evidence; the next pass replaces it with the
-- real thing. Seeding now() would have forged exactly the evidence this migration exists to stop
-- forging.
insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
select 'search_listings_ar_sync_pass',
       coalesce((select max(end_time) from cron.job_run_details where jobid = 28 and status = 'succeeded'),
                now() - interval '1 hour'),
       null::bigint,
       'bootstrap: seeded from cron.job_run_details at install (ops_incident #37) — NOT write evidence; replaced at the next pass'
where not exists (select 1 from public.mon_mv_refresh_log where object_name = 'search_listings_ar_sync_pass');

insert into public.mon_refresh_targets(object_name, check_kind, warn_after_minutes, crit_after_minutes, active, notes)
values ('search_listings_ar_sync_pass', 'mv_freshness', 180, 360, true,
        'ops_incident #37: the served search index is rebuilt hourly by sync_search_listings_ar() (pg_cron jobid 28, minute 14). '
        'This target watches the WRITER, not the scheduler: the row is written only past the single-writer lock gate, so a pass '
        'that no-ops leaves it stale and this escalates. Deliberately NOT named search_listings_ar — mon_detect_stale_refresh '
        'falls back to pg_stat_user_tables.last_analyze when the log row is missing, and autovacuum would keep that fresh on the '
        'real table, so a relation name here would fail OPEN.')
on conflict (object_name) do update
  set check_kind = excluded.check_kind,
      warn_after_minutes = excluded.warn_after_minutes,
      crit_after_minutes = excluded.crit_after_minutes,
      active = true,
      notes = excluded.notes,
      updated_at = now();

-- ── (d) both monitors read the writer, not the scheduler ─────────────────────────────────────────
do $$
declare
  v_def text; v_new text; v_hits int; fn text;
  pf_old constant text := '  select max(end_time) into v_last_sync from cron.job_run_details where jobid = 28 and status = ''succeeded'';';
  pf_new constant text := '  -- ops_incident #37: "the cron job succeeded" is NOT "the sync wrote". Read the writer''s own
  -- record, which sync_search_listings_ar() writes only past its single-writer lock gate.
  select refreshed_at into v_last_sync
    from public.mon_mv_refresh_log where object_name = ''search_listings_ar_sync_pass'';';
  sf_old constant text := '  select max(end_time) into v_last_sync
  from cron.job_run_details where jobid = 28 and status = ''succeeded'';';
  sf_new constant text := '  -- ops_incident #37: "the cron job succeeded" is NOT "the sync wrote". Read the writer''s own
  -- record, which sync_search_listings_ar() writes only past its single-writer lock gate.
  select refreshed_at into v_last_sync
    from public.mon_mv_refresh_log where object_name = ''search_listings_ar_sync_pass'';';
  pfk_old constant text := '''last_successful_sync_at'', v_last_sync, ''sync_recent'', v_sync_recent,';
  pfk_new constant text := '''last_successful_sync_at'', v_last_sync, ''sync_recent'', v_sync_recent,
    ''sync_evidence'', ''mon_mv_refresh_log.search_listings_ar_sync_pass — the pass that actually ran the upsert, NOT cron job status'',';
  sfk_old constant text := '    ''last_successful_sync_at'', v_last_sync,';
  sfk_new constant text := '    ''last_successful_sync_at'', v_last_sync,
    ''sync_evidence'',      ''mon_mv_refresh_log.search_listings_ar_sync_pass — the pass that actually ran the upsert, NOT cron job status'',';
begin
  foreach fn in array array['price_fidelity','search_index_freshness'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if v_def is null then raise exception '% not found', fn; end if;

    if position('search_listings_ar_sync_pass' in v_def) > 0 then
      raise notice '% already reads the writer record; nothing to do', fn;
      continue;
    end if;

    if fn = 'price_fidelity' then
      v_hits := (length(v_def) - length(replace(v_def, pf_old, ''))) / length(pf_old);
      if v_hits <> 1 then raise exception '%: cron needle found % times, expected 1', fn, v_hits; end if;
      v_hits := (length(v_def) - length(replace(v_def, pfk_old, ''))) / length(pfk_old);
      if v_hits <> 1 then raise exception '%: payload needle found % times, expected 1', fn, v_hits; end if;
      v_new := replace(replace(v_def, pf_old, pf_new), pfk_old, pfk_new);
    else
      v_hits := (length(v_def) - length(replace(v_def, sf_old, ''))) / length(sf_old);
      if v_hits <> 1 then raise exception '%: cron needle found % times, expected 1', fn, v_hits; end if;
      v_hits := (length(v_def) - length(replace(v_def, sfk_old, ''))) / length(sfk_old);
      if v_hits <> 1 then raise exception '%: payload needle found % times, expected 1', fn, v_hits; end if;
      v_new := replace(replace(v_def, sf_old, sf_new), sfk_old, sfk_new);
    end if;

    if v_new = v_def then raise exception '%: needle-edit produced no change', fn; end if;
    execute v_new;

    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if position('search_listings_ar_sync_pass' in v_def) = 0 then
      raise exception '%: post-check, writer record not read', fn;
    end if;
    if position('cron.job_run_details' in v_def) > 0 then
      raise exception '%: post-check, still deriving sync freshness from the scheduler', fn;
    end if;
    if position('v_sync_recent' in v_def) = 0 then
      raise exception '%: post-check, sync_recent disappeared', fn;
    end if;
  end loop;
end $$;
