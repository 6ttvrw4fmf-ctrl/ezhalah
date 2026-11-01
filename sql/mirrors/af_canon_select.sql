-- MIRROR of the `af_canon` projection injected into public.location_search_candidates_ar's template
-- by 20260903_af_canon_on_results_rpc (owner rule §12A / R13.12, 2026-09-03: "whatever the user
-- selected in Advanced Filter must be visibly and truthfully shown on the returned property card").
--
-- THIS FILE IS NOT EXECUTED. It is the repo-side copy of one expression that lives inside the
-- af_rpc_templates row, so scripts/verify-af-card-evidence.ts can hold the SQL and the TypeScript to
-- each other without a database:
--
--   * every canonical column src/lib/afEvidence.ts declares in a def's `reads` MUST appear in the
--     jsonb_build_object below — otherwise the card would ask af_canon for a column the RPC never
--     packed, and the null-guard would silently drop a chip the user earned;
--   * every field in AF_PREDICATE_FIELDS MUST have its RPC parameter in the GATE below — otherwise a
--     search narrowed by that answer alone would return af_canon NULL and the card would show
--     nothing for it. The gate is a SUPERSET on purpose: an extra param costs a little payload, a
--     missing one costs a missing chip.
--
-- THE GATE, AND WHY IT EXISTS. Measured on production 2026-09-03 over a 2,000-row sample: the packed
-- object averages 598 bytes (max 612). The results RPC serves a 1,500-row page-0 buffer, so packing
-- it unconditionally adds ~876 KB to EVERY search response — including the overwhelming majority
-- that carry no Advanced-Filter answer at all and render no «مطابق لطلبك» strip, where every one of
-- those bytes is waste on a mobile connection. Gated, a no-AF search pays nothing (af_canon is SQL
-- NULL, which the client already reads as "no evidence": `canon: c.af_canon ?? null`, and
-- afEvidence() returns [] for a null row). An AF-narrowed search pays it on a set the answer has
-- already shrunk — which is the whole point of the answer.
--
-- NULL-PRESERVING BY CONSTRUCTION. jsonb_build_object keeps a SQL NULL as a JSON null rather than
-- dropping the key, so all 70 keys (28 + the 39 group booleans + apartments_count/shops_count/majlis) are always present when the object is built. That is what lets
-- afEvidence's null-guard distinguish "the source did not publish this" (JSON null → render nothing)
-- from "the column is missing" (a bug). UNKNOWN stays UNKNOWN, end to end.
--
-- Refreshed 2026-09-03 (first capture, §12A card evidence). This mirror is the EXPRESSION the
-- migration injects, not a whole object, so its digest is of this file's own body — the text the
-- migration builds from `gate || obj || ' end'` and splices into the af_rpc_templates row for
-- location_search_candidates_ar. Verified against production by a full dry run of that migration on
-- 2026-09-03 (applied → all six smokes green → rolled back; 350 rows checked for 28 keys,
-- NULL-preservation and source-row identity, parity 0, gate holding).
-- md5 of the body below: 246f1b2d991fcc0c9fc4ba82b7defa4f   (2026-11-01 Apartments & Co-living pack, migration 20261101100930; before it: f80b807b6b13a59a40e8d6eb0ccdde88, the 2026-10-26 majlis pack)
-- Re-verify after the migration is applied under the deploy lock.
-- Amended 2026-10-03 (migration af_every_question_multi_select_unions, owner: «never force the user to
-- select one thing»): the gate gains p_age_buckets / p_rating_buckets / p_furnished_in, so a search
-- narrowed by a mixture alone still packs af_canon (dry run: 28 keys on a mixture-only search). In
-- production the gate is one line; the extra params are appended after p_is_new_construction.
case when (
       p_bath_min is not null
    or p_amenities is not null
    or p_furnished is not null
    or p_street_width_min is not null
    or p_directions is not null
    or p_rating_min is not null
    or p_reviews_min is not null
    or p_unit_subtypes is not null
    or p_age_min is not null
    or p_age_max is not null
    or p_is_new_construction is not null
    or p_age_buckets is not null
    or p_rating_buckets is not null
    or p_furnished_in is not null
  ) then jsonb_build_object(
    'bathrooms', s.bathrooms, 'property_age', s.property_age, 'furnished', s.furnished,
    'street_width_m', s.street_width_m, 'direction_ar', s.direction_ar, 'rating', s.rating,
    'reviews_count', s.reviews_count, 'unit_subtype_ar', s.unit_subtype_ar,
    'rent_now_pay_later', s.rent_now_pay_later, 'elevator', s.elevator, 'parking', s.parking,
    'kitchen', s.kitchen, 'air_conditioner', s.air_conditioner, 'maid_room', s.maid_room,
    'driver_room', s.driver_room, 'private_entrance', s.private_entrance,
    'car_entrance', s.car_entrance, 'sanitation', s.sanitation, 'electricity', s.electricity,
    'water_supply', s.water_supply, 'gym', s.gym, 'pool', s.pool, 'garden', s.garden,
    'balcony', s.balcony, 'laundry_room', s.laundry_room, 'optical_fibers', s.optical_fibers, 'majlis', s.majlis,
    'separate_electricity_meter', s.separate_electricity_meter,
    'separate_water_meter', s.separate_water_meter) || jsonb_build_object(
    -- Apartments & Co-living group (migration 20261101100930): a second jsonb_build_object joined with || because one
    -- call takes at most 100 arguments (the pack is now 70 pairs). The 39 text-fact booleans + the two counts the
    -- derived tokens read (separate_meters reads the two meter columns packed above).
    'roof', s.roof, 'two_entrances', s.two_entrances, 'annex', s.annex, 'yard', s.yard, 'garage', s.garage,
    'grill', s.grill, 'storage', s.storage, 'water_tank', s.water_tank, 'warranty', s.warranty, 'electronic_deed', s.electronic_deed,
    'basement', s.basement, 'self_checkin', s.self_checkin, 'wifi', s.wifi, 'bills_included', s.bills_included, 'jacuzzi', s.jacuzzi,
    'smart_tv', s.smart_tv, 'billiards', s.billiards, 'cleaning_service', s.cleaning_service, 'soundproof', s.soundproof, 'cameras', s.cameras,
    'guard', s.guard, 'smart_entry', s.smart_entry, 'smart_home', s.smart_home, 'central_gas', s.central_gas, 'sauna', s.sauna,
    'kids_play_area', s.kids_play_area, 'nursery', s.nursery, 'free_maintenance', s.free_maintenance, 'intercom', s.intercom, 'fire_system', s.fire_system,
    'ev_charger', s.ev_charger, 'central_vacuum', s.central_vacuum, 'insulation', s.insulation, 'dining_majlis', s.dining_majlis, 'own_bathroom', s.own_bathroom,
    'fridge', s.fridge, 'whole_floor', s.whole_floor, 'singles', s.singles, 'families', s.families,
    'apartments_count', s.apartments_count, 'shops_count', s.shops_count) end
