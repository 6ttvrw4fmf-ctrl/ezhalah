-- af_field_stuck_no_variance / sanadak driver_room — ADJUDICATED AGAINST LIVE SOURCE, 2026-08-23.
--
-- The detector flagged (sanadak, driver_room, إيجار/سنوي/شقة) at 0 true / 191 false while a peer
-- platform in the same segment showed variance. Per the detector's own instruction ("adjudicate
-- against the source and either fix the parser or acknowledge in ops_amenity_capture_verified"),
-- and per the 2026-08-13 standing rule that a waiver must prove BOTH directions rather than silence
-- the barrier, this was probed live rather than reasoned about:
--
--   * 4/4 live sanadak pages fetched today carry `"isDriverRoomAvailable": false` as an EXPLICIT
--     boolean in the page payload — including أرض (land) listings, where sanadak still emits the
--     key. Our stored FALSE is the source's own published answer, not a manufactured negative, so
--     the tri-state law is intact and there is no parser defect to fix.
--   * The other direction holds too: the field is NOT stuck platform-wide. Across sanadak's 983
--     indexed rows driver_room is 32 true / 951 false, so the capture demonstrably records TRUE
--     when sanadak publishes it. Only this one cohort segment is single-valued.
--   * Corroborates the 2026-08-10 platform-mapping audit already in git
--     (20260810182406_af_platform_mapping_seed_from_audit.sql): sanadak driver_room maps to
--     `isDriverRoomAvailable`, noted there as "184/184 explicit FALSE - a source-published NO,
--     not silence".
--
-- Scope is deliberately the ONE adjudicated segment — not rent_period_key '*', not other fields,
-- not other platforms. Anything else this detector raises still raises.
insert into public.ops_amenity_capture_verified
  (source_table, field, deal_ar, rent_period_key, type_ar, note, verified_at)
select 'sanadak_residential_listings', 'driver_room', 'إيجار', 'سنوي', 'شقة',
       'Source-published negative, verified live 2026-08-23: 4/4 sanadak pages carry an explicit '
    || '"isDriverRoomAvailable": false (land listings included). Two-sided platform-wide (32 true / '
    || '951 false over 983 indexed rows), so the capture does record TRUE when sanadak publishes it. '
    || 'Corroborates the 2026-08-10 mapping audit (184/184 explicit FALSE). Not a parser defect.',
       now()
where not exists (
  select 1 from public.ops_amenity_capture_verified w
  where w.source_table = 'sanadak_residential_listings' and w.field = 'driver_room'
    and w.deal_ar = 'إيجار' and w.rent_period_key = 'سنوي' and w.type_ar = 'شقة'
);
