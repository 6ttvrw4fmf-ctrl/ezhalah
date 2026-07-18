-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DEALAPP 14:27-COHORT UNLOCK — reconciles / partially reverses FIX B4 of
-- 20260717_lifecycle_safety.sql for the dealapp_residential rows it mislabelled as legacy-sold.
-- STAGED 2026-07-18 on branch fix/dealapp-1427-unlock.  BACKUP-FIRST, hard-fail on any
-- scope/backup/update mismatch.  DELIBERATELY NOT applied from this branch: the main session
-- runs it under the deployment lock after review.
--
-- ══ WHAT B4 DID, AND WHY IT WAS WRONG FOR THIS COHORT ══════════════════════════════════════
--   FIX B4 (20260717_lifecycle_safety.sql) pinned every dealapp_residential row that sat at
--   active=false AND missing_count=0 up to missing_count=3, on the belief they were the
--   "pre-#92 legacy SOLD" population (see B4 header: "907 legacy sold").  ALL 907 of those
--   rows are recorded in ops_legacy_pin_backup_20260717 (source_table =
--   'dealapp_residential_listings') — verified 2026-07-18: the current
--   active=false AND missing_count=3 set is EXACTLY those same 907 ids (907/907 in the B4
--   backup, 0 outside it), and it is DISJOINT from the 943-row 04:00 mark_stale cohort that
--   20260717_stale_coverage_gate_dealapp_heal.sql already reset to missing_count=0
--   (0 rows overlap; that heal's backup is ops_stale_unlock_backup_20260717).
--
--   The "legacy SOLD" belief does not hold for this cohort:
--     • dealapp has NO sold-pins: every dealapp scrape_runs.notes reports "sold=0", and #92's
--       _pin_sold_inactive has never fired for it.  These rows were not sold-detected.
--     • 906 of the 907 were deactivated in a single MANUAL bulk-flip at 2026-07-10 14:27:37 UTC
--       (not a 04:00 mark_stale run, not sold-detection); the remaining 1 was flipped at
--       2026-07-16 04:52 UTC.  Deactivation timestamps span 2026-07-10 14:27 .. 2026-07-16 04:52.
--     • They are demonstrably NOT all gone: 2 rows have a NEGATIVE (last_seen_at − deactivated_at)
--       gap — i.e. the crawler re-saw them AFTER the flip; 1 was last_seen within 48h; the newest
--       last_seen is 2026-07-17 04:48 (crawled the day before this migration).  last_seen_at spans
--       2026-06-29 .. 2026-07-17.
--     • Source re-check 2026-07-18: a fresh sample of 15 of these listing_urls fetched live from
--       dealapp.sa returned 9 LIVE (full listing detail, in-stock, no مباع/مؤجر marker), 6
--       inconclusive (client-rendered SPA returned its shell — one such row re-fetched LIVE on
--       retry, confirming the shells are a render artifact, not a "gone" page), and 0 sold /
--       0 rented / 0 blocked.  All 3 rows the DB flagged as still-alive (both negative-gap rows
--       + the seen-today row) fetched LIVE.  Consistent with the earlier forensic pass (22 urls
--       → 20 live, 0 sold).  If a datacenter IP is 403-blocked on a later re-check, the
--       conclusion still rests on the DB-behavioral evidence + mechanism safety below — exactly
--       the basis the owner already accepted for the companion 943-row stale heal.
--
-- ══ EXACT SCOPE (dealapp_residential_listings ONLY) ════════════════════════════════════════
--     active = false AND missing_count = 3
--   This predicate is the single source of truth and is byte-identical for the count, the
--   backup insert and the update.  Live count 2026-07-18: 907 rows.  Because the 943 mark_stale
--   cohort is already at missing_count=0 and no other dealapp_residential rows sit at
--   active=false/mc=3, this predicate now selects exactly the B4 14:27-cohort and nothing else.
--   If the live count has drifted by apply time, the PREDICATE still governs (not the literal
--   907) and the scope==backup==update hard-fail catches any internal inconsistency.
--
-- ══ WHY THIS UNLOCK IS SAFE (same logic as the accepted 943-row heal) ══════════════════════
--   Resetting missing_count 3 → 0 RESURRECTS NOTHING on its own.  active stays false; only two
--   things ever flip a dealapp_residential row back to active=true:
--     (1) the dealapp crawler genuinely re-sees it on source and upserts active=true+mc=0
--         (the now-fixed crawler is running at 1600+/day), or
--     (2) the nightly auto_recover_false_inactive() (jobid 30, 05:20 UTC), which — verified
--         against its LIVE definition 2026-07-18 (md5 e9509379c84906d242aa2757363a0f93) —
--         recovers a row ONLY when  last_seen_at >= now() - 24h  AND price is sane
--         (price_total ≤ 1e9, price_per_meter ≤ 3e5, price_annual ≤ 1e8).  dealapp IS inside
--         that function's loop: its exclusion is  tablename NOT LIKE 'deal\_%'  (literal
--         underscore), which does NOT match 'dealapp_' (confirmed live: the LIKE test is false).
--   These rows' last_seen_at is mostly 7–18 days old, so auto_recover leaves them inactive; the
--   genuinely-live ones return organically the moment the crawler re-sees them (which is the
--   intended, correct behaviour), and the genuinely-gone ones are never re-seen and stay
--   inactive with a stale last_seen_at.  The unlock only REMOVES a permanent recovery-lock
--   (mc=3 == the 3-strike prune threshold) that should never have been applied to a non-sold
--   cohort; it restores these rows to the ordinary "false-inactive, mc=0" lifecycle.
--
-- ══ WHAT IS DELIBERATELY NOT TOUCHED ═══════════════════════════════════════════════════════
--   • dealapp_commercial_listings (5 rows) and aqaratikom_commercial_listings (3 rows) from B4:
--     NOT in scope (residential table only).  Their sold/pin status is a separate decision.
--   • The 943-row 04:00 mark_stale cohort: already healed by
--     20260717_stale_coverage_gate_dealapp_heal.sql; disjoint from this scope (mc=0 already).
--   • gathern / wasalt / aqar and every other platform: not referenced; zero rows modified.
--
-- ══ RESET SEMANTICS ════════════════════════════════════════════════════════════════════════
--   missing_count 3 → 0.  active, last_seen_at, deactivated_at all UNTOUCHED.
--
-- ══ ROLLBACK ═══════════════════════════════════════════════════════════════════════════════
--   Restore per-row missing_count from the backup, then (after owner review) drop the backup:
--     update public.dealapp_residential_listings d
--        set missing_count = b.missing_count_old
--       from public.ops_dealapp_1427_unlock_backup_20260717 b
--      where b.id = d.id;
--     -- drop table public.ops_dealapp_1427_unlock_backup_20260717;  (only after owner review)
--
-- ══ REHEARSAL ══════════════════════════════════════════════════════════════════════════════
--   Rehearsed end-to-end in BEGIN..ROLLBACK against live prod 2026-07-18; results recorded at
--   the bottom of this file.  Prod re-verified byte-identical afterwards (907 rows still mc=3,
--   backup table absent, auto_recover md5 unchanged).
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.ops_dealapp_1427_unlock_backup_20260717 (
  id                 bigint      primary key,
  ad_number          text,
  active             boolean,
  missing_count_old  integer,
  last_seen_at       timestamptz,
  deactivated_at     timestamptz,
  unlocked_at        timestamptz not null default now()
);
alter table public.ops_dealapp_1427_unlock_backup_20260717 enable row level security;
revoke all on public.ops_dealapp_1427_unlock_backup_20260717 from anon, authenticated;

do $unlock$
declare
  v_tbl constant text := 'dealapp_residential_listings';
  scope int; backed int; updated int;
begin
  -- deterministic scope predicate — identical for count / backup / update
  select count(*) into scope
    from public.dealapp_residential_listings
   where active = false and missing_count = 3;

  if scope <> 907 then
    raise notice 'dealapp-1427-unlock NOTE: scope drifted from the 907 rows measured 2026-07-18 '
                 '(now % rows); the predicate governs and the hard-fail still protects the write', scope;
  end if;

  insert into public.ops_dealapp_1427_unlock_backup_20260717
         (id, ad_number, active, missing_count_old, last_seen_at, deactivated_at)
  select id, ad_number, active, missing_count, last_seen_at, deactivated_at
    from public.dealapp_residential_listings
   where active = false and missing_count = 3;
  get diagnostics backed = row_count;

  update public.dealapp_residential_listings
     set missing_count = 0
   where active = false and missing_count = 3;
  get diagnostics updated = row_count;

  if scope <> backed or scope <> updated then
    raise exception 'dealapp-1427-unlock scope mismatch on %: scope=% backed=% updated=%',
      v_tbl, scope, backed, updated;
  end if;

  raise notice 'dealapp-1427-unlock %: % row(s) reset missing_count 3 -> 0 (active untouched; backup rows=%)',
    v_tbl, updated, backed;
end $unlock$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- REHEARSAL RESULTS — BEGIN..ROLLBACK against live prod 2026-07-18.
-- The whole migration above was applied verbatim inside the transaction, then the REAL nightly
-- heal public.auto_recover_false_inactive() (jobid 30) was invoked, then ROLLBACK.
--
--   UNLOCK LANDS (hard-fail passed: scope == backup == updated):
--     backup rows ......................................... 907
--     dealapp_residential active=false/mc=3 remaining ..... 0     (all 907 reset mc 3 -> 0)
--
--   RESURRECTS NOTHING ON ITS OWN (real heal over the UNTOUCHED cohort):
--     natural in-window (last_seen>=now-24h & sane price) . 0     -> auto_recover would flip 0
--     natural stale (last_seen < now-24h) ................. 906   -> permanently ineligible today
--       (907 - 906 = 1 row is <24h by last_seen but fails the price guard, so also ineligible)
--
--   IN-WINDOW ROW RECOVERS, STALE ROW DOES NOT (the two required proofs):
--     demo in-window row id 1291551 — last_seen set to now() to simulate the crawler re-seeing
--       a genuinely-live listing (sane price) -> active AFTER heal = TRUE   (recovered)
--     demo stale row DA504241 id 1206571 (last_seen 2026-06-29) -> active AFTER heal = FALSE
--       (left inactive)
--     auto_recover_false_inactive() recovered dealapp total = 1 (ONLY the simulated re-seen row)
--     cohort still inactive after heal .................... 906
--
--   PROD BYTE-IDENTICAL AFTER ROLLBACK (pre == post):
--     active=false/mc=3 count ............ 907 == 907
--     active-row count ................... 2537 == 2537 ; grand total 4387 == 4387
--     cohort fingerprint (md5 over id|active|missing_count|last_seen|deactivated) ..............
--                                          734ce9a06993b3671878ad74380b9fd4 (unchanged)
--     ops_dealapp_1427_unlock_backup_20260717 absent again ...... yes
--     auto_recover_false_inactive md5 e9509379c84906d242aa2757363a0f93 (unchanged)
-- ─────────────────────────────────────────────────────────────────────────────────────────
