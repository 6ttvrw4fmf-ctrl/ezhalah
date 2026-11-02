-- 🦅 Falcon 2026-10-23, second half of haraj_three_districts_unglued_from_the_rega_block: haraj keeps its Arabic district in its OWN district_ar column,
-- and that column — not neighborhood — is what listing_native_location_v1 serves for haraj. The first repair fixed
-- neighborhood only, so the 22:20 refresh still served the glued text (with the licence holder's name in full: the PDPL
-- trigger redacts neighborhood, not district_ar). Same 3 rows, same evidence (each ad's own deed «الحي:» line), same
-- words every sibling row of these districts stores in both columns («الرانوناء» 58, «الملك فهد» 68, «شمال التضامن» 10).
do $mig$
declare n int;
begin
  with fix(id, prefix, clean) as (values
    (18749823, 'الملك فهد صاحب الترخيص', 'الملك فهد'),
    (18784261, 'الرانوناء صاحب الترخيص', 'الرانوناء'),
    (18706295, 'شمال التضامن عمولة نقل الملكية', 'شمال التضامن'))
  update public.haraj_residential_listings h set district_ar = f.clean
    from fix f where h.id = f.id and h.district_ar like f.prefix || '%' and h.neighborhood = f.clean;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'expected 3 haraj rows, touched %; refusing', n; end if;
end $mig$;
