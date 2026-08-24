-- OWNER-AUTHORIZED bulk de-fabrication, 2026-08-24.
--
-- Scope is exactly what mon_detect_fabricated_unpublished_amenity() identifies and no wider:
-- public.aqar_residential_listings, columns maid_room / driver_room, cohort
-- coalesce(property_type,'') <> 'Villa'. Owner instruction: do not broaden beyond what is
-- source-proven; preserve Villa, where aqar genuinely publishes these fields; never write false,
-- never write true; UNKNOWN stays UNKNOWN.
--
-- SOURCE PROOF, on the CORRECT metric. The first probe counted KEY PRESENCE; completing the
-- sample showed why that metric is not good enough, and the answer did not change:
--
--   90 non-Villa pages, all parsed, 0 fetch failures -> NOT ONE published a maid or driver VALUE
--     * apartment / floor / land / building / rest house / room (84 pages): key absent entirely
--     * House (6 pages): the key IS present on 6/6 -- and is `null` on 6/6. Key presence is not a
--       published value. This is the same shape already recorded for aqar_commercial `parking`
--       ("key appears on ~21% of pages but ALWAYS null"), and it is why House is IN scope rather
--       than carved out of it: aqar offers the field and says nothing in it.
--   10 Villa pages (positive control) -> 10/10 published a real value (`maid:0, driver:0`),
--       matching the false we already store, which is why Villa is excluded.
--
-- Corroborated by the stored data: Villa is the only property_type carrying a single false
-- (2,454 maid / 3,192 driver). The cohort being cleared holds 6,124 maid + 2,002 driver values,
-- every one of them `true`, not a single `false` -- the signature of a one-directional prose rule,
-- not of a source that answers.
--
-- This migration ABORTS ITSELF if it does more than it promised: unrelated columns moving, a Villa
-- value moving, or the cohort not reaching zero each raise and roll the whole thing back.
do $$
declare
  v_rows int; v_maid int; v_driver int;
  v_villa_before int; v_villa_after int;
  v_other_changed int; v_cols text; v_left int;
begin
  -- 1. Evidence first: correct the recorded probe to the fuller sample and the stricter metric.
  update public.ops_aqar_commercial_amenity_probe
     set pages_parsed = 90,
         pages_publishing = 6,          -- House carries the key on 6/6 pages; the VALUE is null on all 6
         probed_at = now(),
         verdict = 'NOT PUBLISHED outside the Villa ad form. 90 non-Villa pages parsed, 0 fetch '
                || 'failures, and NOT ONE published a maid or driver value: apartment/floor/land/'
                || 'building/rest house/room omit the key entirely, House carries it on 6/6 pages '
                || 'and is null on 6/6 (key presence is not a published value -- same shape as the '
                || 'aqar_commercial `parking` row). 10/10 Villa controls DID publish a value '
                || '(maid:0, driver:0) matching our stored false, which is why Villa is excluded.',
         method  = 'production _listing_json oracle (AST-lifted from scrapers/aqar/'
                || 'enrich_residential.py), 100 live pages total, 0 fetch failures, Villa positive '
                || 'control matched stored values exactly'
   where source_table = 'aqar_residential_listings'
     and column_name in ('maid_room','driver_room');

  -- 2. Snapshot every other column of every affected row, so "nothing else moved" is provable
  --    rather than asserted.
  create temp table _defab_snap on commit drop as
    select a.id, to_jsonb(a) - 'maid_room' - 'driver_room' as rest
      from public.aqar_residential_listings a
     where coalesce(a.property_type,'') <> 'Villa'
       and (a.maid_room is not null or a.driver_room is not null);
  select count(*) into v_rows from _defab_snap;

  select count(*) filter (where maid_room is not null),
         count(*) filter (where driver_room is not null)
    into v_maid, v_driver
    from public.aqar_residential_listings
   where id in (select id from _defab_snap);

  select count(*) filter (where maid_room is not null)
       + count(*) filter (where driver_room is not null)
    into v_villa_before
    from public.aqar_residential_listings
   where coalesce(property_type,'') = 'Villa';

  -- 3. Row-level before-state, one row per VALUE actually cleared, captured BEFORE the write.
  insert into public.ops_amenity_defabrication_evidence
    (source_table, listing_id, ad_id, property_type, column_name, value_before, value_after,
     probe_method, probe_result)
  select 'aqar_residential_listings', a.id,
         split_part(a.listing_url,'-',array_length(string_to_array(a.listing_url,'-'),1)),
         a.property_type, c.col, c.val, null,
         'owner-authorized cohort repair 2026-08-24; cohort source-proven on 90 live non-Villa '
      || 'pages via the production _listing_json oracle, 0 fetch failures',
         'aqar publishes no maid/driver VALUE for this property_type cohort (key absent, or '
      || 'present-and-null on House); 10/10 Villa controls published a value, so Villa is excluded'
    from public.aqar_residential_listings a
    join _defab_snap s on s.id = a.id
   cross join lateral (values ('maid_room', a.maid_room), ('driver_room', a.driver_room)) as c(col, val)
   where c.val is not null;

  -- 4. The repair. NULL = UNKNOWN. Never false, never true.
  update public.aqar_residential_listings a
     set maid_room = null, driver_room = null
   where a.id in (select id from _defab_snap);

  -- 5. ABORT unless the blast radius is exactly what was promised.
  select count(*) into v_other_changed
    from _defab_snap s join public.aqar_residential_listings a on a.id = s.id
   where (to_jsonb(a) - 'maid_room' - 'driver_room') is distinct from s.rest;
  if v_other_changed > 0 then
    select string_agg(distinct k, ', ') into v_cols
      from _defab_snap s
      join public.aqar_residential_listings a on a.id = s.id
     cross join lateral jsonb_each_text(to_jsonb(a) - 'maid_room' - 'driver_room') e(k, v)
     where s.rest ->> e.k is distinct from e.v;
    raise exception 'ABORT: % row(s) had an unrelated column change (%). Nothing written.',
      v_other_changed, v_cols;
  end if;

  select count(*) filter (where maid_room is not null)
       + count(*) filter (where driver_room is not null)
    into v_villa_after
    from public.aqar_residential_listings
   where coalesce(property_type,'') = 'Villa';
  if v_villa_after <> v_villa_before then
    raise exception 'ABORT: Villa values moved (% -> %). Nothing written.', v_villa_before, v_villa_after;
  end if;

  select count(*) into v_left
    from public.aqar_residential_listings
   where coalesce(property_type,'') <> 'Villa'
     and (maid_room is not null or driver_room is not null);
  if v_left <> 0 then
    raise exception 'ABORT: % fabricated value(s) still present in the cohort. Nothing written.', v_left;
  end if;

  -- 6. The barrier that watches this class, re-run so its alert reflects post-repair state.
  perform public.mon_detect_fabricated_unpublished_amenity();

  raise notice 'de-fabrication complete: % rows, % maid, % driver, villa unchanged at %',
    v_rows, v_maid, v_driver, v_villa_after;
end $$;
