-- 🦅 Falcon, 2026-10-16 (backlog 316). Two ialqarawi Buy ads served at «0 ر.س»: ids 556 and 557 (rows 12591255,
-- 12593589). The crawl's own record of the page: «سعر السوم» = 0 (the current bid on an ad nobody has bid on) and
-- «سعر الحد» = «على السوم» (open to offers). The office states no price, so the row is price-on-request: NULL,
-- never 0 (PRICE = SOURCE; a 0 bid is not a price). Code fix in scrapers/ialqarawi/run.py, same PR.
-- Gated to exactly that evidence; measured before: 2 rows, 0 elsewhere. Watched by mon_detect_zero_price_served
-- (open since 09-21 on these two plus the six bossbih rows repaired earlier today), run below.
update public.ialqarawi_residential_listings
   set price_total = null
 where price_total = 0
   and additional_info->>'som_price_raw' = '0'
   and additional_info->>'limit_price_raw' in ('على السوم', 'ع السوم', 'علي السوم');

do $proof$
declare r int;
begin
  r := (select count(*) from public.ialqarawi_residential_listings where price_total = 0 and active);
  if r <> 0 then raise exception 'PROOF: % ialqarawi row(s) still at price_total 0', r; end if;
  perform public.mon_detect_zero_price_served();
end
$proof$;
