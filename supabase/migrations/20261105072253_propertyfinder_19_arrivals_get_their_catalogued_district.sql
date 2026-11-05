-- 🆕 New Listings Engineer 2026-11-05 — tonight's 19 Property Finder arrivals whose OWN district field names a place the
-- catalogue holds, filed with no district (contract G). The scraper now maps them (PR #10651) and «درة العروس» is on
-- جدة's list tonight (mirror PR #10652), but Property Finder is crawled once a day (05:55 UTC), so these rows would wait a day.
-- Each value is the source's own DISTRICT word mapped to the catalogue name exactly as scrapers/propertyfinder/run.py
-- _district() maps it (same city scope); nothing is inferred beyond that table. Undo: set district_ar = null on the
-- same ids (all 19 were null before).
update public.propertyfinder_residential_listings t
   set district_ar = m.catalog_ar
  from (values (3, 'مطار الملك خالد الدولي', 'مطار الملك خالد'),
               (6, 'ريع اذاخر', 'حي ريع زاخر'),
               (6, 'الهجلة الجديد', 'حي الهجلة'),
               (18, 'درة العروس', 'درة العروس')) as m(city_id, source_word, catalog_ar)
 where t.active and t.district_ar is null and t.city_id = m.city_id and t.neighborhood = m.source_word
   and exists (select 1 from public.loc_catalog_district c
                where c.city_id = m.city_id and c.district_norm = public.norm_district_tok(m.catalog_ar) and c.retired_at is null);

do $$
declare left_n int;
begin
  select count(*) into left_n from public.propertyfinder_residential_listings
   where active and district_ar is null
     and neighborhood in ('مطار الملك خالد الدولي', 'ريع اذاخر', 'الهجلة الجديد', 'درة العروس');
  if left_n <> 0 then raise exception '% Property Finder rows still carry no district', left_n; end if;
end $$;
