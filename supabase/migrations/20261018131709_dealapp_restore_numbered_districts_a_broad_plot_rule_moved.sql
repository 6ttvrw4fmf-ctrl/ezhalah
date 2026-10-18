-- 2026-10-18. DEALAPP: put back the 15 districts a too-broad plot-code rule moved (run 39129698696, cancelled).
--
-- #7513 called every digit a plot code, so its re-parse (dealapp-repair, plot_code_districts) rejected NUMBERED districts
-- the page states — «حي الناصرية 4» (426903), «حي الياسمين1» (520500) — and wrote the title's district instead:
-- «الناصرية» → «الشواجرة» / «ضاحية الملك عبدالله». The run was cancelled at 13:14 UTC after 100 rows; 29 changed.
-- 14 of those 29 really were plan/plot words («مخطط الحفل», «حي مخطط ال بلحي», «حي ج») and keep the title's district
-- under the corrected rule (_is_plot_code: «مخطط», «رقم», 3+ digits, or a digit not after a 3+ letter name). These 15
-- were real districts and get back exactly the district they served before the run (search_listings_ar, read 13:16:24
-- UTC, before the 13:22 sync). Each row changes only if it still holds the value the run wrote.
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare n int;
begin
  update public.dealapp_residential_listings d
     set neighborhood = v.served_before
    from (values
      (1291392, 'حي الياسمين', 'الرفيعة'),
      (2207643, 'حي المسميات', 'الفيصلية'),
      (6201970, 'حي الشبيلية', 'بدر'),
      (7049631, 'الناصرية', 'الشواجرة'),
      (7049632, 'الناصرية', 'ضاحية الملك عبدالله'),
      (7049640, 'الناصرية', 'ضاحية الملك عبدالله'),
      (7049647, 'الناصرية', 'ضاحية الملك عبدالله'),
      (7056874, 'الخالدية', 'المودة'),
      (7059074, 'الناصرية', 'ضاحية الملك عبدالله'),
      (7059287, 'القدس', 'ضاحية الملك عبدالله'),
      (7059446, 'الأندلس', 'ضاحية الملك عبدالله'),
      (7059590, 'النزهه', 'لزمة'),
      (7059598, 'حكومي', 'الموسى فيو'),
      (7059686, 'حي الفويلق', 'بقعاء الشرقية'),
      (7059782, 'الشاطئ', 'الخالدية')
    ) as v(id, served_before, written_by_run)
   where d.id = v.id and d.neighborhood = v.written_by_run;
  get diagnostics n = row_count;
  if n <> 15 then raise exception 'PROOF: expected to restore 15 rows, restored % (a crawl changed some since 13:16)', n; end if;
  raise notice 'restored % dealapp districts', n;
end $$;
