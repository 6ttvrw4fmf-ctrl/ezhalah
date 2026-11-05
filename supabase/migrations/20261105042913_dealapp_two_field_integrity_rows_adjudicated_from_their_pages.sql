-- The last two field_integrity rows on dealapp_residential_listings, adjudicated by reading each ad's own page
-- (2026-11-05 ~04:35 UTC, built-in Chromium).
--
-- dealapp 24071630 (DA620694, yearly rent 554,113,966 — a 05x phone shape) — GONE AT SOURCE. https://dealapp.sa/ar/ad-details/620694
-- redirects to /ar/tabs/home with no ad (dealapp's own «redirected_away» removal signal, liveness_policies.py),
-- read twice (with and without ?market_place_ad=true). Positive control in the same session: 621431 rendered its ad.
-- Registered in ops_adjudicated_retraction so auto_recover_false_inactive() cannot switch it back on.
--
-- dealapp 24105764 (DA621431) — SOURCE-PUBLISHED, recorded, never repriced (owner 2026-11-03: a source typo stays served
-- exactly as the page shows it). The live page shows «111,111,111,111 إيجار سنوي», «سعر المتر 246,913,580.25 ريال» over 450 m².

insert into public.cleanup_deletion_log (platform, source_table, listing_id, ad_number, listing_url, reason, deleted_at)
select 'dealapp', 'dealapp_residential_listings', id, ad_number, listing_url,
       jsonb_build_object('verdict','dead','evidence','direct','signal','redirected_away to /ar/tabs/home','reads',2,
         'positive_control','https://dealapp.sa/ar/ad-details/621431 rendered live','method','manual_evidence_backed_repair',
         'probe_tool','Claude desktop built-in Chromium, 2026-11-05','missing_count_before',coalesce(missing_count,0)),
       now()
from public.dealapp_residential_listings where id = 24071630 and active = true;

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'dealapp_residential_listings', id,
       'gone at source: the ad page redirects to the dealapp home page with no ad, read twice, live control renders',
       jsonb_build_object('url', listing_url, 'signal', 'redirected_away', 'reads', 2, 'positive_control', 'dealapp 621431 live', 'read_at', '2026-11-05T04:35Z')
from public.dealapp_residential_listings where id = 24071630 and active = true
on conflict do nothing;

update public.dealapp_residential_listings
   set active = false, deactivated_at = now(), missing_count = greatest(coalesce(missing_count,0), 3)
 where id = 24071630 and active = true;

delete from public.search_listings_ar where source_table = 'dealapp_residential_listings' and listing_id = 24071630;

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
values ('dealapp_residential_listings', 24105764,
        'live ad page https://dealapp.sa/ar/ad-details/621431 read 2026-11-05: «111,111,111,111 إيجار سنوي», «سعر المتر 246,913,580.25 ريال», 450 m² — the source''s own figure (PRICE = SOURCE)',
        now())
on conflict (source_table, listing_id) do nothing;