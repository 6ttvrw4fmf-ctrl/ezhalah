-- DRAFT (🔬 AF engineer 2026-10-09, backlog 296) — NOT APPLIED. Tomorrow: rolled-back dry run first, then
-- apply_migration, then mirror under supabase/migrations/ with the minted version (cite nothing else).
--
-- Gathern's unit page lists only the amenities a unit HAS and never prints a no (PR #6545,
-- ADVANCED_FILTER_SOURCE_TRUTH §2). Every stored FALSE in these four columns was manufactured by the old
-- _amenity_flags(). The crawl now writes AUTHORITATIVE_NULL, but units outside the monthly list feed are
-- touched only by liveness and keep the old FALSE (13:37 UTC sizing: 257 active rows — lift 95, parking 157,
-- driver 256, balcony 222). Guarded by mon_detect_af_tri_state_violations (alert 8860 is this defect).
-- Active rows only; inactive rows are not searchable and stay for a separate, batched pass.
update public.gathern_residential_listings
   set elevator        = case when elevator        is false then null else elevator        end,
       parking         = case when parking         is false then null else parking         end,
       driver_room     = case when driver_room     is false then null else driver_room     end,
       balcony_terrace = case when balcony_terrace is false then null else balcony_terrace end
 where active
   and (elevator is false or parking is false or driver_room is false or balcony_terrace is false);
-- Expected: 257 rows; then mon_detect_af_tri_state_violations() and the anon count of gathern elevator=false → 0.
