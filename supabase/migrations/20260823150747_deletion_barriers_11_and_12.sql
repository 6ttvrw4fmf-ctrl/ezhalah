-- Barriers 11 (deleted-but-source-live spot-check) and 12 (missing evidence ledger detector) for
-- the hard-delete lifecycle (owner-directed safety audit, 2026-08-22). Companion to
-- 20260822140529_migrate_aqar_wasalt_onto_safe_cleanup_engine.sql — that migration closed the gap
-- on aqar/wasalt; this one closes the two barriers that were genuinely missing from the engine
-- itself, confirmed by direct read of scrapers/common/cleanup.py and the migrations that shipped
-- it (20260727115000_retention_cleanup_framework.sql), not assumed.
-- Applied 2026-08-23 by Data Integrity run #39 from merged PR #898; body identical to the repo file.

-- ── Barrier 11: deleted-but-source-live spot-check ──────────────────────────────────────────────
create table if not exists public.cleanup_deletion_verification (
  id               bigint generated always as identity primary key,
  deletion_log_id  bigint      not null,
  platform         text        not null,
  source_table     text        not null,
  listing_id       bigint,
  listing_url      text        not null,
  deleted_at       timestamptz not null,
  http_status      int,
  verdict          text        not null,
  verified_at      timestamptz not null default now()
);
create index if not exists idx_cleanup_deletion_verification_platform_time
  on public.cleanup_deletion_verification (platform, verified_at desc);
create index if not exists idx_cleanup_deletion_verification_live
  on public.cleanup_deletion_verification (verified_at desc) where verdict = 'live';
alter table public.cleanup_deletion_verification enable row level security;

create or replace function public.mon_detect_deleted_but_source_live()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0;
begin
  for rec in
    select v.id, v.platform, v.source_table, v.listing_id, v.listing_url, v.deleted_at, v.verified_at
    from public.cleanup_deletion_verification v
    where v.verdict = 'live'
      and not exists (
        select 1 from public.alert_event a
        where a.kind = 'deleted_but_source_live'
          and a.dedup_key = 'deleted_but_source_live:' || v.id::text)
  loop
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
        'deletion_log_id', rec.id, 'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'listing_url', rec.listing_url, 'deleted_at', rec.deleted_at, 'verified_at', rec.verified_at));
  end loop;
  return n;
end $$;

comment on function public.mon_detect_deleted_but_source_live() is
  'Barrier 11 (owner-directed safety audit, 2026-08-22): a P0 for any hard-deleted row whose own '
  'URL served live content again at a later, independent spot-check (scrapers/common/'
  'verify_deletions.py -> cleanup_deletion_verification). Never auto-resolves — each finding is a '
  'discrete past event a human must adjudicate, not an ongoing condition.';

-- ── Barrier 12: missing evidence ledger detector ────────────────────────────────────────────────
create or replace function public.mon_detect_cleanup_evidence_gap()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0; log_count int;
begin
  for rec in
    select r.id, r.platform, r.deleted, r.ran_at
    from public.cleanup_runs r
    where r.ran_at > now() - interval '35 days'
      and not r.dry_run and not r.aborted and r.deleted > 0
  loop
    select count(*) into log_count from public.cleanup_deletion_log where run_id = rec.id;
    if log_count <> rec.deleted then
      n := n + public.mon_raise('P1', 'cleanup_evidence_gap', rec.platform,
        'cleanup_evidence_gap:' || rec.id::text,
        jsonb_build_object(
          'why', 'A cleanup run reported deleting N rows but its per-row audit trail '
               || '(cleanup_deletion_log) does not have exactly N matching rows for this run_id — '
               || 'the exact ledger-writer gap class that hid 2,954 unevidenced gathern liveness '
               || 'kills for 10 days (2026-08-22). Do NOT resolve by backfilling synthetic log '
               || 'rows: evidence for a run that did not write it is genuinely gone. Find and fix '
               || 'the writer so the NEXT run records its own decisions.',
          'run_id', rec.id, 'reported_deleted', rec.deleted, 'log_rows_found', log_count,
          'ran_at', rec.ran_at));
    end if;
  end loop;
  return n;
end $$;

comment on function public.mon_detect_cleanup_evidence_gap() is
  'Barrier 12 (owner-directed safety audit, 2026-08-22): every cleanup_runs row that reports N '
  'real deletions must have exactly N matching cleanup_deletion_log rows for that run_id. Raises '
  'P1 per run where they diverge. A standing 0 is the healthy reading.';

-- ── Roster registration, both detectors, SAME migration.
do $roster$
declare
  src text;
  anchor text := '''mon_detect_cron_ordering_contract''';
  needle text := ', ''mon_detect_deleted_but_source_live'', ''mon_detect_cleanup_evidence_gap''';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;

  if position('mon_detect_deleted_but_source_live' in src) > 0
     and position('mon_detect_cleanup_evidence_gap' in src) > 0 then
    raise notice 'already registered; nothing to do';
    return;
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  execute replace(src, anchor, anchor || needle);
end
$roster$;

-- Reachability check: fail the migration if the roster cannot reach either new detector.
do $check$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_deleted_but_source_live' in src) = 0
     or position('mon_detect_cleanup_evidence_gap' in src) = 0 then
    raise exception 'roster registration failed - one or both detectors would be decoration';
  end if;
end
$check$;

select cron.schedule('gh-verify-deletions', '0 5 * * 0',
  $cron$select public.trigger_gh_workflow('verify-deletions.yml')$cron$);
