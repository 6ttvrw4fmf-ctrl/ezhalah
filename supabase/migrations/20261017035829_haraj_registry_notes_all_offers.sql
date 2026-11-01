-- Owner 2026-10-17 reversed 10-16's «licensed only»: Haraj lists ALL real-estate offers. The registry note says
-- what the crawler now does, so no engineer reads the old rule as current.
update public.platform_registry
   set notes = 'حراج (haraj.com.sa) — public classifieds; the حراج العقار posts that scrapers/haraj/classify.py calls an OFFER '
            || '(requests, jobs, cars, furniture, «تقبيل», broker catalogues and doubt never stored). Owner 2026-10-17: ALL offers, '
            || 'licensed or not (10-16 had been licensed-only). WITH REGA''s block «معلومات العقار حسب الرخصة»: every licence field, '
            || 'licence number + expiry stored, an expired licence never listed. WITHOUT it: type/deal from the seller''s own words, '
            || 'city = the post''s addressLocality through the resolver, price only a figure tied to a price word (bid «السوم» = no '
            || 'price), area only an area phrase, district only «حي X» in the catalogue; licence NULL; a plural unit word = catalogue, '
            || 'not stored. Discovery = hourly sitemap .txt files (honest UA, ≤1 req/s); a STREAM, never pruned on absence; removal = '
            || 'own-page proof (404/410, «العرض محذوف او قديم», a licensed ad''s licence expired). PDPL: no names, phones, advertiser no.'
 where platform = 'haraj';

do $verify$
begin
  if not exists (select 1 from public.platform_registry where platform = 'haraj' and notes like '%ALL offers%' and status = 'active') then
    raise exception 'haraj registry note not updated';
  end if;
end $verify$;