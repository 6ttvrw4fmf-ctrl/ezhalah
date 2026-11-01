-- platform_registry rows for batch 7 (the owner's 15-site list, 2026-09-27). Each note records what was
-- MEASURED, including the traps.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('sirdab', 'active', 'source', 24, 7,
   'سرداب (marketplace.sirdab.co) — Next.js; every list page embeds its ads in the RSC flight payload ("ads":[…], 24/page, totalCount). 564 active (528 rent, 36 sale): warehouse 356, storefront 157, workshop 24, factory 12; storage_yard 9 + self-storage 6 SKIPPED (no honest type). Price = price_in_cents/100 verbatim; <1 SAR placeholders = no price. The «/سنة» after every rent is a constant card label → period via rent_period_from_ad. owner_phone/user_id/building_number never stored.'),
  ('ashab', 'active', 'source', 24, 7,
   'عشاب العقارية (ashab.sa) — Laravel HTML. 447 ads: 309 single + 138 buildings with 1,401 unit cards (/properties/<b>/unit/<u>). One listing per AVAILABLE unit, from the UNIT page''s own header price (the unit page copies the building''s «الحد»). «الحد» = the advertiser''s limit/asking; «السوم» is a buyer''s offer, NEVER the price; «لا يوجد حد» = no price; «4.500000» dotted thousands. Skips: rented/sold/reserved units and «بالكامل» buildings, «استثمار» deals, ambiguous «معارض - محلات», plan-name types. Auctions never walked.'),
  ('manafe', 'active', 'source', 24, 7,
   'منافع العقارية (manafe.com.sa) — Jeddah property manager behind a Cloudflare challenge: chrome/edge profiles 403, firefox133/safari15_5 pass (http.negotiated_session). The index links only 40 of 210 buildings and its «عرض المزيد» is broken → id walk checked against the section counters. Sequential only: parallel load returns a DB-error page (never stored). One listing per available unit row with a REGA ad licence (192 unlicensed rows skipped); a for-sale building = one listing. The default unit type «معارض تجارية» is ignored (building purpose decides). No rent period is ever printed.'),
  ('wajaf', 'active', 'source', 24, 7,
   'وجف العقارية (wajaf.sa) — Buraidah. 41 ads, 7 are subdivisions (مخطط) linking 65 plot/villa pages → 106 pages. «السوم» = buyers'' current best offer, NEVER the price; «الحد» = owner''s limit, per-m² only when the page''s own «سعر المتر» states/matches it; land limit with no unit → NULL (raw kept). Skips: sold 32, reserved 7, let 5, subdivision containers, «أخرى», «شاليه / استراحة», «وحدة سكنية». An unlabelled address number (maybe deed/plan) is never stored.'),
  ('albukaeri', 'active', 'source', 24, 7,
   'البكيري (albukaeri.sa) — server HTML, /properties + /property/<24-hex>. 31 «البيع المباشر», all sale; auctions never requested. No page prints a type — read from the site''s own «نوع العقار» filter (covers all 31). 1 priced (850,000), 27 no price. Facade/street width from the deed boundaries only when exactly one side is a street. Skips: «عمارة سكنية تجارية», «قصر تجاري سكني», «وحدة سكنية» (no exact taxonomy match).'),
  ('ryadah', 'active', 'source', 24, 7,
   'ريادة العقارية (ryadah.com.sa) — WordPress; 36 Arabic property posts (+36 /en/ copies dropped). Every price «عند الاتصال» → NULL; the size field is the whole building''s → area NULL. Each post is a building/compound offering units, kept as one listing. Skips: multiple types in one post, only «سكني», sold, «قريبا», Bahrain, off-plan, title/type conflict. Photos: gallery only (one featured image is another building''s).'),
  ('sqcc', 'active', 'source', 24, 7,
   'مجموعة صالح القرشي العقارية (sqcc.sa) — WordPress CPT realestate (33); auctions are a separate post type (mazadat) never walked. Deal from the site''s «وحدات للبيع»/«وحدات للأيجار» categories; location from the archive card''s «المنطقة» line. Multi-unit ads («250,000 / 270,000», «تبدا من») → price NULL, raw kept. og.jpg is the logo and one stock photo is excluded. «سويتات» skipped (no exact type).'),
  ('daraa', 'active', 'source', 24, 7,
   'دارا للتطوير العقاري (daraa.sa) — 33 Makkah apartment projects; Arabic only with cookie locale=ar (/ar/ 404s). Kept only «جاهزة للإفراغ» and not sold (6); 22 sold, 2 «بيع على الخارطة», 3 still being built skipped. No page lists units or a price → one listing per ready project, price NULL. City Makkah only when the page has its own «المسافة إلى الحرم المكي» field.'),
  ('tawia', 'active', 'source', 24, 7,
   'مكتب طوية للعقار (tawia.sa) — Next.js; JSON-LD per detail page + the RSC payload for photos/deal/type/floor. 5 in Jubail (4 rent, 1 sale). Two rents state «الإيجار السنوي»; two state only payment options («20,500 دفعة واحدة أو 11,250 كل 6 أشهر») → period NULL, options text kept. No REGA ad licence shown; the FAL number goes to additional_info; phone/email never read.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('sirdab','ashab','manafe','wajaf','albukaeri','ryadah','sqcc','daraa','tawia') and status = 'active' and kind = 'source';
  if n <> 9 then
    raise exception 'expected 9 active source rows for batch 7, found %', n;
  end if;
  raise notice 'batch 7 is registered active+source';
end $verify$;