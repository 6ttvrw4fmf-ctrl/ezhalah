-- source_confirmed_dead_at: "the SOURCE told us this listing is gone, at this moment."
-- The 30-day retention clock runs from THIS, not from last crawl contact. Owner decision 2026-09-12.
--
-- THE DEFECT THIS CLOSES (ops_incident #24, open since 2026-09-05, blocked for an owner decision).
-- The deletion engine's candidate predicate was:
--
--     active = false  AND  missing_count >= min_missing_count  AND  last_seen_at < now() - 30 days
--
-- Every term of that is about OUR CRAWL, not about the source. `last_seen_at` is "a crawl
-- encountered this row"; `missing_count` is accumulated by db.prune_unseen() from crawl ABSENCE,
-- which is EvidenceKind.ABSENCE — the evidence LISTING_LIVENESS.md §1-§3 forbids as a death
-- verdict. So a listing entered the queue for PERMANENT, UNRECOVERABLE deletion on exactly the
-- evidence that may never kill it, and only the delete-time re-probe stood in the way.
--
-- The owner's rule, in his words, 2026-09-12: "the most important thing is that whenever something
-- is removed, we remove it" — together with the half this column enforces: REMOVED MEANS THE
-- SOURCE SAID SO. He also directed that deletion NOT be switched on for all 48 platforms at once,
-- but per platform as each becomes verifiable, and that a new website arrive with its deletion
-- policy configured. This migration is step one of that: make the clock honest before widening it.
--
-- MEASURED ON PRODUCTION THE DAY THIS SHIPPED, against rows already past the 30-day mark:
--
--     aqar_residential      20,548 eligible —      0 with any recorded source verdict
--     wasalt_residential    11,207 eligible —  8,029 with a recorded DIRECT 404/410
--     gathern_residential    1,811 eligible —  1,811 with a recorded DIRECT 404/410
--
-- aqar's zero is not evidence that aqar guesses: its sweep does probe each listing's own URL at
-- full grace. It is evidence that aqar never WROTE ITS FINDINGS DOWN — aqar_liveness_detail was
-- created 2026-08-31 and had never received a single row (ops_incident #214, fixed the same day in
-- PR #2390). A clock cannot be gated on evidence nobody recorded, which is why the blackout had to
-- be closed first and why this migration can only backfill where real per-row readings exist.
--
-- ============================ WHY THIS BACKFILL IS NOT THE ONE §3 FORBIDS ====================
-- Migration 20260830183939 deliberately did NOT backfill `last_verified_alive_at`, because the only
-- available source (last_seen_at) could not distinguish "we proved it alive" from "a crawler saw
-- it" — backfilling would have manufactured ~198,000 verifications that never happened.
--
-- This backfill is the opposite shape: it reads PER-ROW, PER-LISTING recordings of an actual DIRECT
-- fetch that returned 404/410, or an oracle that recorded verdict='gone' for that specific ad. It
-- materialises evidence we already hold into the column that now gates the clock; it does not
-- invent any. Rows with no such recording get NULL and therefore become NON-deletable — the safe
-- direction, and the whole point.
--
-- It stamps the EVIDENCE'S OWN TIMESTAMP, never now(). Stamping now() would silently restart the
-- retention clock for every already-confirmed row, delaying legitimate cleanup by 30 days and
-- misreporting when the source actually spoke.
--
-- ================================== SAFETY ==================================================
-- * Additive: ADD COLUMN IF NOT EXISTS, nullable, no DEFAULT. Catalog-only, no table rewrite.
-- * The UPDATEs touch ONLY this new column, ONLY on rows that are ALREADY active = false, and
--   ONLY where a matching evidence row exists. Nothing here can flip `active`, delete a row, or
--   make a row deletable that was not already past every existing gate.
-- * This migration DELETES NOTHING and ENABLES NO PLATFORM. platform_retention_policy is untouched.
-- * Net effect on deletion is strictly SUBTRACTIVE: rows without evidence stop being candidates.
--   aqar's 20,548 unevidenced candidates become ineligible until its sweep re-earns the stamp.
-- * Idempotent; re-running is a no-op. Rollback is a plain DROP COLUMN per table.

do $$
declare
  t         text;
  n_tables  int;
  n_after   int;
  n_stamped bigint := 0;
  n_this    bigint;
begin
  select count(*) into n_tables
    from pg_tables
   where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$';

  -- ── 1. The column, on every listing table (same predicate the rest of the system uses) ───────
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
     order by tablename
  loop
    execute format(
      'alter table public.%I add column if not exists source_confirmed_dead_at timestamptz', t);
    execute format(
      'comment on column public.%I.source_confirmed_dead_at is %L', t,
      'The moment the SOURCE affirmatively confirmed this listing is gone — a liveness_contract '
      'DEAD verdict on DIRECT evidence at full strike grace. The 30-day retention clock runs from '
      'THIS column, not from last_seen_at. NULL = never source-confirmed, and a NULL row is NEVER '
      'deletable however old it is. Never written from crawl absence, from an UNKNOWN response, '
      'from last_seen_at, or by hand: only liveness_contract.death_patch() may write it.');
  end loop;

  select count(*) into n_after
    from information_schema.columns
   where table_schema = 'public' and column_name = 'source_confirmed_dead_at'
     and table_name ~ '_(residential|commercial)_listings$';

  if n_after <> n_tables then
    raise exception 'source_confirmed_dead_at missing on % of % listing tables',
                    n_tables - n_after, n_tables;
  end if;

  -- ── 2. Backfill from RECORDED per-row DIRECT dead readings only ─────────────────────────────
  -- gathern: its own evidence ledger, the one platform that has written it since 2026-08-12.
  update public.gathern_residential_listings r
     set source_confirmed_dead_at = d.first_dead
    from (select listing_id, min(run_at) as first_dead
            from public.gathern_liveness_detail
           where http_status in (404, 410) group by listing_id) d
   where d.listing_id = r.id and r.active is false and r.source_confirmed_dead_at is null;
  get diagnostics n_this = row_count; n_stamped := n_stamped + n_this;

  -- wasalt: the pilot detail ledger, keyed by (tbl, listing_id).
  update public.wasalt_residential_listings r
     set source_confirmed_dead_at = d.first_dead
    from (select listing_id, min(run_at) as first_dead
            from public.wasalt_liveness_pilot_detail
           where get_status in (404, 410) and tbl = 'wasalt_residential_listings'
           group by listing_id) d
   where d.listing_id = r.id and r.active is false and r.source_confirmed_dead_at is null;
  get diagnostics n_this = row_count; n_stamped := n_stamped + n_this;

  update public.wasalt_commercial_listings r
     set source_confirmed_dead_at = d.first_dead
    from (select listing_id, min(run_at) as first_dead
            from public.wasalt_liveness_pilot_detail
           where get_status in (404, 410) and tbl = 'wasalt_commercial_listings'
           group by listing_id) d
   where d.listing_id = r.id and r.active is false and r.source_confirmed_dead_at is null;
  get diagnostics n_this = row_count; n_stamped := n_stamped + n_this;

  -- aqar and dealapp: their ledgers were EMPTY when this shipped (ops_incident #214), so these
  -- stamp zero rows today and earn real ones from the first sweep after PR #2390. Written anyway
  -- so the backfill is complete by construction rather than by the state of one afternoon.
  update public.aqar_residential_listings r
     set source_confirmed_dead_at = d.first_dead
    from (select listing_id, min(run_at) as first_dead
            from public.aqar_liveness_detail
           where verdict = 'kill' and source_table = 'aqar_residential_listings'
           group by listing_id) d
   where d.listing_id = r.id and r.active is false and r.source_confirmed_dead_at is null;
  get diagnostics n_this = row_count; n_stamped := n_stamped + n_this;

  update public.aqar_commercial_listings r
     set source_confirmed_dead_at = d.first_dead
    from (select listing_id, min(run_at) as first_dead
            from public.aqar_liveness_detail
           where verdict = 'kill' and source_table = 'aqar_commercial_listings'
           group by listing_id) d
   where d.listing_id = r.id and r.active is false and r.source_confirmed_dead_at is null;
  get diagnostics n_this = row_count; n_stamped := n_stamped + n_this;

  -- ── 3. Every platform: the shared oracle ledger (a GONE verdict is an affirmative negative) ──
  --
  -- TWO THINGS THIS JOIN GETS RIGHT, both found by verifying against production rather than by
  -- reading the schema (2026-09-13, the first real mustqr run after PR #2391):
  --
  --  1. THE VERDICT IS STORED UPPERCASE. db.prune_unseen() lowercases the oracle's reply for its
  --     own comparison but writes `"verdict": "GONE"` into the ledger. Matching 'gone' matched
  --     ZERO of the 4,541 GONE rows — a backfill that silently did nothing while reporting success.
  --  2. HALF THE LEDGER HAS NO listing_id. prune_unseen writes evidence keyed by ad_number
  --     (2,157 of 4,541 GONE rows carry ad_number and a NULL listing_id), because at that point it
  --     is working from the set of ad_numbers it just probed. Joining on listing_id alone silently
  --     skipped every oracle-guarded platform — mustqr, raghdan, sanadak, aqargate, jurash —
  --     i.e. exactly the platforms whose evidence is the whole reason this ledger exists.
  --
  -- Matching on EITHER key is correct: both identify the same row, and the evidence is real
  -- regardless of which column the writer happened to fill in.
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
     order by tablename
  loop
    execute format($f$
      update public.%I r
         set source_confirmed_dead_at = p.first_gone
        from (select listing_id, ad_number, min(probed_at) as first_gone
                from public.ops_stale_inactivation_probe
               where upper(verdict) = 'GONE' and source_table = %L
               group by listing_id, ad_number) p
       where (p.listing_id = r.id or (p.listing_id is null and p.ad_number = r.ad_number))
         and r.active is false and r.source_confirmed_dead_at is null
    $f$, t, t);
    get diagnostics n_this = row_count; n_stamped := n_stamped + n_this;
  end loop;

  raise notice 'source_confirmed_dead_at: column on % tables, % inactive rows stamped from '
               'recorded DIRECT evidence. Rows left NULL are NOT deletable.', n_tables, n_stamped;
end $$;

-- ROLLBACK (nothing reads this column until the cleanup predicate ships, and no data was
-- transformed, so rollback loses only the materialised view of evidence that still exists in the
-- ledgers it was read from):
--   do $$ declare t text; begin
--     for t in select tablename from pg_tables
--              where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
--     loop execute format('alter table public.%I drop column if exists source_confirmed_dead_at', t);
--     end loop; end $$;

-- ============================================================================================
-- THE DETECTOR THAT WATCHES THIS REPAIR
-- ============================================================================================
-- Every data repair must ship with something that watches it
-- (scripts/verify-repair-migrations-are-guarded.ts). The specific risk this backfill introduces
-- is a stamp that is NOT backed by a real recorded reading — a row condemned to the deletion
-- clock by our own bookkeeping rather than by the source. That is the exact shape
-- LISTING_LIVENESS.md §3 forbids for `last_verified_alive_at` ("a sweep that sets it by hand can
-- stamp a row it never read, which is WORSE than the blind spot the column was added to remove"),
-- and it is strictly more dangerous here, because this column's end state is deletion.
--
-- So the detector asks the question in the unsafe direction: is any stamped row unsupported?
-- DETECT-ONLY. It writes to no listing, no index and no location table.

create or replace function public.ops_lifecycle_unevidenced_death_stamp()
returns table(source_table text, stamped bigint, unsupported bigint)
language plpgsql stable security definer set search_path to 'public' as $fn$
declare t text;
begin
  for t in
    select tablename from pg_tables
     where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
     order by tablename
  loop
    return query execute format($q$
      select %L::text,
             count(*) filter (where r.source_confirmed_dead_at is not null),
             count(*) filter (
               where r.source_confirmed_dead_at is not null
                 and not exists (select 1 from public.ops_stale_inactivation_probe p
                                  where p.source_table = %L
                                    and (p.listing_id = r.id
                                         or (p.listing_id is null and p.ad_number = r.ad_number))
                                    and upper(p.verdict) = 'GONE')
                 and not exists (select 1 from public.gathern_liveness_detail g
                                  where %L = 'gathern_residential_listings'
                                    and g.listing_id = r.id and g.http_status in (404,410))
                 and not exists (select 1 from public.wasalt_liveness_pilot_detail w
                                  where w.tbl = %L and w.listing_id = r.id
                                    and w.get_status in (404,410))
                 and not exists (select 1 from public.aqar_liveness_detail a
                                  where a.source_table = %L and a.listing_id = r.id
                                    and a.verdict = 'kill')
                 and not exists (select 1 from public.dealapp_liveness_detail d
                                  where d.source_table = %L and d.listing_id = r.id
                                    and d.verdict = 'kill'))
        from public.%I r
    $q$, t, t, t, t, t, t, t);
  end loop;
end $fn$;

comment on function public.ops_lifecycle_unevidenced_death_stamp() is
  'Per listing table: how many rows carry source_confirmed_dead_at, and how many of those have NO '
  'recorded DIRECT dead reading behind them. The second number must be 0. A non-zero means a row '
  'is on the 30-day clock to permanent deletion on our own bookkeeping rather than on the source.';

create or replace function public.mon_detect_unevidenced_death_stamp()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; r record;
begin
  for r in select * from public.ops_lifecycle_unevidenced_death_stamp() where unsupported > 0
  loop
    n := n + public.mon_raise(
      'P1', 'unknown_treated_as_dead', r.source_table,
      'unevidenced_death_stamp:' || r.source_table,
      jsonb_build_object(
        'unsupported', r.unsupported,
        'stamped', r.stamped,
        'source_table', r.source_table,
        'why', 'These rows carry source_confirmed_dead_at — the stamp that starts the 30-day '
            || 'clock to PERMANENT deletion — with no recorded DIRECT dead reading behind them. '
            || 'Only liveness_contract.death_patch() may write that column, from a decide() '
            || 'result that reached action=deactivate on DIRECT evidence at full grace.',
        'action', 'Find what wrote the stamp. Do NOT clear it blindly and do NOT delete these '
            || 'rows. If the write path is wrong, fix the writer and NULL the unsupported stamps '
            || '— a NULL stamp simply makes the row non-deletable, which is the safe direction.'));
  end loop;
  if n = 0 then perform public.mon_resolve_key('unknown_treated_as_dead'); end if;
  return n;
end $fn$;

-- Roster entry, in this SAME migration: a detector outside mon_run_all_detectors() is decoration,
-- and mon_detect_orphaned_detectors() fires on one. Surgical string replace, never a rebuild from
-- a stale base — several sessions extend this array concurrently.
do $roster$
declare v_src text; v_new text; v_before int; v_after int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_src is null then
    raise exception 'mon_run_all_detectors() not found — roster cannot be extended';
  end if;
  if position('mon_detect_unevidenced_death_stamp' in v_src) > 0 then
    raise notice 'roster already carries mon_detect_unevidenced_death_stamp; nothing to do';
    return;
  end if;
  v_before := (select count(*) from regexp_matches(v_src, '''mon_detect_[a-z0-9_]+''', 'g'));
  v_new := replace(v_src,
    $old$'mon_detect_deletion_clock_without_evidence'$old$,
    $new$'mon_detect_deletion_clock_without_evidence',
    -- routine #11 ♻️ watches the source_confirmed_dead_at backfill (ops_incident #24)
    'mon_detect_unevidenced_death_stamp'$new$);
  if v_new = v_src then
    raise exception 'roster needle did not match — refusing to leave the detector orphaned';
  end if;
  v_after := (select count(*) from regexp_matches(v_new, '''mon_detect_[a-z0-9_]+''', 'g'));
  if v_after <> v_before + 1 then
    raise exception 'roster grew by %, expected exactly 1 — refusing to write', v_after - v_before;
  end if;
  execute v_new;
end $roster$;
