-- Backfill elevator/parking/driver_room for existing gathern_residential_listings rows from their
-- own declared additional_info.amenities text (found live 2026-07-26, round-6 filter/backend audit):
-- map_listing() never set these 7 boolean columns at all, so Postgres' column_default=false applied
-- unconditionally to all 27,510 rows — contradicting listings whose own amenities array explicitly
-- declares them (e.g. GTH259901/id=1282953 has "مصعد"+"موقف سيارة" in additional_info.amenities yet
-- elevator=parking=false). scrapers/gathern/run.py's new _amenity_flags() covers all FUTURE scrapes;
-- this is the one-time backfill for rows already ingested.
--
-- Scoped to EXACTLY the 3 confidently-mapped labels (مصعد/موقف سيارة/غرفة سائقين) -- live-verified
-- against every distinct amenity label Gathern actually publishes (2026-07-26). The other 4 columns
-- (kitchen/air_conditioner/maid_room/private_entrance) have NO corresponding label in the real data
-- at all and are intentionally left untouched rather than guessed -- in particular "دخول ذاتي" (self
-- check-in) is a different concept from private_entrance (a physically separate entrance) and must
-- never be conflated with it.
--
-- Dry-run counts confirmed before applying: would_set_elevator=14779, would_set_parking=8226,
-- would_set_driver_room=130, total_rows=27510. Post-apply verification matched exactly, with 0
-- unintended changes to kitchen/air_conditioner/maid_room/private_entrance.

update gathern_residential_listings
set elevator = true
where elevator is distinct from true
  and additional_info -> 'amenities' @> '["مصعد"]'::jsonb;

update gathern_residential_listings
set parking = true
where parking is distinct from true
  and additional_info -> 'amenities' @> '["موقف سيارة"]'::jsonb;

update gathern_residential_listings
set driver_room = true
where driver_room is distinct from true
  and additional_info -> 'amenities' @> '["غرفة سائقين"]'::jsonb;
