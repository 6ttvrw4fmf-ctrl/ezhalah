-- district_contradicts_source stops reading two correct cases as contradictions (2026-10-30).
--
-- Measured 2026-10-30: 39 open P1 alarms covering 1,889 served listings. Re-read against the source:
--   • 963 were SPELLING: the source's own word, run through our display rule (loc_display_district_ar: alias →
--     canonical catalog spelling), is exactly the district we show — «المعيزيلة» → «حي المعيزلة» (684),
--     «القرينة» → «حي القرينية» (133), «اشبيليا» → «حي اشبيلية». Same place; the Filter finds it.
--   • 920 were AQAR'S OWN ADDRESS: Aqar's neighborhood field carries a broad area («حي الدرعية الجديدة», «مخطط الدخل
--     المحدود», a town written as its own district) while the ad's own address — the listing URL, «…شارع-العماريه-289-
--     حي-مزارع-وادى-العماريه-مدينة-…» — names the exact district, which is what we show. SOURCE IS TRUTH both ways.
-- 6 genuine contradictions remain (dealapp, mustqr, aqarmonthly) and keep the alarm open.
--
-- Not a weakening: a listing is excused only when our display of a word THE SOURCE PUBLISHED equals what we show;
-- a district the source never wrote anywhere still fires.

create or replace view public.mon_district_contradicts_source as
 SELECT s.source_table,
    s.listing_id,
    s.platform,
    s.city_ar,
    sd.source_district_ar AS source_says,
    s.district_ar AS we_display
   FROM search_listings_ar s
     JOIN listing_source_district_ar_fleet sd ON sd.source_table = s.source_table AND sd.listing_id = s.listing_id
  WHERE s.district_ar IS NOT NULL AND norm_district_tok(s.district_ar) <> norm_district_tok(sd.source_district_ar)
    AND POSITION((norm_district_tok(s.district_ar)) IN (norm_district_tok(sd.source_district_ar))) = 0
    AND POSITION((norm_district_tok(sd.source_district_ar)) IN (norm_district_tok(s.district_ar))) = 0
    AND NOT (district_hajar_ordinal(s.district_ar) IS NOT NULL AND district_hajar_ordinal(s.district_ar) = district_hajar_ordinal(sd.source_district_ar))
    AND regexp_replace(norm_district_tok(s.district_ar), '\s'::text, ''::text, 'g'::text) <> regexp_replace(norm_district_tok(sd.source_district_ar), '\s'::text, ''::text, 'g'::text)
    -- spelling: the source's word, displayed by our own rule, IS the district we show (2026-10-30)
    AND NOT COALESCE(loc_display_district_ar(s.city_id, sd.source_district_ar) = s.district_ar, false)
    -- Aqar: the ad's own address (listing URL) names the district we show (2026-10-30)
    AND NOT (s.platform = 'aqar' AND EXISTS (
          SELECT 1 FROM (SELECT id, listing_url FROM aqar_residential_listings WHERE s.source_table = 'aqar_residential_listings'
                         UNION ALL
                         SELECT id, listing_url FROM aqar_commercial_listings WHERE s.source_table = 'aqar_commercial_listings') a
           WHERE a.id = s.listing_id
             AND loc_display_district_ar(s.city_id, aqar_address_district(a.listing_url)) = s.district_ar));

-- Apply-time proof on real rows (cheap — the full view takes ~11 s and runs in the half-hourly sweep): the
-- spelling case and the Aqar-address case are excused by exactly the predicate the view uses.
do $chk$
declare r record;
begin
  select s.city_id, s.district_ar into r from public.search_listings_ar s
   where s.source_table = 'aqar_residential_listings' and s.listing_id = 831510;
  if r.city_id is not null and public.loc_display_district_ar(r.city_id,
       public.aqar_address_district((select listing_url from public.aqar_residential_listings where id = 831510))) is distinct from r.district_ar then
    raise exception 'Aqar 831510: its own address does not display as the served district %', r.district_ar;
  end if;
  select s.city_id, s.district_ar into r from public.search_listings_ar s
    join public.listing_source_district_ar_fleet sd using (source_table, listing_id)
   where sd.source_district_ar = 'المعيزيلة' and s.district_ar = 'حي المعيزلة' limit 1;
  if r.city_id is not null and public.loc_display_district_ar(r.city_id, 'المعيزيلة') is distinct from 'حي المعيزلة' then
    raise exception 'spelling: المعيزيلة does not display as حي المعيزلة in city %', r.city_id;
  end if;
end
$chk$;
