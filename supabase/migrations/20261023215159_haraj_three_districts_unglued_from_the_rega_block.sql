-- 🦅 Falcon 2026-10-23: three Haraj districts still carry the REGA block line glued after them.
--
-- scrapers/haraj/parse.py split glued labels from 2026-10-22 (_GLUED_LABEL names HRJ11188292238, HRJ11187750970 and
-- HRJ11189101593), but the rows written before that kept the old value: a None-dropping upsert never retracts it and the
-- three posts have not been re-read since 10-19. Served today in search_listings_ar.district_ar (and so in the district
-- list): «الملك فهد صاحب الترخيص : <office> تاريخ انتهاء رخصة الإعلان : 2026-12-31», «الرانوناء صاحب الترخيص : <office>
-- …», «شمال التضامن عمولة نقل الملكية: لا يوجد» — a licence holder's name and an expiry date inside a location name.
-- Each ad's OWN deed line says «الحي: الملك فهد», «الحي: الرانوناء», «الحي: شمال التضامن»; the current parser reads the
-- same three words from that text. Repair = the ad's own evidence, guarded on the exact glued prefix, exactly 3 rows.
do $mig$
declare n int;
begin
  with fix(id, prefix, clean) as (values
    (18749823, 'الملك فهد صاحب الترخيص', 'الملك فهد'),
    (18784261, 'الرانوناء صاحب الترخيص', 'الرانوناء'),
    (18706295, 'شمال التضامن عمولة نقل الملكية', 'شمال التضامن'))
  update public.haraj_residential_listings h set neighborhood = f.clean
    from fix f where h.id = f.id and h.neighborhood like f.prefix || '%';
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'expected 3 haraj rows, touched %; refusing', n; end if;
end $mig$;
