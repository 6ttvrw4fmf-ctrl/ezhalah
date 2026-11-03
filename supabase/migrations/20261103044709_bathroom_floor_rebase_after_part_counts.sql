-- BATHROOM FLOORS RE-MEASURED AFTER THE READER STOPPED STORING PART-COUNTS (backlog 1168).
-- The floors (migration bathroom_coverage_floor) were taken on 2026-11-02 while the word reader still stored the FIRST
-- count of an ad that lists bathrooms per floor / per unit — «الأرضي: دورتان مياه … الأول: دورة مياه … الملحق: دورة مياه»
-- read as 2. PR 10009 made such ads store nothing (the source never states a total: silent → NULL). Measured on 2026-11-03
-- after the re-read: dealapp lost 2,324 such counts (45.1 → 41.2 %); a 40-ad random sample of them was read by hand and
-- every one listed bathrooms per part (villa floors, a second flat, maid / driver bathroom, two units in one ad), so each
-- removed value was an undercount, not a lost fact. Same rule as before — each site's served apartment coverage minus 3
-- points — re-applied to the corrected numbers; the detector itself is unchanged.
update public.ops_bathroom_coverage_floor f
   set floor_pct = greatest(0, c.pct - 3), measured_pct = c.pct, measured_at = now()
  from (select platform, round(100.0 * count(*) filter (where bathrooms > 0) / count(*), 1) pct
          from public.search_listings_ar
         where production_ready and type_ar = 'شقة'
         group by platform having count(*) >= 500) c
 where c.platform = f.platform;
