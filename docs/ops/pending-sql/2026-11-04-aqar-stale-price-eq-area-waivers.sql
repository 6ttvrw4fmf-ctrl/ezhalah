-- 🔧 2026-11-04 — NEEDS A PERSON (the Supabase connector holds a DELETE for a confirmation nobody answers at night;
-- lessons 2026-10-06 / 10-10 / 10-23). Run in the SQL editor; expected: DELETE 3.
--
-- Three aqar price_eq_area waivers vouch for a price production no longer serves. Owner decision #4 (2026-11-04,
-- migration owner_decisions_4_5_9_aqar_rate_one_farm_area_wasalt_types, 09:40 UTC) ruled «سعر المتر 1» a placeholder
-- and NULLed price_total on 8982174 / 10222037 / 12069092 (ops_authoritative_null_price rows, reason 'owner decision
-- #4 (2026-11-04)…'). The waivers were proven on 08-22 / 09-06 / 09-19, before that decision, so they are superseded,
-- and mon_detect_price_eq_area_waiver_stale raises P2 13036 / 13037 / 13038 on every sweep («served price moved away
-- from the price the waiver was proven against»). The detector's own fix text for this case is to delete the waiver;
-- the decision row keeps the evidence, and the serving gate reads nothing from the waiver.
delete from public.ops_price_eq_area_verified v
 where v.source_table = 'aqar_residential_listings'
   and v.listing_id in (8982174, 10222037, 12069092)
   and exists (select 1 from public.ops_authoritative_null_price n
                where n.source_table = v.source_table and n.listing_id = v.listing_id
                  and n.reason like 'owner decision #4 (2026-11-04)%');
-- The three alerts close by their detector at the next :29 / :59 sweep. Mirror this file as a migration only if it is
-- applied through apply_migration; a SQL-editor run needs no mirror (it changes no schema and no function).
