-- 🦅 Falcon, 2026-10-16. Six bossbih Buy ads served at «0 ر.س» — again, a week after 2026-10-09 cleared them.
--
-- SOURCE (CI source-reread 38963817563, 20:40 UTC today): nids 12209, 13994, 14199, 10372, 14144 and 12210-class
-- «طريق العقير» print a per-metre rate («المتر» 1 / 200 / 4 / 3 / 250 / 16 ريال) and a «الإجمالي» block reading 0
-- — the site multiplying the rate by an EMPTY area field. The parser took that 0 as a published total. It is the
-- calculator, not the ad: the advertiser's price is the rate. Code fix in scrapers/bossbih/run.py (same PR):
-- a 0 site total beside a positive rate is no total, so the row is written AUTHORITATIVE_NULL.
--
-- REPAIR, evidence-gated to exactly that shape (price_total 0, a positive price_per_meter, and the crawl's own
-- recorded site_published_total = 0). Measured before: 3 residential + 3 commercial, 0 elsewhere. NULL, never a
-- guessed total: the search/display layer already derives rate × area when the area is known.
-- Watched by mon_detect_zero_price_served (P1, open since 09-21 on exactly these rows), run below as the proof.
update public.bossbih_residential_listings
   set price_total = null
 where price_total = 0 and price_per_meter > 0 and additional_info->>'site_published_total' = '0';
update public.bossbih_commercial_listings
   set price_total = null
 where price_total = 0 and price_per_meter > 0 and additional_info->>'site_published_total' = '0';

do $proof$
declare r int;
begin
  r := (select count(*) from public.bossbih_residential_listings where price_total = 0)
     + (select count(*) from public.bossbih_commercial_listings where price_total = 0);
  if r <> 0 then raise exception 'PROOF: % bossbih row(s) still at price_total 0', r; end if;
  perform public.mon_detect_zero_price_served();
end
$proof$;
