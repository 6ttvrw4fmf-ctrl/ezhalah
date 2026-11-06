-- sanadak 9186075 «فيلا للبيع في اللخبصية غير محدد 10 غرفة» is in سكاكا, منطقة الجوف: the page's own description says
-- «حي الزهور بمدينة سكاكا», its pin is 29.917 N and its postal code 72342 is Al Jouf (source re-read run 42234512291,
-- 2026-11-06 14:31 UTC). The title's «اللخبصية» had been resolved to the Jazan catalog city 17993 (retired 2026-10-26 as
-- a district of صبيا), so the villa was served under منطقة جازان / صبيا with a pin 1,300 km away — alert 13409
-- jazan_label_pin_far_north (🔧 quality-repair engineer, 2026-11-06). One row, source-proven; the district slot on the
-- site reads «غير محدد» and stays NULL.
do $sakaka$
declare n int;
begin
  update public.sanadak_residential_listings x
     set city_id = 2237, region_id = 13, city_ar = 'سكاكا'
   where x.id = 9186075 and x.city_id = 17993;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected exactly 1 sanadak row to re-file, got %', n; end if;
  raise notice 'sanadak 9186075 re-filed to سكاكا / منطقة الجوف';
end $sakaka$;
-- The standing detector that found it watches the SERVED index, so it keeps alert 13409 open until the hourly sync
-- (:22) re-serves this row; running it here records the repair under its guard.
select public.mon_detect_jazan_label_pin_far_north();