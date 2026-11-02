-- DRAFT — NOT APPLIED. Needs the owner's yes (bulk field rewrite, docs/ops/AGENT_AUTHORITY.md RED 4; alert 2958 says ask).
-- When approved: apply with apply_migration, then rename this file to the version it mints (do not cite this one).
--
-- Alert 2958 fabricated_unpublished_amenity:aqar (P1, open since 2026-09-14). aqar publishes maid / driver
-- only on the VILLA form. 262 non-Villa aqar_residential_listings rows still hold a value (maid true 81, false 181;
-- driver true 38, false 211), first scraped 2026-06-18..10-22 by an older writer. Today's parser writes them only
-- from aqar's own key (enrich_residential._amenities) and cannot clear them, because an absent key yields None
-- and the upsert drops a None.
-- Re-read on production 2026-11-02 (source-reread run 41421593407): control Villa 23205033 shows «غرفة خادمة=True».
-- Floor 19712039 (stored maid+driver true) and Apartment 16198282 (stored maid true) show neither among aqar's
-- structured props. Silence is NULL, never yes or no (ADVANCED_FILTER_SOURCE_TRUTH.md).
-- Blast radius: exactly these 262 rows and these two columns. Rollback: none needed; the next crawl writes any value
-- aqar starts publishing.
update aqar_residential_listings
   set maid_room = null, driver_room = null
 where property_type <> 'Villa'
   and (maid_room is not null or driver_room is not null);
