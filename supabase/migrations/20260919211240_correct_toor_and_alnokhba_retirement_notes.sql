-- platform_registry.notes for toor and alnokhba are stale/thin. Re-probed 2026-09-19 at the
-- owner's instruction ("a retirement without a proper excuse is a failure"), and the notes a
-- future engineer reads must say what is ACTUALLY true, not what was true in July.
--
-- toor: the filed reason (host IP-blocks) is DEAD — sitemap and every detail page return HTTP 200
-- from a clean egress. It stays retired because toor.ooo rebuilt as an SPA whose public HTML
-- serves ONE SAMPLE LISTING for every PropertyId: 30 different PropertyIds from its own sitemap
-- all returned licence 7201112446 / ref 25316 / area 4944.61 / price 40,000 — ONE distinct listing
-- out of thirty. Its JSON-LD name is the literal placeholder «الاسم». Running it would write 82
-- copies of one fabricated listing. Real data is behind an authenticated API (401 on
-- /api/getProperty*, /api/getPropertyDetails*, /api/property/<id>).
--
-- alnokhba: the filed reason said the domain "lapsed to a parking page". It is now worse and
-- should be stated exactly: alnokhba-services.com is NXDOMAIN — the registry expiry date was
-- 2026-07-07 and the domain has no nameservers at all. No replacement domain was found
-- (alnokhba.sa, alnokhba-re.com, alnokhbaestate.com, alnokhbaaqar.com, alnokhba.com.sa, and
-- alnokhba-services.sa all fail to resolve; alnokhba.com is an unrelated "this website is for
-- sale" parking page on a Trellian range). The office was a small Mecca agency — its 6 retained
-- rows are all مكة, districts النواريه / مخطط العمرة / البحيرات / مخطط باشراحيل, last scraped
-- 2026-06-22.
--
-- BOTH KEEP their platform_registry row and every historical listing row, per the owner's standing
-- rule: a source that fails is still one of our platforms and is never deleted.

update public.platform_registry
   set notes = 'RETIRED, reason CORRECTED 2026-09-19. The original note ("host IP-blocks") is no '
               || 'longer true: sitemap + every detail page return HTTP 200 from a clean egress. '
               || 'It stays retired because toor.ooo rebuilt as an SPA whose public HTML serves ONE '
               || 'SAMPLE LISTING for every PropertyId — 30 different PropertyIds all returned '
               || 'licence 7201112446 / ref 25316 / area 4944.61 / price 40,000 (1 distinct listing '
               || 'of 30), and the JSON-LD name is the placeholder «الاسم». Running it would write '
               || '82 copies of one fabricated listing. Real data sits behind an authenticated API '
               || '(401). Un-retiring needs auth + a parser rewrite, NOT a new egress IP. Verify '
               || 'six PropertyIds yield six DIFFERENT licences before trusting "the site loads".',
       updated_at = now()
 where platform = 'toor';

update public.platform_registry
   set notes = 'RETIRED, reason SHARPENED 2026-09-19. alnokhba-services.com is NXDOMAIN, not a '
               || 'parking page: registry expiry date 2026-07-07, no nameservers. No replacement '
               || 'domain found — alnokhba.sa / alnokhba-re.com / alnokhbaestate.com / '
               || 'alnokhbaaqar.com / alnokhba.com.sa / alnokhba-services.sa all fail to resolve, '
               || 'and alnokhba.com is an unrelated "this website is for sale" parking page. Small '
               || 'Mecca agency; its 6 retained rows are all مكة (النواريه / مخطط العمرة / '
               || 'البحيرات / مخطط باشراحيل), last scraped 2026-06-22. Re-check by resolving the '
               || 'domain: if it ever returns, the scraper in scrapers/alnokhba/ is unchanged.',
       updated_at = now()
 where platform = 'alnokhba';
