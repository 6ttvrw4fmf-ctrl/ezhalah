-- sakan spells four catalogue cities its own way, so 64 of its live listings are skipped
-- city_not_in_catalog every day (coverage audit 2026-09-28; run notes «city_not_in_catalogx65»).
--
-- STAGED, NOT APPLIED. apply_migration mints the version, so this is applied by a session with
-- write authority and then mirrored into supabase/migrations/ under the minted version (and this
-- file deleted) — see AGENTS.md «Migration drift guard».
--
-- MEASURED: every sakan sitemap listing absent from sakan_*_listings, fetched and re-parsed with
-- the production parser (68 pages; 64 city_not_in_catalog, 3 no_city, 1 new). The raw city labels
-- are sakan's breadcrumb city segment; the region is the segment before it, and it corroborates
-- each mapping — an alias is written only when the catalogue city sits in THAT region:
--   «الاحسا 1» ×56 → folded «الاحسا» (sakan's own numbered-duplicate fold) → الاحساء (المنطقة الشرقية)
--   «محائل» ×6                                                          → محايل   (منطقة عسير)
--   «قصرابن عقيل» ×1 (no space)                                          → قصر ابن عقيل (منطقة القصيم)
--   «مدينة الملك عبدالله الاقت» ×1 (sakan's own truncation)               → مدينة الملك عبدالله الاقتصادية
-- Each is a spelling of exactly one catalogue city; none is a region label (checked: no alias
-- string equals a catalogue city or region name). Side effect: 1 wasalt row whose city_ar is
-- «قصرابن عقيل» resolves too. Reversible: delete these four alias rows.
-- scrapers/common/tests/test_sakan_city_spelling_aliases.py runs these rows through sakan's real
-- map_listing() and the shared resolver.
insert into public.loc_catalog_city_alias (alias_norm, city_id)
select public.normalize_ar(a.alias), c.city_id
  from (values
    ('الاحسا', 'الأحساء', 'المنطقة الشرقية'),
    ('محائل', 'محايل', 'منطقة عسير'),
    ('قصرابن عقيل', 'قصر ابن عقيل', 'منطقة القصيم'),
    ('مدينة الملك عبدالله الاقت', 'مدينة الملك عبدالله الاقتصادية', 'منطقة مكة المكرمة')
  ) as a(alias, city_ar, region_ar)
  join public.loc_catalog_city c on c.city_norm = public.normalize_ar(a.city_ar)
  join public.loc_catalog_region r on r.region_id = c.region_id and r.region_ar = a.region_ar
on conflict (alias_norm) do nothing;

do $do$
begin
  if (select count(*) from public.loc_catalog_city_alias x
        join public.loc_catalog_city c on c.city_id = x.city_id
       where (x.alias_norm, c.city_norm) in (
         (public.normalize_ar('الاحسا'), public.normalize_ar('الأحساء')),
         (public.normalize_ar('محائل'), public.normalize_ar('محايل')),
         (public.normalize_ar('قصرابن عقيل'), public.normalize_ar('قصر ابن عقيل')),
         (public.normalize_ar('مدينة الملك عبدالله الاقت'), public.normalize_ar('مدينة الملك عبدالله الاقتصادية')))
     ) <> 4 then
    raise exception 'ABORT: expected 4 sakan spelling aliases, each on its own catalogue city';
  end if;
end $do$;
