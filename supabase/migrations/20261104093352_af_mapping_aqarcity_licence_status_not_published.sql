-- alert 6574 af_mapping_unplumbed (🔬 2026-11-04): aqarcity no longer publishes a REGA licence STATUS.
-- Re-read 2026-11-04 from Supabase (net.http_get, HTTP 200, ads 31577 and 31578): the page's licenseData carries
-- adLicenseNumber, creationDate, endDate, brokerageAndMarketingLicenseNumber, isPawned, isConstrained,
-- obligationsOnTheProperty — no status field, and the label «حالة ترخيص الإعلان» appears nowhere. The scraper still
-- reads it (scrapers/aqarcity/run.py) and stores nothing, so 0 of 2,186 active rows carry the key. The mapping is
-- retired the house way (source_location = 'not_captured'), with the evidence in the note; nothing is NULL-filled.
update public.af_platform_mapping
   set source_location = 'not_captured',
       verified_at = now(),
       notes = coalesce(notes, '') || ' | RETIRED 2026-11-04: page licenseData has no status field (ads 31577/31578 re-read, HTTP 200); 0/2,186 active rows carry it.'
 where platform = 'aqarcity' and canonical_key = 'rega_license_status' and source_location = 'additional_info';