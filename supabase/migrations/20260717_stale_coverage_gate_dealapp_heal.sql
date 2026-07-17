-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DEALAPP STALE-UNLOCK HEAL — companion to 20260717_stale_coverage_gate.sql.
-- STAGED 2026-07-17 on branch fix/stale-coverage-gate.  BACKUP-FIRST, hard-fail on any
-- scope/backup/update mismatch.  DELIBERATELY not applied from this branch: the main session
-- runs it under the deployment lock AFTER the coverage-gate function fix is live.
--
-- WHAT / WHY
--   Before the gate fix, the daily 04:00 UTC mark_stale sweep killed live-but-under-crawled
--   dealapp listings and stamped missing_count=3, permanently locking them out of
--   auto_recover_false_inactive() (which only heals missing_count=0 rows).  This heal resets
--   ONLY the pure time-sweep victims back to missing_count=0 — it does NOT force active=true.
--   The now-fixed crawler (already at 1600+/day) + auto_recover then restore the genuinely-live
--   ones organically (re-see → batch upsert active=true+mc=0, and/or auto_recover), while the
--   genuinely-gone ones are never re-seen and stay inactive with an old last_seen_at.
--
-- EXACT SCOPE (dealapp_residential_listings only — the time-sweep signature)
--     active = false
--     AND missing_count = 3
--     AND deactivated_at::time BETWEEN 03:58 and 04:06         -- the 04:00 UTC mark_stale run
--     AND (deactivated_at - last_seen_at) BETWEEN 7d and 8d12h  -- last seen 7–8 days before the kill
--   Live count 2026-07-17: 943 rows (last_seen_at 2026-07-03 .. 2026-07-09).
--
-- WHAT IS DELIBERATELY EXCLUDED (and why)
--   • dealapp SOLD-PINS: none exist (every dealapp scrape_runs.notes reports "sold=0"), and a
--     _pin_sold_inactive row would carry a FRESH last_seen_at — excluded by the ≥ 7-day gap.
--   • The 906-row cohort deactivated ~14:27 on 2026-07-10 (NOT a 04:00 mark_stale run; wild
--     gaps incl. negative = several already re-seen since) and the lone 04:52/07-16 row — NOT
--     the time-sweep signature, left untouched.  (Some of that 906 cohort is demonstrably live
--     yet mc=3-locked; flagged to the main session as a separate, out-of-scope follow-up.)
--   • dealapp_commercial_listings: its 5 inactive rows are all in the 14:27/07-10 cohort — 0
--     rows match the 04:00 signature, so this heal is residential-only.
--   • gathern / wasalt / aqar and every other platform: not referenced; zero rows modified.
--
-- RESET SEMANTICS: missing_count 3 → 0, active stays false, last_seen_at / deactivated_at
--   untouched.  This is purely an UN-LOCK; it resurrects nothing on its own (auto_recover still
--   needs a last_seen_at within 24h, which these rows do not have until genuinely re-crawled).
--
-- ROLLBACK: restore missing_count per row from ops_stale_unlock_backup_20260717
--   (update d set missing_count = b.missing_count_old ... join on id); drop the backup only
--   after owner review.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.ops_stale_unlock_backup_20260717 (
  source_table       text        not null,
  listing_id         bigint      not null,
  ad_number          text,
  active             boolean,
  missing_count_old  integer,
  deactivated_at     timestamptz,
  unlocked_at        timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.ops_stale_unlock_backup_20260717 enable row level security;
revoke all on public.ops_stale_unlock_backup_20260717 from anon, authenticated;

do $heal$
declare
  v_tbl  constant text := 'dealapp_residential_listings';
  scope int; backed int; updated int;
begin
  -- deterministic scope predicate, identical for count / backup / update
  select count(*) into scope
    from public.dealapp_residential_listings
   where active = false
     and missing_count = 3
     and deactivated_at::time between time '03:58' and time '04:06'
     and (deactivated_at - last_seen_at) between interval '7 days' and interval '8 days 12 hours';

  insert into public.ops_stale_unlock_backup_20260717
         (source_table, listing_id, ad_number, active, missing_count_old, deactivated_at)
  select v_tbl, id, ad_number, active, missing_count, deactivated_at
    from public.dealapp_residential_listings
   where active = false
     and missing_count = 3
     and deactivated_at::time between time '03:58' and time '04:06'
     and (deactivated_at - last_seen_at) between interval '7 days' and interval '8 days 12 hours';
  get diagnostics backed = row_count;

  update public.dealapp_residential_listings
     set missing_count = 0
   where active = false
     and missing_count = 3
     and deactivated_at::time between time '03:58' and time '04:06'
     and (deactivated_at - last_seen_at) between interval '7 days' and interval '8 days 12 hours';
  get diagnostics updated = row_count;

  if scope <> backed or scope <> updated then
    raise exception 'stale-unlock scope mismatch on %: scope=% backed=% updated=%',
      v_tbl, scope, backed, updated;
  end if;
  raise notice 'stale-unlock %: % row(s) reset missing_count 3 -> 0 (active stays false; backup rows=%)',
    v_tbl, updated, backed;
end $heal$;
