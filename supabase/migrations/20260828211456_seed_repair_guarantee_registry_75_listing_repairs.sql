-- Seed public.ops_repair_guarantee_registry — the orphaned-guarantee registry's first population.
--
-- The table and its detector (mon_detect_repair_guarantee_stale) landed in 20260828164221 EMPTY, and
-- an empty registry is a rotation that reaches nothing: every past repair was invisible to it. This
-- migration registers the 75 repairs that actually changed LISTING rows at migration time.
--
-- WHAT COUNTS (the spec's discriminator, PART 1 of docs/ops/SYSTEMS_SEAM_ENGINEER.md): did rows that
-- already existed change meaning, and would it be wrong if they drifted back? That is deliberately
-- the same line scripts/verify-repair-migrations-are-guarded.ts draws — an UPDATE/DELETE executed at
-- migration time against a listing table, as opposed to one merely defined inside a function body.
-- Config/registry/cron writes are excluded: a config row stays where you put it, but a repaired
-- LISTING row is overwritten by the next scrape, which is exactly the decay mechanism this watches.
--
-- repair_version is the repo migration file's numeric prefix. Three legacy (pre-strict-era) files
-- carry a date-only prefix that collides, so those get a -2/-3 discriminator; the primary key is
-- repair_version alone. Fourteen of these legacy files were applied outside the tracked migration
-- system and have no supabase_migrations.schema_migrations row at all — they are grandfathered by
-- the drift guard's baseline and are registered here by their repo filename.
--
-- DETECTOR ASSIGNMENT IS DELIBERATELY CONSERVATIVE. A detector is named only where it genuinely
-- watches THAT invariant. 38 of these 75 get NULL, which makes mon_detect_repair_guarantee_stale
-- raise repair_guarantee_unwatched naming them — that is the correct, intended outcome, not noise:
-- it is the orphaned-guarantee backlog becoming visible for the first time. Do NOT clear it by
-- deleting rows or by pointing them at a detector that does not actually cover the invariant; that
-- would make the registry lie and silence the exact alert it exists to raise.

insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by)
select v.repair_version, v.repair_name, v.invariant, v.detector, 'systems-seam-engineer-run1'
from (values
  ('20260714', 'backup_and_deactivate_alnokhba', 'The 5 alnokhba rows (638603-638607) retired on 2026-07-14 stay inactive; the retired platform must not resurrect them.', null),
  ('20260714-2', 'deactivate_toor_active_rows', 'The 23 toor rows deactivated on 2026-07-14 stay inactive.', null),
  ('20260716', 'batch2_search_truth', 'search_listings_ar carries only rows the canonical layer says are searchable (Batch 2 search-truth reconciliation).', null),
  ('20260717', 'aqar_property_age_backfill_from_capture', 'aqar property_age reflects the value in source_capture, never a derived or invented age.', null),
  ('20260717-2', 'dealapp_1427_unlock', 'The 907 dealapp rows falsely locked at missing_count=3 stay unlocked and are not re-deactivated without evidence.', 'mon_detect_unverified_inactivation'),
  ('20260717-3', 'stale_coverage_gate_dealapp_heal', 'dealapp rows healed by the stale-coverage gate stay inside the gate''s coverage floor.', null),
  ('20260720171946', 'remove_al_ahsa_city_cluster_enforce_strict_city_match', 'City matching is strict: the Al-Ahsa cluster alias never re-appears and no listing is served under a city it does not belong to.', null),
  ('20260720172500', 'remove_al_ahsa_city_cluster_enforce_strict', 'Strict city match holds in the served index after the Al-Ahsa cluster removal.', null),
  ('20260721104637', 'backfill_aqarmonthly_district_city_suffix', 'An aqarmonthly district_ar never carries the city name glued onto its end (the delimiter-less source slug).', 'mon_detect_aqarmonthly_district_city_suffix'),
  ('20260724134922', 'fix_11_mistagged_taif_rows_labeled_makkah_city_id', 'The 11 Taif rows mistagged with Makkah''s city_id stay under Taif.', null),
  ('20260726120000', 'aqar_stop_deriving_price_per_meter', 'aqar price_per_meter is only ever the source''s published value, never derived by Ezhalah.', 'mon_detect_price_fidelity'),
  ('20260726181501', 'backfill_gathern_amenity_flags_from_declared_amenities', 'gathern amenity flags match the platform''s declared amenity list; none are invented.', null),
  ('20260727130500', 'type_ar_canonicalization_dedup_and_deal_word_purge', 'type_ar in the served index is canonical: no duplicates and no deal words leaking into the type label.', null),
  ('20260727153645', 'mustqr_clear_derived_price_per_meter', 'mustqr price_per_meter stays NULL unless the source publishes it.', null),
  ('20260728140000', 'type_label_compound_and_annual_rent_strictness', 'Compound type labels and annual-rent strictness hold in the served index.', null),
  ('20260728190000', 'awal_inactivate_link_rot', 'awal rows whose source URLs rotted stay inactive.', null),
  ('20260728210000', 'aqar_null_licence_number_prices', 'An aqar licence number is never stored as a price.', null),
  ('20260729132000', 'dealapp_backfill_concatenated_area', 'dealapp area values are the parsed number, not the source''s concatenated area string.', null),
  ('20260729180000', 'aqar_licence_price_72_range_and_invariant', 'The 72 aqar rows whose price was a licence number keep their repaired price and the licence-band invariant holds.', null),
  ('20260729200000', 'aqar_licence_price_frozen_band', 'No aqar price falls inside the frozen licence-number band.', null),
  ('20260803112311', 'p1_interim_gate_buy_token_price', 'Buy rows never carry a token price through the interim search gate.', null),
  ('20260803160000', 'reactivate_unverified_mark_stale_kills', 'Listings inactivated without verification stay reactivated; unverified kills are marked stale instead.', 'mon_detect_unverified_inactivation'),
  ('20260803171500', 'aldarim_raw_year_property_age_backfill_gate', 'aldarim property_age comes from the source''s raw year, gated - never guessed.', null),
  ('20260803190905', 'price_display_fidelity_repair_33_rows', 'The 33 small-platform rows whose displayed price contradicted source keep the source-true price.', null),
  ('20260804120000', 'price_size_sanity_safety_check', 'No listing carries an impossible price-for-size combination.', 'mon_detect_impossible_price_size'),
  ('20260804125500', 'dealapp_backfill_city_fallback_ar_129_rows', 'The 129 dealapp rows backfilled with an Arabic city fallback keep a city label.', null),
  ('20260804164830', 'location_followup_backfill_eaqartabuk_alkhaas_erapulse_raghdan_smallplatforms', 'Small-platform rows backfilled with source-verified locations keep them.', null),
  ('20260804184833', 'repair_55_truncated_and_ppm_as_total_prices', 'The 55 rows whose price was truncated or held price-per-metre as the total keep the source total.', 'mon_detect_price_eq_area_or_ppm'),
  ('20260804192611', 'repair_72_understated_prices_backfill_sweep', 'The 72 understated prices stay at their source-corroborated value.', null),
  ('20260804193711', 'wasalt_price_corroboration_repair_from_evidence', 'wasalt prices repaired from corroborating evidence stay repaired.', null),
  ('20260805004030', 'retire_buy_token_price_production_ready_fold', 'The buy-token-price interim gate stays retired and buy prices are real.', null),
  ('20260805190224', 'sync_stop_fabricating_furnished_for_gathern_aqarmonthly', 'The sync never fabricates a furnished flag for gathern/aqarmonthly rows.', null),
  ('20260806063329', 'wasalt_price_total_never_holds_the_per_metre_rate', 'A wasalt total price is never the per-metre rate.', 'mon_detect_price_eq_area_or_ppm'),
  ('20260809113302', 'aqar_ppm_source_truth_repair_and_searchable_price_per_meter', 'aqar price_per_meter is source truth and is what search filters on.', 'mon_detect_price_fidelity'),
  ('20260809113548', 'aqar_ppm_repair_followup_no_capture_rows', 'aqar rows with no source capture carry no derived price_per_meter.', 'mon_detect_price_fidelity'),
  ('20260809115657', 'raghdan_location_backfill_from_live_source_20260809', 'raghdan locations backfilled from the live source stay as captured.', null),
  ('20260809120654', 'souq24_monthly_price_x12_storage_repair_3_rows', 'The 3 souq24 rows whose monthly price was stored x12 keep the source monthly value.', null),
  ('20260809120804', 'raghdan_rest_house_type_price_repair_and_district_bridge_20260809', 'raghdan rest-house type and price stay source-true and the district bridge holds.', null),
  ('20260809121715', 'null_source_token_buy_prices_durable', 'A buy price that was a source token stays NULL rather than a fabricated number.', 'mon_detect_price_blanked_without_authority'),
  ('20260809122716', 'restore_sub1000_raw_prices_from_prenull_snapshot_20260809', 'Sub-1000 raw prices restored from the pre-null snapshot stay restored.', null),
  ('20260809131049', 'aqar_clear_prose_fabricated_amenities_20260809', 'aqar residential amenity flags are never set from prose in the description.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260809131500', 'aqar_commercial_clear_prose_fabricated_amenities_20260809', 'aqar commercial amenity flags are never set from prose in the description.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260809132539', 'aqar_clear_prose_utility_and_legacy_false_amenities_20260809', 'aqar utility/legacy amenity flags carry no prose-derived or legacy false positives.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260809134500', 'aqar_clear_prose_utility_and_legacy_false_amenities', 'The re-run of the aqar prose-amenity clearance holds.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260809151000', 'wasalt_meters_repaired_from_source', 'wasalt area in metres matches the source.', null),
  ('20260810185359', 'buy_rows_must_not_carry_a_zero_annual_rent', 'A buy row never carries a zero annual rent.', null),
  ('20260810191342', 'retract_aqar_areas_that_are_actually_the_asking_price', 'An aqar area value is never the asking price.', 'mon_detect_price_eq_area_or_ppm'),
  ('20260810195301', 'retract_aqar_commercial_area_and_extend_fidelity_barrier', 'An aqar commercial area value is never the asking price.', 'mon_detect_price_eq_area_or_ppm'),
  ('20260810202219', 'price_area_artifact_fix_repair_and_barrier', 'Price never equals area and never equals price-per-metre, fleetwide.', 'mon_detect_price_eq_area_or_ppm'),
  ('20260811064231', 'aqar_parse_labeled_total_beats_subfloor_pick', 'When aqar publishes a labelled total, that total wins over a sub-floor pick.', null),
  ('20260811065654', 'aqar_reject_price_artifact_writes_at_write_path', 'The write path rejects aqar price artifacts, so they never re-enter.', 'mon_detect_price_eq_area_or_ppm'),
  ('20260811075018', 'eastabha_commercial_villa_on_roof_retraction', 'The eastabha commercial villa-on-roof mislabel stays retracted.', null),
  ('20260811075455', 'aldarim_retract_ac_flag_only_where_source_is_null', 'An aldarim AC flag is only set where the source publishes it.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260811095528', 'wasalt_clear_manufactured_amenity_negatives', 'wasalt amenity negatives are never manufactured; unknown stays unknown.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260811095857', 'aldarim_tristate_flags_and_source_published_negative_allowlist', 'aldarim flags stay tri-state; a negative is only stored when the source publishes one.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260811123957', 'aqar_area_comma_truncation_repair_and_field_integrity_precision', 'aqar areas are not comma-truncated and field-integrity precision holds.', 'mon_detect_field_integrity'),
  ('20260811133115', 'rent_period_source_truth_retractions', 'A rent period contradicting the source stays retracted.', 'mon_detect_rent_period_contradicts_capture'),
  ('20260811133417', 'rent_period_repair_index_sync', 'The rent-period repair is durable through the matview/sync path, not just in the index leg.', null),
  ('20260813064209', 'aqaratikom_rent_period_contradicts_own_capture_repair_and_barrier', 'No aqaratikom rent period contradicts that row''s own source capture.', 'mon_detect_rent_period_contradicts_capture'),
  ('20260813064929', 'wasalt_4334897_rent_period_price_restore_from_source_rentfreq', 'wasalt 4334897 keeps the rent period and price its source rentFreq publishes.', 'mon_detect_rent_period_contradicts_capture'),
  ('20260813112916', 'aqaratikom_13_rows_source_probed_annual_and_evidence_gated_source_limitation_registry', 'The 13 probed aqaratikom rows keep the annual period the source published, and every source-limitation waiver stays FK-gated to a real probe.', 'mon_detect_source_limited_contradicted'),
  ('20260815063640', 'senior_run21_price_source_verified_and_aqar_ppm_copy_repair', 'Source-verified prices and the aqar price-per-metre copy repair hold.', 'mon_detect_price_fidelity'),
  ('20260815072254', 'aqar_rent_period_probed_verdict_repair_and_rent_period_text_barrier', 'aqar rent periods match their probed verdict.', 'mon_detect_rent_period_contradicts_probe'),
  ('20260815072559', 'fix_rent_period_contradicts_probe_resolve_key_signature', 'The rent-period probe contradiction detector can actually resolve its own key.', 'mon_detect_rent_period_contradicts_probe'),
  ('20260817225546', 'retract_dealapp_misclassified_residential_duplicates', 'Misclassified dealapp residential duplicates stay retracted.', null),
  ('20260820205258', 'aqar_commercial_amenity_source_probe_and_defabrication', 'aqar commercial amenities match the probed source; fabrications stay cleared.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260821224203', 'retract_road_name_city_aqarcity_4573610', 'aqarcity 4573610 does not carry a road name in its city field.', null),
  ('20260822063503', 'retract_unpublished_price_aqar_6686450', 'aqar 6686450 carries no price the source never published.', 'mon_detect_price_blanked_without_authority'),
  ('20260822072730', 'restore_four_source_live_gathern_listings', 'The 4 gathern listings confirmed live at source stay active.', null),
  ('20260822124954', 'authoritative_null_price_backfill_225_aqar_rows', 'The 225 aqar rows whose price was authoritatively nulled stay null.', 'mon_detect_price_blanked_without_authority'),
  ('20260822125152', 'barrier_a_price_may_only_go_null_with_authority', 'A price only ever goes NULL with recorded authority.', 'mon_detect_price_blanked_without_authority'),
  ('20260823145919', 'aqarmonthly_district_suffix_canonical_guard', 'The canonical aqarmonthly district rule holds in raw AND in the served index.', 'mon_detect_aqarmonthly_district_city_suffix'),
  ('20260824114314', 'defabricate_probed_aqar_non_villa_maid_driver', 'Probed non-villa aqar rows carry no maid/driver room the source never published.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260824115704', 'defabrication_reruns_its_watching_detector', 'The defabrication is idempotent and re-runs its own watching detector.', 'mon_detect_fabricated_unpublished_amenity'),
  ('20260824130918', 'defabricate_aqar_non_villa_maid_driver_owner_authorized', 'The owner-authorised aqar maid/driver defabrication holds.', 'mon_detect_fabricated_unpublished_amenity')
) as v(repair_version, repair_name, invariant, detector)
on conflict (repair_version) do nothing;
