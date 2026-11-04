-- aqar maid_room / driver_room exist ONLY on aqar's VILLA ad form (owner decision 5, 2026-11-03,
-- «Yes, use your picks»): on every non-Villa aqar row the stored value is not a source value -> NULL.
--
-- Evidence: ops_aqar_commercial_amenity_probe #18/#19 (2026-08-24: 90 live non-Villa pages, 0 fetch
-- failures, 0 published values; 10/10 Villa controls published). Re-confirmed 2026-11-03 from stored
-- captures: the rendered «المميزات» block names غرفة خادمة/سائق on 11,374 of 12,578 recent Villa rows
-- carrying a true, and on 0 of 77 non-Villa rows carrying one. The values came back after the 2026-08-24
-- cohort repair (8,126 cleared then) because aqar's payload still carries the keys on a few non-Villa ads
-- and the parser read them; scrapers/aqar/enrich_residential.py now sends AUTHORITATIVE_NULL for both
-- columns on every non-Villa form, so this does not recur. Alarm: fabricated_unpublished_amenity (2958).
--
-- Every cleared value is recorded first in ops_amenity_defabrication_evidence (reversible).
-- sync_search_listings_ar() compares maid_room/driver_room on every row, so the NULL reaches search on
-- its next pass. Fail-closed: refuses if the cohort is far larger than measured (258 + 9 rows).
do $$
declare
  v_res_before bigint; v_com_before bigint; v_res_after bigint; v_com_after bigint;
  v_ev bigint; v_upd_res bigint; v_upd_com bigint; v_villa_before bigint; v_villa_after bigint;
begin
  select count(*) into v_res_before from public.aqar_residential_listings
   where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null);
  select count(*) into v_com_before from public.aqar_commercial_listings
   where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null);
  select count(*) into v_villa_before from public.aqar_residential_listings
   where property_type = 'Villa' and (maid_room is not null or driver_room is not null);
  raise notice 'before: residential non-Villa rows=%, commercial non-Villa rows=%, residential Villa rows=%',
    v_res_before, v_com_before, v_villa_before;
  if v_res_before > 600 or v_com_before > 50 then
    raise exception 'cohort larger than measured (residential %, commercial %) -- refusing', v_res_before, v_com_before;
  end if;

  insert into public.ops_amenity_defabrication_evidence
    (repaired_at, source_table, listing_id, ad_id, property_type, column_name, value_before, value_after, probe_method, probe_result)
  select now(), x.tbl, x.id, x.ad_number, x.property_type, c.col, c.val, null,
         'owner decision 5 (2026-11-03, «Yes, use your picks»); probe #18/#19 (90 live non-Villa pages) + 2026-11-03 stored-capture recheck (0/77 non-Villa feature blocks name the room, 11,374/12,578 Villa do)',
         'aqar publishes maid/driver only on the Villa ad form; a non-Villa value is not a source value'
    from (select 'aqar_residential_listings'::text tbl, id, ad_number, property_type, maid_room, driver_room
            from public.aqar_residential_listings
           where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null)
          union all
          select 'aqar_commercial_listings', id, ad_number, property_type, maid_room, driver_room
            from public.aqar_commercial_listings
           where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null)) x
   cross join lateral (values ('maid_room', x.maid_room), ('driver_room', x.driver_room)) c(col, val)
   where c.val is not null;
  get diagnostics v_ev = row_count;

  update public.aqar_residential_listings set maid_room = null, driver_room = null
   where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null);
  get diagnostics v_upd_res = row_count;
  update public.aqar_commercial_listings set maid_room = null, driver_room = null
   where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null);
  get diagnostics v_upd_com = row_count;

  select count(*) into v_res_after from public.aqar_residential_listings
   where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null);
  select count(*) into v_com_after from public.aqar_commercial_listings
   where property_type is distinct from 'Villa' and (maid_room is not null or driver_room is not null);
  select count(*) into v_villa_after from public.aqar_residential_listings
   where property_type = 'Villa' and (maid_room is not null or driver_room is not null);
  raise notice 'evidence rows=%, updated residential=%, commercial=%; after: residential=%, commercial=%, Villa=%',
    v_ev, v_upd_res, v_upd_com, v_res_after, v_com_after, v_villa_after;

  if v_upd_res <> v_res_before or v_upd_com <> v_com_before or v_res_after <> 0 or v_com_after <> 0
     or v_villa_after <> v_villa_before then
    raise exception 'post-check failed (updated %/% of %/%, left %/%, Villa % -> %)',
      v_upd_res, v_upd_com, v_res_before, v_com_before, v_res_after, v_com_after, v_villa_before, v_villa_after;
  end if;
end $$;
