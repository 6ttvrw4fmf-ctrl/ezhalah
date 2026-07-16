-- =============================================================================================
-- Stale-deal search-index repair — 2026-07-16 (branch fix/null-deal-recovery)
-- =============================================================================================
-- DO NOT EXECUTE AGAINST PRODUCTION WITHOUT OWNER SIGN-OFF. Prepared, reviewed artifact only
-- (Approval-workflow-rule: recommend, then WAIT). Deploy lock required for any apply.
--
-- CONTEXT — the null-deal recovery investigation (2026-07-16) found:
--   • The ~1,300 rows Batch 2 quarantined (NULL transaction_type seen through
--     listing_native_location_v2) are ALREADY recovered: every platform's regular 2026-07-16
--     early crawl re-upserted them with a valid Buy/Rent (write-evidence: raw_captured_at),
--     and the hourly sync re-admitted them. Live: active total = index total = 185,627,
--     0 active rows missing from search, 0 NULL/blank transaction_type in any of the 70
--     *_listings tables (active or inactive). Nothing left to recover from that population.
--   • What remains are 57 index rows whose deal_ar contradicts their own live base row —
--     all 57 with per-row source proof, 0 without proof:
--       dealapp_residential 54 · dealapp_commercial 1 · aqar_residential 1  → indexed 'إيجار'
--         while base transaction_type='Buy' and the source title literally says 'للبيع'
--         (pre-Batch-2 fabricated-Rent survivors: the old sync CASE had `else 'إيجار'`, and
--         deal drift is not a re-select trigger, so they were never re-touched);
--       abeea_residential 1 (id 638798) → indexed 'إيجار', base='Buy', listing_url
--         '…/villa-for-sale-in-al-shaati-al-gharbi-district/'; here the stale
--         listing_location_canonical.purpose='rent' SHADOWS the live base row through
--         listing_native_location_v2's COALESCE(v1, a) ordering.
--
-- PREFERRED PATH (self-healing, no manual UPDATE):
--   apply supabase/migrations/20260717_deal_truth_recovery.sql and run one sync
--   (`select * from sync_search_listings_ar();`) under the deploy lock. Rehearsed 2026-07-16
--   in BEGIN..ROLLBACK against live prod: mismatches 57 → 0, abeea 638798 → 'بيع', index
--   total unchanged (185,627), zero deletions. This file is the NO-DEPLOY fallback for the
--   56 fabricated-Rent rows only, plus the shared backup step.
--
-- ── STEP 0 · BACKUP-FIRST (permanent repair standard) — run in EITHER path ──
create table if not exists public.ops_stale_deal_backup_20260716 as
select s.source_table,
       s.listing_id,
       s.deal_ar  as old_deal_ar,
       a.transaction_type as base_transaction_type_verbatim,
       case when lower(a.transaction_type)='buy'  then 'بيع'
            when lower(a.transaction_type)='rent' then 'إيجار' end as new_deal_ar,
       coalesce(d1.listing_url, d2.listing_url, d3.listing_url, d4.listing_url) as listing_url_evidence,
       left(coalesce(d1.title, d2.title, d3.title, d4.title), 160)              as title_evidence,
       now() as backed_up_at
from public.search_listings_ar s
join public.active_listing_ids_v2 a
  on a.source_table = s.source_table and a.listing_id = s.listing_id
left join public.dealapp_residential_listings d1
  on s.source_table = 'dealapp_residential_listings' and d1.id = s.listing_id
left join public.dealapp_commercial_listings d2
  on s.source_table = 'dealapp_commercial_listings'  and d2.id = s.listing_id
left join public.aqar_residential_listings d3
  on s.source_table = 'aqar_residential_listings'    and d3.id = s.listing_id
left join public.abeea_residential_listings d4
  on s.source_table = 'abeea_residential_listings'   and d4.id = s.listing_id
where s.deal_ar is distinct from
      (case when lower(a.transaction_type)='buy'  then 'بيع'
            when lower(a.transaction_type)='rent' then 'إيجار' end);

-- Sanity: expect 57 rows, every one with listing_url_evidence populated.
-- select count(*), count(listing_url_evidence) from ops_stale_deal_backup_20260716;

-- ── STEP 1 · PRE-CHECK (mandatory) — the exact-id batches below were derived live
--    2026-07-16 ~19:30 UTC. If this returns anything OUTSIDE the 57 backed-up keys, STOP:
--    re-derive the set and re-stage; do not run stale batches.
-- select s.source_table, s.listing_id
-- from search_listings_ar s
-- join active_listing_ids_v2 a on a.source_table=s.source_table and a.listing_id=s.listing_id
-- where s.deal_ar is distinct from (case when lower(a.transaction_type)='buy' then 'بيع'
--                                        when lower(a.transaction_type)='rent' then 'إيجار' end)
-- except select source_table, listing_id from ops_stale_deal_backup_20260716;
--
-- ── STEP 2 · MANUAL RELABEL — exact ids, batches ≤ 25, derived-index only (search_listings_ar).
--    Raw platform tables are NOT touched (aggregator-fidelity). Each UPDATE recomputes the
--    row from its own live base value (no blind constant), and clears rent_period_ar when
--    the true deal is Buy (a Buy row cannot carry a rent period).
--    SAFE WITHOUT THE MIGRATION for the 56 dealapp/aqar rows: v2 already serves 'Buy' for
--    them, so a later sync re-select can only re-write the same correct value.
--
-- Batch 1/3 — dealapp_residential_listings (25 rows)
-- update search_listings_ar s
--    set deal_ar = 'بيع', rent_period_ar = null
--  where s.source_table = 'dealapp_residential_listings'
--    and s.deal_ar = 'إيجار'
--    and s.listing_id in (1125946,1274896,1280079,1284728,1291537,1291743,1291744,1291822,
--                         1291890,1291893,2037051,2037084,2037085,2037483,2037484,2037488,
--                         2037527,2037541,2037552,2044930,2044944,2044945,2044946,2044949,2044950)
--    and exists (select 1 from dealapp_residential_listings d
--                where d.id = s.listing_id and d.transaction_type = 'Buy');
--
-- Batch 2/3 — dealapp_residential_listings (25 rows)
-- update search_listings_ar s
--    set deal_ar = 'بيع', rent_period_ar = null
--  where s.source_table = 'dealapp_residential_listings'
--    and s.deal_ar = 'إيجار'
--    and s.listing_id in (2044951,2044952,2044953,2044954,2044955,2044956,2044957,2044959,
--                         2044960,2046818,2046876,2046884,2046896,2046897,2046911,2046943,
--                         2046944,2046947,2046948,2046949,2046951,2046959,2046962,2046963,2046964)
--    and exists (select 1 from dealapp_residential_listings d
--                where d.id = s.listing_id and d.transaction_type = 'Buy');
--
-- Batch 3/3 — dealapp_residential remainder (4) + dealapp_commercial (1) + aqar_residential (1)
-- update search_listings_ar s
--    set deal_ar = 'بيع', rent_period_ar = null
--  where s.source_table = 'dealapp_residential_listings'
--    and s.deal_ar = 'إيجار'
--    and s.listing_id in (2046967,2046969,2046970,2046971)
--    and exists (select 1 from dealapp_residential_listings d
--                where d.id = s.listing_id and d.transaction_type = 'Buy');
-- update search_listings_ar s
--    set deal_ar = 'بيع', rent_period_ar = null
--  where s.source_table = 'dealapp_commercial_listings'
--    and s.deal_ar = 'إيجار' and s.listing_id = 694723
--    and exists (select 1 from dealapp_commercial_listings d
--                where d.id = s.listing_id and d.transaction_type = 'Buy');
-- update search_listings_ar s
--    set deal_ar = 'بيع', rent_period_ar = null
--  where s.source_table = 'aqar_residential_listings'
--    and s.deal_ar = 'إيجار' and s.listing_id = 43228
--    and exists (select 1 from aqar_residential_listings d
--                where d.id = s.listing_id and d.transaction_type = 'Buy');
--
-- ── abeea 638798: DO NOT manually relabel without the migration ──
--    listing_native_location_v2 still serves 'Rent' for it (stale llc.purpose shadows the
--    live base row), so any sync re-select would REVERT a manual 'بيع' back to 'إيجار'.
--    It is only durably fixable by the [DEAL-SRC] view fix in
--    supabase/migrations/20260717_deal_truth_recovery.sql (rehearsed: relabels it in the
--    same sync run). Manual-path result is therefore 56 fixed + 1 pending the migration.
--
-- ── STEP 3 · VERIFY ──
-- select count(*) from search_listings_ar s
--   join active_listing_ids_v2 a on a.source_table=s.source_table and a.listing_id=s.listing_id
--  where s.deal_ar is distinct from (case when lower(a.transaction_type)='buy' then 'بيع'
--                                         when lower(a.transaction_type)='rent' then 'إيجار' end);
--   -- expect 0 after the migration path; expect 1 (abeea 638798) after the manual-only path
-- select count(*) from search_listings_ar;  -- expect unchanged (relabel only)
--
-- RE-ADMISSION NOTE: none of this touches eligibility — the 57 rows never left the index
-- (they were mislabeled, not quarantined). The originally-quarantined NULL-deal population
-- is already back via the normal hourly sync, since eligibility became true the moment the
-- early-2026-07-16 crawls restored their Buy/Rent. Rows left quarantined for lack of proof: 0.
-- =============================================================================================
