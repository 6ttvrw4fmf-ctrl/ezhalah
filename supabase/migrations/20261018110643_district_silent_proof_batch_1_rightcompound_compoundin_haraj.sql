-- PROVEN-SILENT DISTRICT PROOF ROWS, batch 1 (2026-10-18, rendered in a real browser, after today's re-scrapes).
-- Each cohort below was checked on its live page: the fields, the JSON-LD address, the breadcrumb/tag chain and
-- the deed/licence box name NO district. Rows are excused per listing; a new blank row of the same site is not.
-- Cohorts whose page DOES name a place are deliberately absent (they are catalogue/decision work, not silence):
-- rightcompound «Amr Al Damri Street» (JSON-LD «…, Al Safarat»), «Al Malaz» / compoundin «Riyadh» (JSON-LD «Al
-- Malaz», an ambiguous bridge key), «Masud As Salamah» (unverified).

-- rightcompound: the JSON-LD streetAddress is the city or a road/exit with a landmark; no district anywhere.
--   al-ansari-compound-two-al-khobar → «Al Khobar, beside the French school of Khobar»; al-nakhla-residential-resort →
--   «Eastern Ring Road, Exit 8,Behind the Business Gate». Rendered 2026-10-18.
insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof)
select 'rightcompound', t.tbl, t.id,
       'rightcompound: streetAddress is the city or a road/exit + landmark (' || t.neighborhood || ')',
       'rendered compound page: JSON-LD PostalAddress.streetAddress, the Location block, any «X District» sentence',
       '2026-10-18 rendered: al-ansari-compound-two-al-khobar → «Al Khobar, beside the French school of Khobar»; al-nakhla-residential-resort → «Eastern Ring Road, Exit 8,Behind the Business Gate». No district field, sentence or breadcrumb.'
  from (select 'rightcompound_residential_listings' tbl, id, neighborhood, district_ar, active from public.rightcompound_residential_listings
        union all select 'rightcompound_commercial_listings', id, neighborhood, district_ar, active from public.rightcompound_commercial_listings) t
 where t.active and coalesce(t.district_ar, '') = '' and t.neighborhood in ('Al Khobar', 'Exit 8')
   and not public.district_blank_is_excused('rightcompound', t.tbl, t.id);

-- compoundin: the JSON-LD address carries only addressLocality/addressRegion/country, or a road; the site's
--   template line «King Abdullah Financial» is a placeholder, not a statement. canary-vista, canary-village →
--   {Al Khobar, Eastern Province, SA}; azure-qassim → {Buraydah, Al Qassim Province}; al-danah-al-nadah-compounds →
--   «King Faisal Road». Rendered 2026-10-18.
insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof)
select 'compoundin', 'compoundin_residential_listings', c.id,
       'compoundin: JSON-LD address names only the city/region/country or a road (' || c.neighborhood || ')',
       'rendered compound page: JSON-LD PostalAddress (streetAddress/addressLocality/addressRegion), the «living in X» / «X District» line',
       '2026-10-18 rendered: canary-vista and canary-village → addressLocality «Al Khobar», addressRegion «Eastern Province», no street; azure-qassim → «Buraydah», «Al Qassim Province»; al-danah-al-nadah-compounds → streetAddress «King Faisal Road». The «King Abdullah Financial» line is the site template.'
  from public.compoundin_residential_listings c
 where c.active and coalesce(c.district_ar, '') = '' and c.neighborhood in ('King Abdullah Financial', 'Saudi Arabia', 'Al Qassim Province', 'Al Khobar')
   and not public.district_blank_is_excused('compoundin', 'compoundin_residential_listings', c.id);

-- haraj: re-read today by the deed → Haraj-field parser; these rows have no deed «الحي:», no licence-location district
--   and no post-neighborhood anchor on their page (11189224389 صبيا and 11189244522 ضرما rendered 2026-10-18: licence box
--   present, «المدينة:» present, no «الحي:», no neighbourhood anchor; the «حي …» strings on the page are the sidebar).
--   189 of them were already deleted at source and will be retired by liveness; excusing them until then is harmless.
insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof)
select 'haraj', t.tbl, t.id,
       'haraj: no deed «الحي:», no licence-location district, no post-neighborhood anchor (seller prose is never a district)',
       'rendered ad page: REGA licence/deed box lines, data-testid=post-neighborhood anchor, BreadcrumbList (category chain only)',
       '2026-10-18 rendered: 11189224389 (صبيا) and 11189244522 (ضرما) — licence box present, «المدينة:» present, no «الحي:», no neighbourhood anchor; parser re-read of every row today found the same three fields empty.'
  from (select 'haraj_residential_listings' tbl, id, neighborhood, additional_info i, source_capture c, active from public.haraj_residential_listings
        union all select 'haraj_commercial_listings', id, neighborhood, additional_info, source_capture, active from public.haraj_commercial_listings) t
 where t.active and coalesce(t.neighborhood, '') = ''
   and coalesce(t.i->>'haraj_neighbourhood_ar', '') = '' and coalesce(t.c->'deed_fields'->>'الحي', '') = ''
   and not public.district_blank_is_excused('haraj', t.tbl, t.id);