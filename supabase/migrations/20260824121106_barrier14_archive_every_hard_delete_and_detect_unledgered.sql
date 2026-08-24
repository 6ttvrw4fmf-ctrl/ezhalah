-- Barrier 14 — EVERY hard delete of a listing row is recorded, whatever performed it.
--
-- WHY. Alert 931 (`cleanup_evidence_gap` / `deletion_bypassed_engine:aqar_cleanup`, P1, raised
-- 2026-08-23) is the record of 21,371 rows hard-deleted by the legacy scrapers/aqar/cleanup.py on
-- age + strike count alone: no final source re-check, no circuit breaker, no per-row audit trail.
-- Both of its entrypoints are now loud refusals (PR #951) and both platforms run on the unified
-- engine (PR #898). What was still missing is the part that makes a THIRD bypass impossible to miss.
--
-- The two barriers that existed each have a blind spot, and they are the same blind spot:
--   • mon_detect_deletion_spike reads `cleanup_runs`  — a bypass path never writes it.
--   • mon_detect_cleanup_evidence_gap limb B reads `scrape_runs` — it only sees a bypass that
--     bothers to open a run row whose platform string happens to contain 'cleanup'. The legacy
--     deleter did; a raw `delete from aqar_residential_listings` via SQL, a migration, an MCP
--     session or a psql prompt would not, and neither barrier would ever know.
--   • scripts/verify-no-unguarded-deleter.ts closes the repo half (no tracked file may hard-delete
--     a listings table outside the engine) but it cannot see a statement that never lands in a file.
--
-- So the record has to be taken at the only place every deletion must pass: the table itself.
-- An AFTER DELETE row trigger on all 67 `*_{residential,commercial}_listings` tables archives the
-- COMPLETE row into public.purged_listings_archive — a table that has existed, empty and unwritten,
-- since the retention framework shipped. Two consequences, both of which the legacy incident needed
-- and did not have:
--   1. a false deletion becomes PROVABLE (which listing, its ad_number, its listing_url) and
--      RECOVERABLE (row_data is the whole row), instead of "unknowable" as the 21,371 are;
--   2. mon_detect_unledgered_hard_delete() can compare what actually vanished against what the
--      engine wrote to cleanup_deletion_log BEFORE deleting it, and raise P0 on the difference.
--
-- ATTRIBUTION COMES FROM THE LEDGER, NEVER FROM THE DELETER. purged_listings_archive.deletion_reason
-- reads an optional `ezhalah.delete_reason` GUC purely so a human operation can leave a note. It is
-- deliberately NOT part of the detector's predicate: a bypass path could set that GUC just as easily
-- as it can skip the ledger, so a barrier that trusted it would be silenceable by the exact actor it
-- exists to catch. The only thing that clears a deletion is a matching cleanup_deletion_log row,
-- which only the engine writes, and which it writes BEFORE the delete (cleanup.py:366).
--
-- WHAT THIS DOES NOT DO: it does not block or slow a deletion, and it changes no deletion rule. The
-- engine's own gates (fresh source re-probe, 404/410-or-dead-marker only, inconclusive-freeze,
-- anomaly + fraction breakers, max_delete_per_run, platform-health gate) are untouched and remain
-- the only sanctioned way to delete a listing.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. The retirement register. A retired deletion path is a FACT with a timestamp, not a memory.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ops_retired_deletion_path (
  path                    text primary key,
  retired_at              timestamptz not null,
  retired_by              text        not null,
  evidence                text        not null,
  historical_rows_deleted bigint,
  first_run               timestamptz,
  last_run                timestamptz,
  recorded_at             timestamptz not null default now()
);
alter table public.ops_retired_deletion_path enable row level security;

comment on table public.ops_retired_deletion_path is
$c$Deletion paths that have been frozen, with the instant the freeze landed in main.

Read by mon_detect_cleanup_evidence_gap() limb B, which reports a bypass path only for runs that
happened AFTER its retired_at. That is what lets a permanent historical incident stop holding an
open P1 forever without weakening anything: a single deletion by a registered path after its
retired_at re-raises immediately, and an UNREGISTERED path raises on its very first row, because
coalesce(retired_at, '-infinity') leaves every one of its runs inside the window.

A row here is an assertion that the entrypoint is gone, and it is only half the proof. The other
half is enforced elsewhere and cannot be written away by inserting here:
  • scripts/verify-no-unguarded-deleter.ts (npm test) — no tracked file may hard-delete a listings
    table outside scrapers/common/cleanup.py, and both retired stubs must stay refusals;
  • mon_detect_unledgered_hard_delete() — any row that actually disappears without an engine ledger
    entry is a P0, whatever performed it and whatever this table says.$c$;

insert into public.ops_retired_deletion_path
  (path, retired_at, retired_by, evidence, historical_rows_deleted, first_run, last_run)
values (
  'aqar_cleanup',
  timestamptz '2026-08-23 13:33:34+00',
  'PR #951 (6f6b362) — scrapers/aqar/cleanup.py and scripts/wasalt-cleanup.sh replaced by refusal stubs',
  'Both entrypoints exit 2 with a refusal message and contain no delete call; aqar and wasalt run on '
  || 'the unified engine (PR #898, platform_retention_policy.enabled = true for both). Verified '
  || '2026-08-24: zero scrape_runs rows for this path after 2026-08-23 02:31:57Z.',
  21371,
  timestamptz '2026-06-21 11:58:43.342605+00',
  timestamptz '2026-08-23 02:31:57.276201+00'
)
on conflict (path) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. The archive trigger — armed on every listings table.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_archive_hard_deleted_listing()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare
  j jsonb := to_jsonb(old);
begin
  -- to_jsonb(old) rather than named columns: the 67 listings tables do not share one column set,
  -- and a ->> on a missing key is null instead of an error, so one trigger body fits all of them
  -- and keeps fitting when a platform adds a column.
  insert into public.purged_listings_archive
    (source_table, listing_id, row_data, missing_count, deactivated_at, deleted_at, deletion_reason)
  values (
    tg_table_name,
    (j->>'id')::bigint,
    j,
    nullif(j->>'missing_count','')::int,
    nullif(j->>'deactivated_at','')::timestamptz,
    now(),
    -- informational only; never a predicate (see this migration's header).
    coalesce(nullif(current_setting('ezhalah.delete_reason', true), ''), 'unattributed')
  );
  return old;
end $fn$;

comment on function public.tg_archive_hard_deleted_listing() is
$c$AFTER DELETE row trigger on every *_{residential,commercial}_listings table: archives the whole
deleted row into purged_listings_archive so that no hard delete — engine, migration, psql, MCP
session or a future bypass — can leave production without a per-row record. Feeds
mon_detect_unledgered_hard_delete(). Records, never blocks.$c$;

do $do$
declare t record; armed int := 0;
begin
  -- Fail fast rather than queueing an ACCESS EXCLUSIVE request behind a live scraper write and
  -- blocking every reader behind us. The whole migration is one transaction, so a timeout rolls
  -- back cleanly and is simply retried.
  perform set_config('lock_timeout', '5s', true);

  for t in
    select tab.table_name
      from information_schema.tables tab
     where tab.table_schema = 'public'
       and tab.table_type   = 'BASE TABLE'
       and (tab.table_name like '%\_residential\_listings' or tab.table_name like '%\_commercial\_listings')
       and exists (select 1 from information_schema.columns c
                    where c.table_schema='public' and c.table_name=tab.table_name and c.column_name='id')
  loop
    execute format('drop trigger if exists trg_archive_hard_delete on public.%I', t.table_name);
    execute format(
      'create trigger trg_archive_hard_delete after delete on public.%I '
      || 'for each row execute function public.tg_archive_hard_deleted_listing()', t.table_name);
    armed := armed + 1;
  end loop;
  raise notice 'trg_archive_hard_delete armed on % listings tables', armed;
end $do$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. The detector. Anything that vanished without an engine ledger row is a P0.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_detect_unledgered_hard_delete()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare
  rec record;
  n int := 0;
  live text[] := '{}';
begin
  for rec in
    select a.source_table,
           count(*) filter (where l.listing_id is null)              as unledgered,
           count(*)                                                  as archived,
           min(a.deleted_at) filter (where l.listing_id is null)     as first_at,
           max(a.deleted_at) filter (where l.listing_id is null)     as last_at,
           (array_agg(a.listing_id order by a.deleted_at desc)
              filter (where l.listing_id is null))[1:5]              as sample_ids
      from public.purged_listings_archive a
      -- The engine writes its ledger row BEFORE the delete (cleanup.py:366), so a matching entry
      -- always exists within seconds. The ±6h window is slack for a long batch, not a loophole:
      -- it still requires a row naming this exact listing in this exact table.
      left join public.cleanup_deletion_log l
             on l.source_table = a.source_table
            and l.listing_id   = a.listing_id
            and l.deleted_at  between a.deleted_at - interval '6 hours'
                                  and a.deleted_at + interval '6 hours'
     where a.deleted_at > now() - interval '35 days'
     group by 1
    having count(*) filter (where l.listing_id is null) > 0
  loop
    live := live || ('unledgered_hard_delete:' || rec.source_table);
    n := n + public.mon_raise('P0', 'unledgered_hard_delete',
      split_part(rec.source_table, '_', 1),
      'unledgered_hard_delete:' || rec.source_table,
      jsonb_build_object(
        'why', 'Listing rows were HARD-DELETED from this table with no matching cleanup_deletion_log '
             || 'entry, so they did not go through scrapers/common/cleanup.py: no fresh source '
             || 're-probe, no inconclusive-freeze, no anomaly or fraction breaker, no cap. The '
             || 'engine writes its ledger row BEFORE deleting, so a missing entry means the delete '
             || 'came from somewhere else.',
        'action', 'Find the entrypoint and freeze it (see ops_retired_deletion_path for how the '
               || 'aqar_cleanup path was retired). The rows themselves are RECOVERABLE: '
               || 'purged_listings_archive.row_data holds each complete row. Adjudicate against '
               || 'source truth before restoring anything — a 403/429/5xx/timeout is inconclusive '
               || 'and is not permission to delete OR to restore.',
        'source_table', rec.source_table, 'unledgered_rows', rec.unledgered,
        'archived_rows_in_window', rec.archived, 'sample_listing_ids', to_jsonb(rec.sample_ids),
        'first_at', rec.first_at, 'last_at', rec.last_at));
  end loop;

  perform public.mon_resolve_stale_keys('unledgered_hard_delete', live);
  return n;
end $fn$;

comment on function public.mon_detect_unledgered_hard_delete() is
$c$Barrier 14. P0 when a listing row disappeared without the engine's per-row evidence.

This is the only deletion barrier that does not depend on the deleter cooperating.
mon_detect_deletion_spike reads cleanup_runs and mon_detect_cleanup_evidence_gap limb B reads
scrape_runs — a raw `delete from <platform>_residential_listings` writes neither, and before this
barrier existed it would have been invisible in production and merely absent from CI. The evidence
here is taken by an AFTER DELETE trigger on the table itself, so the deletion cannot avoid it.

Healthy reading: 0. Any non-zero value names a deletion path that is not the engine.$c$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Limb B of barrier 12 gets the retirement gate, so a frozen path's history stops re-raising
--    a P1 that nothing can ever clear — while a single post-freeze deletion still raises at once.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_detect_cleanup_evidence_gap()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare
  rec record;
  n int := 0;
  live_all text[] := '{}';          -- ONE live set: all three limbs share kind 'cleanup_evidence_gap'
  ledger_epoch constant timestamptz := timestamptz '2026-08-01 00:00:00+00';
begin
  -- ── LIMB A: a REAL engine run whose per-row evidence does not match what it deleted. ────────
  for rec in
    select s.id, s.platform, s.rows_upserted as reported, s.started_at,
           (select count(*) from public.cleanup_deletion_log l where l.run_id = s.id) as logged
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and coalesce(s.rows_upserted, 0) > 0
       and s.notes like '%dry_run=False%'
       and s.started_at > greatest(now() - interval '35 days', ledger_epoch)
  loop
    if rec.logged <> rec.reported then
      live_all := live_all || ('cleanup_evidence_gap:' || rec.id::text);
      n := n + public.mon_raise('P1', 'cleanup_evidence_gap',
        split_part(rec.platform, ':', 2), 'cleanup_evidence_gap:' || rec.id::text,
        jsonb_build_object(
          'why', 'A REAL (non-dry) engine cleanup run reported deleting N rows but '
               || 'cleanup_deletion_log holds a different number for that run_id. run_id is the '
               || 'SCRAPE_RUNS id (cleanup.py:219 begin_run -> :366 log rows), not cleanup_runs.id.',
          'do_not', 'Do NOT backfill synthetic ledger rows: evidence a run never wrote is gone. '
                 || 'Fix the writer so the NEXT run records its own decisions.',
          'scrape_run_id', rec.id, 'platform', rec.platform,
          'reported_deleted', rec.reported, 'log_rows_found', rec.logged, 'ran_at', rec.started_at));
    end if;
  end loop;

  -- ── LIMB B: a deletion path that is not the safe engine. Unevidenced by construction. ───────
  -- The retirement gate (added 2026-08-24 with barrier 14) counts only runs AFTER the path's
  -- registered retired_at. An unregistered path has no row, coalesce gives '-infinity', and every
  -- one of its runs counts — so a NEW bypass still raises on its first deletion. What the gate
  -- removes is only this: a permanently frozen path's historical runs holding a P1 open that no future
  -- state can clear, which is the §23a/§25b unresolvable-alert class. The frozen path's history is
  -- not discarded, it is recorded with its totals in ops_retired_deletion_path, and the deletions
  -- themselves are audited row-by-row in ops_hard_deleted_listing_backaudit.
  for rec in
    select split_part(s.platform, ':', 1) as path,
           sum(s.rows_upserted)::bigint as deleted_total,
           count(*)::int                as runs,
           max(s.started_at)            as last_run,
           min(s.started_at)            as first_run,
           array_agg(distinct split_part(s.platform, ':', 2)) as tables_touched
      from public.scrape_runs s
     where s.platform not like 'cleanup:%'
       and s.platform like '%cleanup%'
       and coalesce(s.rows_upserted, 0) > 0
       and s.started_at > now() - interval '35 days'
       and s.started_at > coalesce(
             (select r.retired_at from public.ops_retired_deletion_path r
               where r.path = split_part(s.platform, ':', 1)),
             '-infinity'::timestamptz)
     group by 1
  loop
    live_all := live_all || ('deletion_bypassed_engine:' || rec.path);
    n := n + public.mon_raise('P1', 'cleanup_evidence_gap', rec.path,
      'deletion_bypassed_engine:' || rec.path,
      jsonb_build_object(
        'why', 'Rows were HARD-DELETED by a path that is not scrapers/common/cleanup.py, so none '
             || 'of the engine guarantees applied: no final live re-probe before deleting, no '
             || 'anomaly or fraction circuit breaker, and no per-row audit trail. Nothing records '
             || 'WHICH listings were removed, so a false deletion here is unprovable and '
             || 'unrecoverable. mon_detect_deletion_spike cannot see this either — it reads '
             || 'cleanup_runs, which a bypass path never writes.',
        'context', 'gathern''s own 18-day pilot measured 14 of 50 age+strike-eligible rows STILL '
                || 'LIVE at the final recheck (28%). A path that deletes on age and strike count '
                || 'with no recheck is therefore expected to remove live listings, not merely '
                || 'risk it.',
        'action', 'Migrate the path onto the engine (platform_retention_policy.enabled) and retire '
               || 'its entrypoint, then register the freeze in ops_retired_deletion_path.',
        'bypass_path', rec.path, 'runs_35d', rec.runs, 'rows_deleted_35d', rec.deleted_total,
        'tables_touched', to_jsonb(rec.tables_touched),
        'first_run', rec.first_run, 'last_run', rec.last_run));
  end loop;

  -- ── LIMB C: an engine run this barrier cannot classify. Raise rather than read clean. ───────
  for rec in
    select s.id, s.platform, s.rows_upserted, s.started_at
      from public.scrape_runs s
     where s.platform like 'cleanup:%'
       and coalesce(s.rows_upserted, 0) > 0
       and (s.notes is null or s.notes not like '%dry_run=%')
       and s.started_at > now() - interval '35 days'
  loop
    live_all := live_all || ('cleanup_run_unclassifiable:' || rec.id::text);
    n := n + public.mon_raise('P2', 'cleanup_evidence_gap',
      split_part(rec.platform, ':', 2), 'cleanup_run_unclassifiable:' || rec.id::text,
      jsonb_build_object(
        'why', 'An engine cleanup run recorded deletions but its notes carry no dry_run= marker, '
             || 'so limb A cannot tell a real deletion from a dry run and this run is NOT being '
             || 'evidence-checked. The marker is the only carrier of that flag on scrape_runs.',
        'action', 'Restore the dry_run= marker in cleanup.py''s end_run notes, or give scrape_runs '
               || 'a real column for it. Do not widen limb A to guess.',
        'scrape_run_id', rec.id, 'platform', rec.platform, 'reported_deleted', rec.rows_upserted,
        'ran_at', rec.started_at));
  end loop;

  -- ONE resolve, over the UNION, under the kind these alerts actually carry. Calling this per limb
  -- makes each call claim the whole kind and silently resolve the other limbs' open alerts.
  perform public.mon_resolve_stale_keys('cleanup_evidence_gap', live_all);

  return n;
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Roster wiring — guarded needle-edit (reads the LIVE body, splices one name, re-executes), so
--    it cannot drop entries it never read. See scripts/verify-detector-roster-edits-are-guarded.ts.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
do $do$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_unledgered_hard_delete' in src) > 0 then return; end if;

  newsrc := replace(src,
    '''mon_detect_cleanup_evidence_gap''',
    '''mon_detect_cleanup_evidence_gap'', ''mon_detect_unledgered_hard_delete''');

  if newsrc = src then
    raise exception 'roster anchor mon_detect_cleanup_evidence_gap not found — refusing to guess';
  end if;

  execute newsrc;
end $do$;