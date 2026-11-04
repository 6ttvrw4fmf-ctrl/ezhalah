-- FOUR OLD SERVED DISTRICTS THE SOURCE NEVER PUBLISHED (🔧 2026-11-03; routed by 🆕 as backlog 1176, the 2026-10-09
-- recipe of migrations 20261009205526 / 20261009205629). Each row is served straight from the frozen
-- listings_arabic_locations snapshot, whose district_ar never equals what the source publishes today, and the source
-- district resolves in the served city's own catalog (loc_display_district_ar), so the snapshot takes the source word:
--   dealapp 1280031  مكة المكرمة  source «حي بدر»           served «حي العسيلة»   → حي بدر
--   dealapp 1274179  مكة المكرمة  source «حي الفلق الجديد»  served «حي ولي العهد»  → حي الفلق الجديد
--   aqar    17601862 الرياض       source «حي الرمال»        served «حي المونسية»   → حي الرمال
--   mustqr  615195   حائل         source «حدري البلاد»      served «مخيرص»         → حي حدري البلاد
-- The other rows of 1176/1215 are not this shape: 1274200 and ksaaqar 12227135 have left the detector view; eastabha
-- 595385's snapshot already carries «شوحط»; therc 10283555 and alhoshan 6492545/6492546/7122720/14102192 have no
-- snapshot row (their served district comes from the resolver — the owner's open question (a) of 2026-11-03, untouched).
-- Count-asserted: exactly these four snapshot rows, each still carrying the served (wrong) district. The hourly
-- refresh_listing_native_location_v1 (:20) and sync_search_listings_ar (:22) propagate it — never hand-run.
do $fix$
declare n_done int;
begin
  update public.listings_arabic_locations l
     set district_ar = v.resolved,
         raw_district = v.source_says,
         review_reason = coalesce(l.review_reason, '')
                         || ' | 🔧 2026-11-03 (backlog 1176): snapshot served «' || v.we_display
                         || '», source publishes «' || v.source_says || '»'
    from (values
            ('dealapp_residential_listings', 1280031,  'dealapp', 'حي بدر',          'حي العسيلة',  'حي بدر'),
            ('dealapp_residential_listings', 1274179,  'dealapp', 'حي الفلق الجديد', 'حي ولي العهد', 'حي الفلق الجديد'),
            ('aqar_residential_listings',    17601862, 'aqar',    'حي الرمال',       'حي المونسية',  'حي الرمال'),
            ('mustqr_residential_listings',  615195,   'mustqr',  'حدري البلاد',     'مخيرص',        'حي حدري البلاد')
         ) as v(source_table, listing_id, platform, source_says, we_display, resolved)
   where l.source_table = v.source_table and l.listing_id = v.listing_id and l.platform = v.platform
     and public.norm_district_tok(l.district_ar) = public.norm_district_tok(v.we_display)
     and public.loc_display_district_ar((select s.city_id from public.search_listings_ar s
                                           where s.source_table = v.source_table and s.listing_id = v.listing_id), v.source_says) = v.resolved;
  get diagnostics n_done = row_count;
  if n_done <> 4 then
    raise exception 'expected exactly 4 snapshot rows (measured 13:4x UTC), touched %; rolled back', n_done;
  end if;
end $fix$;
