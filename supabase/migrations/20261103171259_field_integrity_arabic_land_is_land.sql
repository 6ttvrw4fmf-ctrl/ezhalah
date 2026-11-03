-- mon_detect_field_integrity: an Arabic land type IS land (2026-11-03).
--
-- The area arm flags area > 1,000,000 m² on a NON-land type, and its own comment says why land is excluded: «Land
-- parcels are legitimately measured in square kilometres in Saudi Arabia». But its land list holds only the English
-- clean types, and several platforms store land under the source's Arabic word — aqar alone holds 8,000+ active rows
-- typed «أرض», «أرض زراعية», «أرض تجارية» … Measured: 45 of aqar's 48 extreme-magnitude rows and 10 of haraj's were
-- exactly that (1.0-9.4 million m² farms and plots), so the P1 alert sat open on land it means to exempt and hid the
-- 3 rows that were really worth a look (a villa and two rooms, adjudicated against the source the same day).
-- The PRICE arm (> 2,000,000 SAR/m²) is untouched: it still reads every type, Arabic land included.
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  if position($x$area_m2::numeric > 1000000$x$ in d) = 0 then
    raise exception 'mon_detect_field_integrity: area-arm anchor not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$area_m2::numeric > 1000000$x$,
    $x$area_m2::numeric > 1000000 and coalesce(property_type,'') !~ '^أرض'$x$);
  execute d;
end
$mig$;