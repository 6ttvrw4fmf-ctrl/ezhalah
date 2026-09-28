-- nufouth: stored titles carry property OWNERS' personal names (PDPL). ONE-TIME REPAIR.
-- *** DO NOT RUN WITHOUT THE OWNER'S APPROVAL. ***
--
-- WHAT. The title was the API's internal doc name «(<n>-<type>)-<asset> - <owner> … F-H123»; the
-- owner's name sits after the dash AND inside <asset>. Measured 2026-09-28 (before any repair):
-- 117 of 295 titles named an individual, ~85 more a family name. Every title becomes the label the
-- fixed scraper now writes (scrapers/nufouth/run.py map_listing), built ONLY from the row's own
-- stored source fields, never parsed out of the old title:
--     unit row            → «<type_ar> <unit_no>»   e.g. «معرض 4»
--     whole-property row  → «<type_ar>»             (unit_no is absent), e.g. «عمارة»
-- Checked before this file was written: that expression equals the fixed scraper's title on 280/280
-- rows it produced from a live read of the API (the other 15 rows are no longer listed), so the
-- next crawl rewrites nothing.
--
-- COPIES. `source_capture.source_text` is db._ensure_capture's fallback copy of the title when a
-- row has no description (15 rows); it gets the same text. listing_location_index /
-- listing_location_canonical_mv (title pass-through) refresh on their own schedule, and
-- listing_location_relations re-derives from the new text (loc_rel_refresh_one sees the source
-- hash change); step 2 only drops its 7 title-matched rows now (an owner's given name that is also
-- a direction word, read as a "behind <landmark>" relation — a false fact carrying a surname).
--
-- ORDER. Run AFTER the scraper fix is on main: the daily crawl (~04:24 UTC) otherwise writes the
-- doc names back. zz_redact_pii fires on the UPDATE; it leaves these short labels untouched.

-- 0. Preview (read-only): rows that will change, and how many of them are active.
select 'nufouth_residential_listings' tbl, count(*) filter (where active) active_rows, count(*) all_rows
from public.nufouth_residential_listings
where additional_info ? 'type_ar'
  and title is distinct from btrim(concat_ws(' ', additional_info->>'type_ar', additional_info->>'unit_no'))
union all
select 'nufouth_commercial_listings', count(*) filter (where active), count(*)
from public.nufouth_commercial_listings
where additional_info ? 'type_ar'
  and title is distinct from btrim(concat_ws(' ', additional_info->>'type_ar', additional_info->>'unit_no'));

begin;

-- 1. Titles (+ the fallback capture that is a copy of the title).
update public.nufouth_residential_listings l
set title = n.new_title,
    source_capture = case when l.source_capture->>'source_text' = l.title
                          then jsonb_set(l.source_capture, '{source_text}', to_jsonb(n.new_title))
                          else l.source_capture end
from (select id, btrim(concat_ws(' ', additional_info->>'type_ar', additional_info->>'unit_no')) new_title
      from public.nufouth_residential_listings where additional_info ? 'type_ar') n
where l.id = n.id and l.title is distinct from n.new_title;

update public.nufouth_commercial_listings l
set title = n.new_title,
    source_capture = case when l.source_capture->>'source_text' = l.title
                          then jsonb_set(l.source_capture, '{source_text}', to_jsonb(n.new_title))
                          else l.source_capture end
from (select id, btrim(concat_ws(' ', additional_info->>'type_ar', additional_info->>'unit_no')) new_title
      from public.nufouth_commercial_listings where additional_info ? 'type_ar') n
where l.id = n.id and l.title is distinct from n.new_title;

-- 2. Location relations read out of the old titles (the owner's name). The refresh would drop
--    them too once it sees the new text; this only makes it immediate.
delete from public.listing_location_relations
where source_table in ('nufouth_residential_listings', 'nufouth_commercial_listings')
  and matched_field = 'title';

commit;

-- 3. Verify (read-only). Expect: changed = 0, doc_name_left = 0, capture_doc_name_left = 0.
select count(*) filter (where title is distinct from btrim(concat_ws(' ', additional_info->>'type_ar', additional_info->>'unit_no'))) changed,
       count(*) filter (where title ~ '^\(|-[HNR][0-9]+\s*$') doc_name_left,   -- not ' - ': «معرض 9 - 11 - 12» is a real unit_no
       count(*) filter (where source_capture->>'source_text' ~ '[A-Z]?-[HNR][0-9]+\s*$') capture_doc_name_left
from (select title, additional_info, source_capture from public.nufouth_residential_listings
      union all
      select title, additional_info, source_capture from public.nufouth_commercial_listings) t
where additional_info ? 'type_ar';
