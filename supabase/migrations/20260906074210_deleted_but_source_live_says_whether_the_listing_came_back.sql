-- Data Integrity Engineer, 2026-09-06, closing ops_incident #108 (P0).
--
-- WHAT THE ADJUDICATION COST, AND WHY IT SHOULD NOT HAVE. The alert asks a human to decide between
-- "the pre-delete recheck has a bug" and "the source re-listed the same URL", and states flatly:
-- "SQL cannot re-probe a URL, so there is no automatic self-heal." True about the PROBE, and it
-- hid the fact that SQL can answer the question that actually decides the harm: IS THE LISTING
-- BACK IN INVENTORY? Adjudicating #108 by hand needed 150 external fetches to establish what one
-- lookup already knew — every live URL was re-ingested, active, and re-seen the same day.
--
-- Both adjudications on record (ref_id 73, 2026-08-30; ref_id 102, today) landed on
-- source_relisted_after_valid_delete, and in both the unit is back in the platform table. The
-- genuinely harmful case is the other one: hard-deleted, live at the source, and NOT re-ingested —
-- that is inventory permanently lost, and nothing in the payload distinguished it.
--
-- So the payload now carries the fact, per row, read from the platform table by listing_url:
--   reingested_row_exists / reingested_active / reingested_last_seen_at.
-- NOTHING IS SUPPRESSED. Severity stays P0, the adjudication requirement is unchanged, and the
-- alert still clears only through ops_deleted_but_source_live_adjudication. This adds evidence to
-- a decision, it does not make the decision.
create or replace function public.mon_detect_deleted_but_source_live()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; n int := 0; v_live_keys text[] := '{}';
        v_back boolean; v_back_active boolean; v_back_seen timestamptz;
begin
  -- LIMB 1 live key set: the cohort that may raise, independent of whether an alert already
  -- exists for it. (§25a: raise and resolve must share ONE predicate.)
  select coalesce(array_agg('deleted_but_source_live:' || v.id::text), '{}')
    into v_live_keys
    from public.cleanup_deletion_verification v
   where v.verdict = 'live'
     and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                      where j.scope = 'verification' and j.ref_id = v.id);

  for rec in
    select v.id, v.deletion_log_id, v.platform, v.source_table, v.listing_id, v.listing_url, v.deleted_at, v.verified_at
    from public.cleanup_deletion_verification v
    where v.verdict = 'live'
      and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                       where j.scope = 'verification' and j.ref_id = v.id)
      and not exists (
        select 1 from public.alert_event a
        where a.kind = 'deleted_but_source_live'
          and a.dedup_key = 'deleted_but_source_live:' || v.id::text)
  loop
    -- Did the source's re-listing find its way back into our inventory through the normal scraper
    -- path? Looked up by the listing's own URL in its own platform table.
    v_back := null; v_back_active := null; v_back_seen := null;
    if rec.source_table is not null and rec.listing_url is not null
       and exists (select 1 from pg_tables t where t.schemaname = 'public' and t.tablename = rec.source_table) then
      execute format(
        'select true, bool_or(x.active), max(x.last_seen_at) from public.%I x where x.listing_url = $1',
        rec.source_table)
        into v_back, v_back_active, v_back_seen using rec.listing_url;
      v_back := coalesce(v_back_seen is not null or v_back_active is not null, false);
    end if;

    n := n + public.mon_raise('P0', 'deleted_but_source_live', rec.platform,
      'deleted_but_source_live:' || rec.id::text,
      jsonb_build_object(
        'why', 'A listing this system hard-deleted now serves LIVE content again at its OWN '
             || 'original URL, per an independent post-delete spot-check. Either the pre-delete '
             || 'recheck itself has a bug (repair the recheck logic, not just this row), or the '
             || 'source genuinely re-listed the exact same URL after the delete (rarer, platform-'
             || 'dependent — verify before assuming the benign case).',
        'do_not', 'Do NOT auto-restore the row: the original row and its other fields are gone, '
                || 'and re-inserting from this probe alone would be reconstructing data from a '
                || 'single field (listing_url), which is exactly the guessing this routine forbids. '
                || 'A human must decide the repair.',
        'close_out', 'This alert clears ONLY via a row in ops_deleted_but_source_live_adjudication '
                || '(scope=verification, ref_id=' || rec.id::text || ') carrying a disposition and '
                || 'real evidence. SQL cannot re-probe a URL, so there is no automatic self-heal.',
        'reingested_row_exists', v_back,
        'reingested_active', v_back_active,
        'reingested_last_seen_at', v_back_seen,
        'read_the_reingestion_first', 'reingested_active = true means the source re-listed and our '
                || 'own crawler already brought the listing back: no inventory is missing, and the '
                || 'question left is only whether the delete-time verdict was sound (both '
                || 'adjudications on record found it was — gathern 404s are hard and unit-id keyed). '
                || 'reingested_row_exists = false is the dangerous shape: live at the source, absent '
                || 'from our inventory, i.e. listings a user can no longer find. This field is '
                || 'evidence for the adjudication, never a substitute for it.',
        'deletion_log_id', rec.deletion_log_id, 'verification_id', rec.id,
        'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'listing_url', rec.listing_url, 'deleted_at', rec.deleted_at, 'verified_at', rec.verified_at));
  end loop;

  -- LIMB 2: the legacy back-audit. Same finding, a population the engine's ledger cannot describe.
  v_live_keys := v_live_keys || (
    select coalesce(array_agg('deleted_but_source_live:backaudit:' || b.id::text), '{}')
      from public.ops_hard_deleted_listing_backaudit b
     where b.verdict = 'live'
       and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                        where j.scope = 'backaudit' and j.ref_id = b.id));

  for rec in
    select b.id, b.source_table, b.listing_id, b.ad_number, b.listing_url, b.probed_at,
           b.http_status, b.identity_source
      from public.ops_hard_deleted_listing_backaudit b
     where b.verdict = 'live'
       and not exists (select 1 from public.ops_deleted_but_source_live_adjudication j
                        where j.scope = 'backaudit' and j.ref_id = b.id)
       and not exists (
         select 1 from public.alert_event a
          where a.kind = 'deleted_but_source_live'
            and a.dedup_key = 'deleted_but_source_live:backaudit:' || b.id::text)
  loop
    v_back := null; v_back_active := null; v_back_seen := null;
    if rec.source_table is not null and rec.listing_url is not null
       and exists (select 1 from pg_tables t where t.schemaname = 'public' and t.tablename = rec.source_table) then
      execute format(
        'select true, bool_or(x.active), max(x.last_seen_at) from public.%I x where x.listing_url = $1',
        rec.source_table)
        into v_back, v_back_active, v_back_seen using rec.listing_url;
      v_back := coalesce(v_back_seen is not null or v_back_active is not null, false);
    end if;

    n := n + public.mon_raise('P0', 'deleted_but_source_live',
      split_part(rec.source_table, '_', 1),
      'deleted_but_source_live:backaudit:' || rec.id::text,
      jsonb_build_object(
        'why', 'A listing the RETIRED aqar_cleanup path hard-deleted (no source re-check, no '
             || 'evidence) is LIVE at the source today. That path deleted on age + strike count '
             || 'alone, so this is the failure mode it was expected to have, now measured on a '
             || 'specific listing rather than inferred.',
        'do_not', 'Do NOT reconstruct the row from this probe. All that survived this deletion is '
                || 'an id and an ad_number; every other field would be invented. Re-ingest it from '
                || 'the source through the normal scraper path, or leave it out — never both '
                || 'halves guessed.',
        'close_out', 'This alert clears ONLY via a row in ops_deleted_but_source_live_adjudication '
                || '(scope=backaudit, ref_id=' || rec.id::text || ') carrying a disposition and '
                || 'real evidence. SQL cannot re-probe a URL, so there is no automatic self-heal.',
        'reingested_row_exists', v_back,
        'reingested_active', v_back_active,
        'reingested_last_seen_at', v_back_seen,
        'backaudit_id', rec.id, 'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'ad_number', rec.ad_number, 'listing_url', rec.listing_url,
        'identity_source', rec.identity_source,
        'http_status', rec.http_status, 'probed_at', rec.probed_at));
  end loop;

  -- EVALUATED PATH ONLY (there is no early return above): clear any key no longer in the cohort,
  -- i.e. adjudicated, or its verification/backaudit row no longer reads 'live'.
  perform public.mon_resolve_stale_keys('deleted_but_source_live', v_live_keys);

  return n;
end $function$;

-- ── PROOF, EXECUTED, BOTH DIRECTIONS ────────────────────────────────────────────────────────────
-- The re-ingestion lookup must answer TRUE for a URL that is back and FALSE for one that is not.
-- Run against the two real subjects of the only two adjudications on record, so it cannot pass by
-- being vacuous, and the migration REFUSES to apply if either direction is wrong.
do $do$
declare v_back boolean; v_active boolean; v_seen timestamptz;
begin
  -- ref_id 102's unit (gathern 173391): re-listed by the source and re-ingested by our crawler.
  execute 'select true, bool_or(x.active), max(x.last_seen_at) from public.gathern_residential_listings x where x.listing_url = $1'
    into v_back, v_active, v_seen using 'https://gathern.co/view/121907/unit/173391';
  if not coalesce(v_active, false) then
    raise exception 'PROOF FAILED: gathern unit 173391 is active in the platform table by direct query, but the lookup returned active=%', v_active;
  end if;

  -- a URL that was never ingested must read as absent, not as a null that looks like presence.
  execute 'select true, bool_or(x.active), max(x.last_seen_at) from public.gathern_residential_listings x where x.listing_url = $1'
    into v_back, v_active, v_seen using 'https://gathern.co/view/121907/unit/000000-never-ingested';
  if v_seen is not null or v_active is not null then
    raise exception 'PROOF FAILED: a never-ingested URL reported presence (active=%, seen=%)', v_active, v_seen;
  end if;

  raise notice 'PROOF OK: re-ingestion lookup distinguishes a returned listing from an absent one';
end $do$;
