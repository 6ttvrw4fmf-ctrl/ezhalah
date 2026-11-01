-- 🔧 Quality & Repair 2026-10-12: the 11 aqar rows aqar_classify_shadow_drift() proves wrong
-- (category PROVEN_WRONG: the listing's OWN raw_city and neighborhood resolve to a real catalog
-- district under a different city than aqar_shadow_resolved serves — e.g. 15117268 raw_city Riyadh,
-- neighborhood حي الحزم, served الدرعية; 32140 Safwa/حي النهضة served القطيف; 147051 Khobar/حي المرجان
-- served الدمام). This is the repair the aqar_proven_wrong_resolution alert itself prescribes, applied
-- to exactly the rows the function returns at apply time (self-guarding): the shadow row, the served
-- search_listings_ar row, and a line in aqar_resolver_log. SOURCE IS TRUTH: every value written is
-- the function's fresh_* reading of the listing's own fields; nothing is guessed.
create temp table _qa_pw on commit drop as
  select * from public.aqar_classify_shadow_drift() where category = 'PROVEN_WRONG';

insert into public.aqar_resolver_log (run_at, id, city_id, district_id, src_table)
select now(), p.id, p.fresh_city_id, null, p.src_table from _qa_pw p;

update public.aqar_shadow_resolved s
   set city_ar_parsed = p.fresh_city_ar,
       region_ar_parsed = p.fresh_region_ar,
       parsed_city_id = p.fresh_city_id,
       today_city = p.fresh_city_ar,
       today_region = p.fresh_region_ar,
       today_city_id = p.fresh_city_id
  from _qa_pw p
 where s.src_table = p.src_table and s.id = p.id;

update public.search_listings_ar l
   set city_ar = p.fresh_city_ar, city_id = p.fresh_city_id,
       region_ar = p.fresh_region_ar, region_id = p.fresh_region_id
  from _qa_pw p
 where l.source_table = p.src_table and l.listing_id = p.id;

do $$
declare n int;
begin
  select count(*) into n from public.aqar_classify_shadow_drift() where category = 'PROVEN_WRONG';
  if n <> 0 then raise exception 'aqar PROVEN_WRONG rows remain after the repair: %', n; end if;
end $$;