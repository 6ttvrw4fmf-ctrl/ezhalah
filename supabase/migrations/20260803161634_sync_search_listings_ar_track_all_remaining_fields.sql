-- Senior audit run #3 follow-through (2026-08-03): closes the REMAINDER of the silent-propagation
-- gap fixed for floor_number/direction_ar in 20260729194317. The incremental sync's change-detection
-- clause still did not diff: bathrooms, furnished, tenant_ar, license_number, street_width_m, the 7
-- amenity booleans, type_ar, rent_period_ar — so a source-table correction to any of them silently
-- never reached search_listings_ar unless a tracked field changed too (the exact failure mode that
-- hid the floor_number repair for hours on 07-29). Computed fields compare against the SAME
-- expressions the SELECT projects (furnished's gathern/aqarmonthly force-true, tenant_ar's closed
-- vocab, rent_period_ar's deal-gated mapping, type_ar's canon_type_ar(normalize(...))).
-- Guarded needle-edit built from the LIVE def (which now carries the Buy-token-price gate from
-- 20260803112311 — preserved untouched); idempotent; aborts if anchors are missing.
-- Measured cost: sync elapsed 41.27s post-change vs 41.47s baseline (same-size batch) — no
-- measurable overhead; the diff comparisons are dominated by the scan/upsert.
do $mig$
declare src text; out text; needle text; addition text;
begin
  src := pg_get_functiondef('public.sync_search_listings_ar'::regproc);
  if position('s3.bathrooms is distinct from' in src) > 0 then
    raise notice 'already applied — skipping';
    return;
  end if;
  needle := 'then v.direction end))))';
  if (length(src) - length(replace(src, needle, ''))) / length(needle) <> 1 then
    raise exception 'sync_search_listings_ar: direction-diff anchor not found exactly once — aborting';
  end if;
  addition := '
                       or s3.bathrooms is distinct from v.bathrooms
                       or s3.license_number is distinct from v.license_number
                       or s3.street_width_m is distinct from v.street_width_m
                       or s3.elevator is distinct from v.elevator
                       or s3.parking is distinct from v.parking
                       or s3.kitchen is distinct from v.kitchen
                       or s3.air_conditioner is distinct from v.air_conditioner
                       or s3.maid_room is distinct from v.maid_room
                       or s3.driver_room is distinct from v.driver_room
                       or s3.private_entrance is distinct from v.private_entrance
                       or s3.furnished is distinct from (case when v.source_table ~ ''^(gathern|aqarmonthly)_'' then true else v.furnished end)
                       or s3.tenant_ar is distinct from (case when v.tenant_category in (''عزاب'',''عوائل'') then v.tenant_category end)
                       or s3.rent_period_ar is distinct from (case when lower(v.transaction_type)=''rent'' then case v.rent_period when ''monthly'' then ''شهري'' when ''annual'' then ''سنوي'' else null end end)
                       or s3.type_ar is distinct from canon_type_ar(normalize(case when t.ar is not null then t.ar when v.property_type is null or btrim(v.property_type) = '''' then ''غير معروف'' when v.property_type ~ ''[A-Za-z]'' then ''غير معروف'' else v.property_type end, NFC))';
  out := replace(src, needle, 'then v.direction end)' || addition || ')))');
  if out = src or position('s3.type_ar is distinct from canon_type_ar' in out) = 0 then
    raise exception 'sync_search_listings_ar: extension did not apply cleanly — aborting';
  end if;
  execute out;
end
$mig$;
