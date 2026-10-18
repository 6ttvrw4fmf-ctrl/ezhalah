-- 2026-10-18. KSAAQAR: `neighborhood` HOLDS ONLY A DISTRICT THE PAGE STATES. Data half of #7511 (scraper half:
-- scrapers/ksaaqar/run.py neighborhood_word()).
--
-- When the catalog has no match, the index carries a platform's `neighborhood` to the card and to the Filter's
-- district list as the source's word (20261018081657, 20261018083435). ksaaqar stored its raw MAP LINE there: the
-- pin's label, i.e. the ad's title, the site's category, the country, or a Google plus code. Measured 12:27-12:32 UTC:
-- 162 live rows served a carried map line as their district («المملكة العربية السعودية», «فلل فاخرة للبيع بدون دفعه
-- مق», «عقارات جدة JIJB», «شقه ايجار في الرياض 1»), 28 rows held a plus code (12226888 «عقارات الدمام 8Q9H+JHH»,
-- whose title says «حي القصور، الظهران»; the bare code resolves to Kirkuk, Iraq), and one «الموقع:» field read
-- without its «_» separators held 300 characters of page, the review box included.
--
-- The shared upsert never writes a None, so the scraper fix alone cannot clear a stored value; this does. Cleared: a
-- plus code anywhere; or, where the catalog gave no district (district_ar is null), any value that is not a
-- self-named «حي X» (Arabic words only, as neighborhood_word() keeps). Measured 12:33 UTC: 165 of 861 rows.
-- A stated «حي X» the catalog lacks stays (35 rows): that is the source's word. The ksaaqar re-scrape that follows
-- writes the pin label to additional_info.map_line as the fact it is.
set local statement_timeout = '120s';
set local lock_timeout = '5s';

do $$
declare
  pc constant text := '(^|[^A-Z0-9])[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}([^A-Z0-9]|$)';
  hayy constant text := '^حي\s+[ء-ي][ء-ي\s]{1,30}$';
  n_res int; n_com int; v_left int;
begin
  update public.ksaaqar_residential_listings set neighborhood = null
   where neighborhood is not null and (neighborhood ~ pc or (district_ar is null and neighborhood !~ hayy));
  get diagnostics n_res = row_count;
  update public.ksaaqar_commercial_listings set neighborhood = null
   where neighborhood is not null and (neighborhood ~ pc or (district_ar is null and neighborhood !~ hayy));
  get diagnostics n_com = row_count;

  -- PROOF: nothing the rule rejects is left, and the count is the one measured (a wider WHERE would show here).
  select count(*) into v_left
    from (select neighborhood, district_ar from public.ksaaqar_residential_listings
          union all select neighborhood, district_ar from public.ksaaqar_commercial_listings) k
   where k.neighborhood is not null and (k.neighborhood ~ pc or (k.district_ar is null and k.neighborhood !~ hayy));
  if v_left <> 0 then raise exception 'PROOF: % ksaaqar neighborhoods still fail the rule', v_left; end if;
  if n_res + n_com not between 150 and 200 then
    raise exception 'PROOF: expected ~165 cleared (measured 12:33 UTC), cleared % + %', n_res, n_com;
  end if;
  raise notice 'ksaaqar neighborhood cleared: % residential + % commercial', n_res, n_com;
end $$;
