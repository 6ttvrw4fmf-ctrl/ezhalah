-- 🦅 Falcon 2026-10-09, step 2 of 2 (see 20261009 falcon_district_contradiction_repair_targets).
-- The detector's own documented REPAIR: copy the source's published district into the frozen
-- listings_arabic_locations row that is serving a different one. The snapshot's district_ar becomes
-- the source district resolved against the city catalog, or NULL where it does not resolve (honest
-- «الحي غير محدد» instead of a neighbourhood the ad is not in); raw_district keeps the source's
-- exact words; review_reason records the provenance. Only a snapshot row that currently carries the
-- served (wrong) district is touched, so a row a peer already repaired is skipped. The hourly
-- refresh_listing_native_location_v1 (:20) and sync_search_listings_ar (:22) propagate it — never
-- hand-run (rulebook rule 4). Count-asserted: every target with a matching snapshot row, and no other.
do $fix$
declare n_expected int; n_done int;
begin
  select count(*) into n_expected
    from public.ops_falcon_district_repair_2026_10_09 t
    join public.listings_arabic_locations l
      on l.source_table = t.source_table and l.listing_id = t.listing_id and l.platform = t.platform
   where public.norm_district_tok(l.district_ar) = public.norm_district_tok(t.we_display);
  if n_expected < 400 or n_expected > 500 then
    raise exception 'expected ~471 snapshot rows (measured 20:52 UTC), found %; refusing', n_expected;
  end if;
  update public.listings_arabic_locations l
     set district_ar = t.resolved_district_ar,
         raw_district = t.source_says,
         review_reason = coalesce(l.review_reason, '')
                         || ' | falcon 2026-10-09: snapshot served «' || t.we_display
                         || '», source publishes «' || t.source_says || '»'
    from public.ops_falcon_district_repair_2026_10_09 t
   where l.source_table = t.source_table and l.listing_id = t.listing_id and l.platform = t.platform
     and public.norm_district_tok(l.district_ar) = public.norm_district_tok(t.we_display);
  get diagnostics n_done = row_count;
  if n_done <> n_expected then
    raise exception 'updated % rows but expected %; rolled back', n_done, n_expected;
  end if;
  raise notice 'falcon district repair: % snapshot rows repointed to the source district', n_done;
end $fix$;