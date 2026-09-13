-- ops_adjudicated_listing could only see HALF of the adjudications it exists to protect.
--
-- The view is the guard two things consult before undoing a retirement:
--   · auto_recover_false_inactive() — "an adjudicated row … must never be auto-reactivated"
--   · mon_detect_lifecycle_duplicate_stale_copy() — "pairs whose inactive copy is recorded in
--     ops_adjudicated_listing are NOT counted here: those are decisions, not disagreements"
--
-- Its res/com-collision limb read ONE side:
--
--     select a.platform || '_residential_listings', a.res_id, …
--       from ops_res_com_collision_adjudication a where a.res_active_after is false
--
-- which was complete on the day it was written, because the 2026-08-30 repair retired the
-- residential side every time. The ledger has since gained `retired_side`, `com_active_before` and
-- `com_active_after` so either side can be retired, and on 2026-09-13 a repair retired the
-- COMMERCIAL side for six of seven rows. Measured the same day: for all six amaall rows
-- (com_id 10729213-10729218), `exists (select 1 from ops_adjudicated_listing where tbl =
-- 'amaall_commercial_listings' and listing_id = <id>)` is FALSE. The decision was recorded and the
-- guard could not see it.
--
-- This is the SAME half-migration that migration 20260913074036 repaired hours earlier in
-- mon_detect_res_com_collision_repair_regression(), which "only ever looked at the RESIDENTIAL side
-- … because the 2026-08-30 repair retired residential every time." The ledger was widened; its
-- readers were not, one at a time. This is the second reader.
--
-- WHAT IT COSTS TODAY, AND WHAT IT WOULD COST TOMORROW
--
-- 1. LIVE NOW: mon_detect_lifecycle_duplicate_stale_copy() cannot ever clear a commercial-side
--    repair. The amaall P2 raised at 07:59 on the day of the repair describes a "disagreement"
--    that is in fact a recorded decision, and no future run can retire it. A detector that cannot
--    be satisfied is the ratchet ops_incident #220 is already about.
--
-- 2. NOT live today, and only by luck: auto_recover_false_inactive() also carries the 2026-09-02
--    sibling-supersession clause — `not exists (select 1 from <sibling> s where s.ad_number =
--    t.ad_number and s.active)` — and all six amaall pairs share an ad_number with an ACTIVE
--    residential sibling, so that second guard binds and nothing was resurrected. But that clause
--    is deliberately "state-free and self-healing in both directions … when the sibling goes
--    inactive the clause stops binding on its own." The moment the sibling is retired too, the
--    adjudication guard is the ONLY thing left — and for a commercial-side adjudication it is
--    blind. mon_detect_adjudicated_reactivation(), which exists to prove that clause still holds,
--    is blind in exactly the same way, so the failure would be silent.
--
-- THE FIX IS SYMMETRY. The commercial limb is the residential limb with every name on its own side:
-- com_id, com_active_after, _commercial_listings. Nothing else changes, and the change can only ADD
-- rows to the adjudicated set — that is, it can only make the recovery job MORE reluctant to undo a
-- retirement, never less. `retired_side` is deliberately not used as the key: `*_active_after is
-- false` is the fact that matters (this side ended up retired), and a repair that retired both
-- sides would be covered on both.
create or replace view public.ops_adjudicated_listing as
 select r.source_table as tbl,
        r.listing_id,
        'adjudicated_retraction'::text as ledger,
        r.retracted_at as adjudicated_at
   from public.ops_adjudicated_retraction r
union
 select a.platform || '_residential_listings'::text as tbl,
        a.res_id as listing_id,
        'res_com_collision'::text as ledger,
        a.adjudicated_at
   from public.ops_res_com_collision_adjudication a
  where a.res_active_after is false
union
 select a.platform || '_commercial_listings'::text as tbl,
        a.com_id as listing_id,
        'res_com_collision'::text as ledger,
        a.adjudicated_at
   from public.ops_res_com_collision_adjudication a
  where a.com_active_after is false;
