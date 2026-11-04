-- fields-and-filters, 2026-11-04.
--
-- 1. field_integrity_extreme_magnitude judges what is SERVED, not only the raw source figure.
--    enforce_price_size_sanity() (owner 2026-10-28) serves the seller's figure when a sale total was typed
--    into the per-meter box (price_typed_in_meter_box_ar). The source table keeps the source's figure
--    (PRICE = SOURCE), so the detector kept counting rows whose card already shows a sane price: 5 of the 6
--    dealapp rows (e.g. listing 23614750: source 1,290,000,000 for 430 m2, served 3,000,000). A row is now
--    excluded only when its served price DIFFERS from the source figure AND is itself under the same
--    thresholds; a row served as-is (dealapp 21600559, 554,113,966/yr on 500 m2) still counts.
--
-- 2. dealapp furnished = yes over a floor covering (alarm dealapp_partial_furnished_as_yes, P1): three ads
--    whose only furnishing word names a floor covering — «سطح مفروش بنجيل صناعي» (438767), «غرفة النوم
--    مفروشة بالموكيت» (598307), «حوش كبير مفروش بالعشب» (493432). The stored description is the evidence;
--    the word reader now refuses these and the crawler writes the NULL itself from now on. Repaired to NULL.
do $do$
declare
  v_def text := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  v_old text := $o$                            and not exists (select 1 from public.ops_price_source_verified v
                                             where v.source_table = %L and v.listing_id = id))
        from public.%I
      $f$, ph, ph, unit_types, rec.tn, land_types, rec.tn, rec.tn)$o$;
  v_new text := $n$                            and not exists (select 1 from public.ops_price_source_verified v
                                             where v.source_table = %L and v.listing_id = id)
                            -- served corrected (enforce_price_size_sanity) and sane → not a served defect
                            and not exists (select 1 from public.search_listings_ar s
                                             where s.source_table = %L and s.listing_id = x.id
                                               and s.price_total is distinct from x.price_total
                                               and s.area_m2 > 0
                                               and coalesce(s.price_total, 0)::numeric / s.area_m2 <= 2000000
                                               and coalesce(s.price_annual, 0)::numeric / s.area_m2 <= 500000))
        from public.%I x
      $f$, ph, ph, unit_types, rec.tn, land_types, rec.tn, rec.tn, rec.tn)$n$;
  v_n int;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'mon_detect_field_integrity: anchor not found exactly once — re-read the live function';
  end if;
  execute replace(v_def, v_old, v_new);

  update public.dealapp_residential_listings
     set furnished = null
   where id in (1571258, 17021434, 1738221)
     and furnished is true
     and description ~ 'مفروش[ةه]?\s*(ب)?(ال)?(نجيل|عشب|موكيت)';
  get diagnostics v_n = row_count;
  if v_n <> 3 then
    raise exception 'dealapp furnished repair: expected 3 rows, got %', v_n;
  end if;
  -- the standing watch over the repair (resolves its key once nothing is served as yes)
  perform public.mon_detect_dealapp_partial_furnished_as_yes();
end
$do$;
