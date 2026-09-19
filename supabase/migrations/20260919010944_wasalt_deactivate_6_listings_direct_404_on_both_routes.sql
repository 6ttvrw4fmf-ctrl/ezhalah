-- Six wasalt listings are DEAD on wasalt.sa yet still active=true AND present in
-- search_listings_ar, so a user can open them and get a 404.
--
-- EVIDENCE (direct, per the LISTING_LIVENESS.md contract's own definition — we fetched THIS
-- listing's own URL and the source answered). Probed TWICE on 2026-09-19 through a headed
-- Chromium (scrapers/wasalt/browser.py, the transport that actually reaches wasalt.sa):
--   /ar/property/{slug} -> Next.js page:"/404", propertyDetailsV3 null
--   /en/property/{slug} -> Next.js page:"/404", propertyDetailsV3 null
-- Gone on BOTH language routes. For contrast, a control listing on the same probe returned a
-- complete payload on both, so this is not a transport artefact.
--
-- WHY THE SANCTIONED SWEEP CANNOT DO THIS ITSELF (the root cause, fixed separately):
-- .github/workflows/wasalt-liveness.yml has no schedule (a deliberate ~700GB/month cost guard),
-- and even when dispatched it runs scrapers.aqar.liveness, which fetches through
-- scrapers/common/http.py -> curl_cffi Session(impersonate="chrome124") + the Saudi residential
-- proxy. That is precisely the combination wasalt.sa has null-routed since 2026-08-17 (issue
-- #1019) — the same wall PR #3129 fixed for the sweep and PR #3140 for the AR enricher. Liveness
-- is the third consumer of the blocked transport and was never migrated. So every wasalt read is
-- UNKNOWN, UNKNOWN never strikes, and no wasalt row can EVER reach the 3-strike grace. These six
-- would have stayed active and searchable forever.
--
-- HONESTY NOTE: this is a manual, evidence-backed repair, NOT a grace-window kill. The reason
-- recorded below says so explicitly rather than forging "strikes=3/3" — the grace mechanism did
-- not run, a human-directed direct probe did. missing_count is raised to the grace value so the
-- deactivated row is internally consistent for monitoring, and the audit row carries the real
-- provenance.

-- 1. Per-row liveness evidence, in the same table the pilot sweep writes to.
insert into public.wasalt_liveness_pilot_detail
  (run_at, tbl, listing_id, head_status, get_status, get_verdict, has_property_details, nbytes)
select now(), 'wasalt_residential_listings', id, 404, 404, 'dead', false, 0
from public.wasalt_residential_listings
where id in (10882468, 11386318, 11677784, 11885924, 11890056, 11891280)
  and active = true;

-- 2. Auditable deactivation reason, matching the shape the cleanup path already writes.
insert into public.cleanup_deletion_log
  (platform, source_table, listing_id, ad_number, listing_url, reason, deleted_at)
select 'wasalt', 'wasalt_residential_listings', id, ad_number, listing_url,
       jsonb_build_object(
         'verdict', 'dead',
         'http_status', 404,
         'evidence', 'direct',
         'routes_probed', jsonb_build_array('ar', 'en'),
         'both_routes_404', true,
         'method', 'manual_evidence_backed_repair',
         'grace_window_ran', false,
         'missing_count_before', coalesce(missing_count, 0),
         'probe_tool', 'scrapers/wasalt/browser.py headed Chromium, probed twice 2026-09-19',
         'why_sweep_could_not', 'wasalt liveness is unscheduled AND runs on the curl_cffi chrome124 + Saudi-proxy transport null-routed by wasalt.sa since 2026-08-17 (issue #1019), so every read is UNKNOWN and no row can reach grace'
       ),
       now()
from public.wasalt_residential_listings
where id in (10882468, 11386318, 11677784, 11885924, 11890056, 11891280)
  and active = true;

-- 3. The repair itself. `and active = true` keeps this idempotent and stops it touching a row
--    something else has already retired.
update public.wasalt_residential_listings
set active = false,
    missing_count = greatest(coalesce(missing_count, 0), 3)
where id in (10882468, 11386318, 11677784, 11885924, 11890056, 11891280)
  and active = true;
