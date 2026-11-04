-- The last >1,000,000,000 SAR rows of backlog 1261, adjudicated by reading each ad's own page (2026-11-04 ~01:30 UTC,
-- built-in Chromium, read twice).
--
-- wasalt 13734584 (WST5912328) and 14495761 (WST5918862) — GONE AT SOURCE. Both the /en/ and the Arabic route
-- answer the site's own «Error code: 404 / رمز الخطأ: 404» page (the router cannot resolve the ad's purpose and lands
-- on /property/undefined/<slug>). Positive control in the same session: a live wasalt land ad (5949434) opened
-- normally and resolved to /property/rent/<slug>. Own-page proof, two routes, two reads — never age, never absence.
-- Registered in ops_adjudicated_retraction so auto_recover_false_inactive() cannot switch them back on.
--
-- dealapp 2683134 (DA454366) — SOURCE-PUBLISHED, recorded, never repriced. The live ad page shows
-- «1,024,040,000» with «سعر المتر 1,000,000 ريال» over «المساحة 1,024.04 م²» — the site's own figure.

insert into public.cleanup_deletion_log (platform, source_table, listing_id, ad_number, listing_url, reason, deleted_at)
select 'wasalt', 'wasalt_residential_listings', id, ad_number, listing_url,
       jsonb_build_object('verdict','dead','evidence','direct','routes_probed',jsonb_build_array('ar','en'),
         'both_routes_404',true,'reads',2,'method','manual_evidence_backed_repair',
         'positive_control','https://wasalt.sa/en/property/land-7626-sqm-facing-east-5949434 rendered live',
         'probe_tool','Claude desktop built-in Chromium, 2026-11-04','backlog',1261,
         'missing_count_before',coalesce(missing_count,0)),
       now()
from public.wasalt_residential_listings
where id in (13734584, 14495761) and active = true;

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'wasalt_residential_listings', id,
       'gone at source: the ad''s own page answers 404 on both the /en/ and the Arabic route, read twice (backlog 1261)',
       jsonb_build_object('url', listing_url, 'routes', jsonb_build_array('ar','en'), 'http', 404, 'reads', 2,
                          'positive_control', 'wasalt 5949434 live', 'read_at', '2026-11-04T01:30Z')
from public.wasalt_residential_listings
where id in (13734584, 14495761) and active = true
on conflict do nothing;

update public.wasalt_residential_listings
   set active = false, deactivated_at = now(), missing_count = greatest(coalesce(missing_count,0), 3)
 where id in (13734584, 14495761) and active = true;

delete from public.search_listings_ar
 where source_table = 'wasalt_residential_listings' and listing_id in (13734584, 14495761);

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
values ('dealapp_residential_listings', 2683134,
        'live ad page https://dealapp.sa/ar/ad-details/454366 read 2026-11-04: price «1,024,040,000», «سعر المتر 1,000,000 ريال», «المساحة 1,024.04 م²» — the source''s own figure (PRICE = SOURCE; backlog 1261)',
        now())
on conflict (source_table, listing_id) do nothing;

insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
select v.version, 'billion_price_leftovers_wasalt_two_gone_dealapp_source_published',
       'No served price over 1,000,000,000 SAR that no page read has proven; the two wasalt ads proven 404 stay hidden (adjudicated).',
       'mon_detect_served_billion_price_unproven', 'outside engineer 2026-11-04 (author of the repair, backlog 1261)'
from (select max(version) version from supabase_migrations.schema_migrations) v
where false;