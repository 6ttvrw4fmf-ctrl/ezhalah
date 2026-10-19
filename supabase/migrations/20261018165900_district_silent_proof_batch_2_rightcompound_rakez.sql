-- PROVEN-SILENT DISTRICT PROOF ROWS, batch 2 (2026-10-18): rightcompound and rakez pages read after today's fixes.
-- rightcompound: all 256 live compound pages were fetched and parsed by scrapers/rightcompound/run.py itself (JSON-LD
-- PostalAddress.streetAddress, every «X District» sentence, the «About This Compound» text). The compounds below state
-- no district anywhere: the country, the city, a road/exit/landmark/short address, or nothing. Deliberately ABSENT:
-- compounds whose page or own name points at a district we cannot place yet (Aziziyah under الخبر, Rakah north/south,
-- Al Douha, Al Qashlah, Fanateer, Khaldiya, Dana Bay, «Golden Belt area», «Wadi Laban», «Al Waseel», nakheel-village,
-- al-wadi-compounds, mohamadia-compound, sulaimaniah-compound, rahmaniah-compound) — they stay red.
-- rakez: /ar/project/41981/ tags only «جدة» (title «… – جدة»), /ar/project/60273/ only the zone «شمال الرياض» (title
-- «… – الرياض»); neither page has a «حي» anywhere. Rows are excused per listing; a new blank row is not.
set local lock_timeout = '5s';

with c(cohort, slugs, proof) as (values
  ('country', array['riyadh/star-compound', 'khobar/canary-village', 'khobar/compound-in-dammam', 'jeddah/al-najia-compounds', 'jubail/nesma-roots-compound', 'jubail/nesma-village-jubail', 'dhahran/dhahran-residential-tower', 'jubail/garden-estate-compound-jubail', 'khobar/saeed-residential-compound-1', 'riyadh/delta-compounds', 'riyadh/expat-real-estate', 'jeddah/sultan-compound', 'khobar/al-riyadh-compound', 'riyadh/mirage-compound', 'khobar/nouf-compound', 'jeddah/reem-compound', 'riyadh/the-plaza-compound'], 'streetAddress is the country only («KSA» / «Saudi Arabia, Riyadh»); no «X District» sentence; the About text names no district'),
  ('city', array['khobar/loay-compound', 'khobar/al-wadi-village', 'khobar/al-ansary-compound', 'jubail/refan-compound', 'khobar/opal-compound', 'jubail/jubail-views-compound', 'riyadh/expat-realty-properties-riyadh'], 'streetAddress is the city only («Al Khobar», «Jubail», «Riyadh»); no «X District» sentence; the About text names no district'),
  ('road', array['riyadh/dara-village-compound', 'riyadh/antara-residential-compound', 'riyadh/riyadh-compound', 'al-ahsaa/nada-compound', 'riyadh/al-waha-compound', 'riyadh/pearla', 'riyadh/la-casa-compound', 'riyadh/riyadh-homes-by-rafa', 'jeddah/sawary-village', 'riyadh/palm-court-compound', 'riyadh/al-waha-garden-village', 'riyadh/kasb-city', 'khobar/al-rashid-residence-towers', 'khobar/refad-compound', 'khobar/residence-complex', 'khobar/karawan-compound', 'riyadh/del-mar', 'khobar/dana--nada-compounds', 'riyadh/arizona-golf-resort', 'dhahran/euro-village-compound', 'jubail/karawan-jubail'], 'streetAddress is a road, exit, landmark or a short address with no district («King Khalid Branch Road», «Exit 9», «4725 Dhalam Street», «RAYF8343», «3400 Al Thoumamah Rd, King Khalid International Airport»); only the site template «King Abdullah Financial District» sentence, if any'),
  ('no address', array['riyadh/tareen-compound', 'kamis-mushait/green-village', 'riyadh/levels'], 'no streetAddress, or the field holds contact text («call us», a phone number); no «X District» sentence'))
insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof, decided_by)
select 'rightcompound', 'rightcompound_residential_listings', r.id,
       'rightcompound: the compound page states no district (' || c.cohort || ')',
       'compound page HTML via scrapers/rightcompound/run.py compound_facts(): JSON-LD PostalAddress.streetAddress, every «X District» sentence, «About This Compound»',
       '2026-10-18 read, all 256 live compound pages: ' || c.proof || '. Compound: ' || regexp_replace(regexp_replace(r.listing_url, '[#?].*$', ''), '^.*/compounds/', ''),
       'district engineer 2026-10-18 (page read)'
  from c join public.rightcompound_residential_listings r
    on regexp_replace(regexp_replace(r.listing_url, '[#?].*$', ''), '^.*/compounds/', '') = any (c.slugs)
 where r.active and coalesce(r.district_ar, '') = ''
   and not public.district_blank_is_excused('rightcompound', 'rightcompound_residential_listings', r.id);

insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof, decided_by)
select 'rakez', t.tbl, t.id,
       'rakez: the project is tagged with its city or zone only, and its page names no district',
       'project page /ar/project/<id>/: «المدينة:» (the city taxonomy tags), the title''s «– …» tail, any «حي» on the page',
       case t.pid when 41981 then '2026-10-18 read: /ar/project/41981/ «شقق بوفارديا الديار العربية – جدة» — «المدينة: جدة» only; title tail «جدة»; no «حي» on the page'
                  else '2026-10-18 read: /ar/project/60273/ «هيو فلورز الملك عبدالله – الرياض» — «المدينة: شمال الرياض» (a zone) only; title tail «الرياض»; no «حي» on the page' end,
       'district engineer 2026-10-18 (page read)'
  from (select 'rakez_residential_listings' tbl, id, district_ar, active, (additional_info->>'project_id')::int pid from public.rakez_residential_listings
        union all select 'rakez_commercial_listings', id, district_ar, active, (additional_info->>'project_id')::int from public.rakez_commercial_listings) t
 where t.active and coalesce(t.district_ar, '') = '' and t.pid in (41981, 60273)
   and not public.district_blank_is_excused('rakez', t.tbl, t.id);
