-- Results-Found rotation: strip every "comma before the emoji" from all 40 templates.
--
-- Owner rule 2026-09-19: «the comma should always come after the emoji, not before. Make sure you
-- apply it and you fix it for every single thing.» Under that rule a template like «أبشر، طلع لنا
-- {count} نتيجة على بحثك 🏡» is illegal — every interior "،"/"," reads as a comma BEFORE the
-- terminal emoji. The prior migration 20260919040825_ui_results_found_rotation.sql seeded 21 rows
-- carrying that pattern; this migration UPDATEs them to the comma-free shape, byte-for-byte equal
-- to the BAKED list in src/data/resultsFoundRotation.ts (asserted by
-- scripts/verify-results-found-rotation.ts).
--
-- Design: 40 pinned UPDATEs keyed on (lang, has_name, sort_order) — the unique constraint the seed
-- migration created — so this file is self-describing and idempotent; re-running writes the same
-- bytes. The 19 rows the earlier migration already had comma-free are still listed (no-op UPDATE)
-- so a future reader sees the full pool here without having to cross-reference the seed.

-- AR logged-in
update public.ui_results_found set template = 'لقينا لك {count} نتيجة تطابق بحثك يا {name} 🎉'         where lang='ar' and has_name=true  and sort_order=1;
update public.ui_results_found set template = 'أبشر يا {name} طلع لنا {count} نتيجة على بحثك 🏡'        where lang='ar' and has_name=true  and sort_order=2;
update public.ui_results_found set template = 'يا سلام يا {name} لقينا {count} نتيجة تطابق مواصفات بحثك 🙌' where lang='ar' and has_name=true  and sort_order=3;
update public.ui_results_found set template = 'تم يا {name} عندنا {count} نتيجة مطابقة لبحثك ✨'        where lang='ar' and has_name=true  and sort_order=4;
update public.ui_results_found set template = 'لقيناها يا {name} {count} نتيجة على بحثك 🔎'             where lang='ar' and has_name=true  and sort_order=5;
update public.ui_results_found set template = 'تمام يا {name} بحثك رجّع لنا {count} نتيجة 🥳'           where lang='ar' and has_name=true  and sort_order=6;
update public.ui_results_found set template = 'تم البحث يا {name} وطلع لنا {count} نتيجة ✅'            where lang='ar' and has_name=true  and sort_order=7;
update public.ui_results_found set template = 'لقينا {count} نتيجة على بحثك الحالي يا {name} 🔍'         where lang='ar' and has_name=true  and sort_order=8;
update public.ui_results_found set template = 'عندنا {count} نتيجة يا {name} تطابق بحثك الحالي 🏘️'      where lang='ar' and has_name=true  and sort_order=9;
update public.ui_results_found set template = 'لقينا نتائج يا {name} وعددها {count} 🏡'                  where lang='ar' and has_name=true  and sort_order=10;

-- AR guest
update public.ui_results_found set template = 'لقينا لك {count} نتيجة تطابق بحثك 🎉'                    where lang='ar' and has_name=false and sort_order=1;
update public.ui_results_found set template = 'أبشر طلع لنا {count} نتيجة على بحثك 🏡'                  where lang='ar' and has_name=false and sort_order=2;
update public.ui_results_found set template = 'يا سلام لقينا {count} نتيجة تطابق مواصفات بحثك 🙌'        where lang='ar' and has_name=false and sort_order=3;
update public.ui_results_found set template = 'تم عندنا {count} نتيجة مطابقة لبحثك ✨'                  where lang='ar' and has_name=false and sort_order=4;
update public.ui_results_found set template = 'بحثك رجّع لنا {count} نتيجة 🥳'                          where lang='ar' and has_name=false and sort_order=5;
update public.ui_results_found set template = 'تم البحث وطلع لنا {count} نتيجة ✅'                      where lang='ar' and has_name=false and sort_order=6;
update public.ui_results_found set template = 'لقينا {count} نتيجة تطابق اللي بحثت عنه 🔍'              where lang='ar' and has_name=false and sort_order=7;
update public.ui_results_found set template = 'تمام عندنا {count} نتيجة من بحثك الحالي 💯'              where lang='ar' and has_name=false and sort_order=8;
update public.ui_results_found set template = 'عندنا {count} نتيجة تطابق بحثك ⚡'                       where lang='ar' and has_name=false and sort_order=9;
update public.ui_results_found set template = 'تم لقينا {count} نتيجة حسب مواصفات بحثك 🏡'              where lang='ar' and has_name=false and sort_order=10;

-- EN logged-in
update public.ui_results_found set template = 'We found {count} results matching your search {name} 🎉'                 where lang='en' and has_name=true  and sort_order=1;
update public.ui_results_found set template = 'Good news {name} we found {count} results matching your search 🏡'       where lang='en' and has_name=true  and sort_order=2;
update public.ui_results_found set template = 'Search complete {name} we found {count} results ✅'                      where lang='en' and has_name=true  and sort_order=3;
update public.ui_results_found set template = 'Your search returned {count} results {name} 💫'                          where lang='en' and has_name=true  and sort_order=4;
update public.ui_results_found set template = 'We found {count} results for your current search {name} 🔍'              where lang='en' and has_name=true  and sort_order=5;
update public.ui_results_found set template = 'Done {name} we found {count} results matching your criteria ⚡'          where lang='en' and has_name=true  and sort_order=6;
update public.ui_results_found set template = 'Good news {name} we found {count} results matching your criteria 🎯'     where lang='en' and has_name=true  and sort_order=7;
update public.ui_results_found set template = 'Search complete {name} we found {count} matching results 🙌'             where lang='en' and has_name=true  and sort_order=8;
update public.ui_results_found set template = 'Good news {name} we found {count} results matching your search ⚡'       where lang='en' and has_name=true  and sort_order=9;
update public.ui_results_found set template = 'Done {name} we found {count} results based on your search criteria 🏡'   where lang='en' and has_name=true  and sort_order=10;

-- EN guest
update public.ui_results_found set template = 'We found {count} results matching your search 🎉'                       where lang='en' and has_name=false and sort_order=1;
update public.ui_results_found set template = 'Good news we found {count} results matching your search 🏡'             where lang='en' and has_name=false and sort_order=2;
update public.ui_results_found set template = 'Search complete we found {count} results ✅'                            where lang='en' and has_name=false and sort_order=3;
update public.ui_results_found set template = 'Your search returned {count} results 💫'                                where lang='en' and has_name=false and sort_order=4;
update public.ui_results_found set template = 'We found {count} results for your current search 🔍'                    where lang='en' and has_name=false and sort_order=5;
update public.ui_results_found set template = 'Done we found {count} results matching your criteria ⚡'                where lang='en' and has_name=false and sort_order=6;
update public.ui_results_found set template = 'Good news we found {count} results matching your criteria 🎯'           where lang='en' and has_name=false and sort_order=7;
update public.ui_results_found set template = 'Search complete we found {count} matching results 🙌'                   where lang='en' and has_name=false and sort_order=8;
update public.ui_results_found set template = 'Good news we found {count} results matching your search ⚡'             where lang='en' and has_name=false and sort_order=9;
update public.ui_results_found set template = 'Done we found {count} results based on your search criteria 🏡'         where lang='en' and has_name=false and sort_order=10;
