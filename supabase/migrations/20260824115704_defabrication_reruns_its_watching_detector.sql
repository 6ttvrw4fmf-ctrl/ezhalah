-- Companion to 20260824114314_defabricate_probed_aqar_non_villa_maid_driver.sql.
--
-- scripts/verify-repair-migrations-are-guarded.ts was right to fail that migration: a listing
-- repair must be WATCHED, and naming the detector only in a comment does not count. The repair
-- and the barrier that watches its class went in as two separate migrations, so the repair file
-- did not reach a detector in executed SQL.
--
-- The fix is the thing that should have shipped with the repair in the first place: re-run the
-- barrier that watches this exact class immediately after the write, so the open alert reflects
-- post-repair state rather than the state that motivated the repair. The UPDATE below is the same
-- statement 114314 already ran, re-asserted idempotently -- it is a no-op unless a later write
-- re-introduces a value on a row whose live source page we individually proved carries no key.
update public.aqar_residential_listings a
   set maid_room   = case when a.maid_room   is true then null else a.maid_room   end,
       driver_room = case when a.driver_room is true then null else a.driver_room end
 where a.id in (select listing_id from public.ops_amenity_defabrication_evidence
                 where source_table = 'aqar_residential_listings')
   and (a.maid_room is true or a.driver_room is true);

-- The detector that watches this class. It is EXPECTED to stay red: ~8,126 non-Villa assertions
-- remain, and clearing them in bulk is RED #4 (docs/ops/AGENT_AUTHORITY.md) pending owner approval.
-- Re-running it here is what makes the repair watched rather than fire-and-forget.
select public.mon_detect_fabricated_unpublished_amenity();
