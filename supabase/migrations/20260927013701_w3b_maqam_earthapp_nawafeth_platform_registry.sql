-- platform_registry rows for wave 3b (2026-09-27): maqam, earthapp, nawafeth. (opensooq, mobasher, muajarh and
-- nafithh were onboarded in parallel by wave-3 batch 4, #4735, and are registered there.) Each note records what was MEASURED — the live
-- count, not the roster's claim — and the traps that would have mis-onboarded the platform.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('maqam', 'active', 'source', 24, 7,
   'شركة مقام للتطوير العقاري (maqamco.sa) — NOT «مقام الوسام» (fahadalshahri). maqamco.sa is a '
   'marketing site; listings are the Nuzul tenant at property.maqamco.sa, API '
   'maqamco.nzl-backend.com/api/public/properties (meta.total 130) with Origin header. Built on the '
   'shared goldendeal Nuzul engine. TRAPS: (1) only availability_status=available is a listing '
   '(130 = 50 available, 59 sold, 10 unavailable, 7 reserved, 4 rented). (2) is_wafi_ad / '
   'wafi_license_number = off-plan sale licence → excluded (3). (3) exact fractional areas '
   '(204.44). Measured 2026-09-26: 47 kept, all residential Riyadh.'),
  ('earthapp', 'active', 'source', 24, 7,
   'تطبيق أرض (earthapp.com.sa) — listings in a SPA at map.earthapp.com.sa over '
   'earthapp.com.sa/api/offer-list-by-area (pagination.total 54, server-filtered to active + '
   'unexpired REGA). TRAPS: (1) the field `price` is labelled «سعر المتر» by the site itself and '
   'total_price = price × space is the SITE''s product — never stored; land is per-m² (owner rule: '
   'per-m² × area is the shown total). (2) ~9 of 54 agents typed a WHOLE price into the per-m² box '
   '(a hotel reads 150,000,000/m²): non-land above 50,000 is a total; land above 50,000/m² is '
   'skipped as ambiguous (3); a non-land RENT is refused (the field cannot say which it is). (3) no '
   'listing photos exist — user_image is the agent avatar. Measured 2026-09-26: 51 kept.'),
  ('nawafeth', 'active', 'source', 24, 7,
   'نوافذ الوطن (nawafethalwatan.com), ASP.NET MVC; listing is an antiforgery-token POST '
   '(Home/FilterAdvertisment) walked until hasMoreAds=0. TRAPS: (1) there is NO deal field — sale or '
   'rent is read only from a title word, and 11 of 20 state neither (or both, #169) → skipped, never '
   'guessed; «الربيع» must not read as «بيع». (2) «سعر الوحدة» is per m² for land, a total otherwise. '
   '(3) «عدد الغرف» is total rooms (an office shows 150), never bedrooms. Measured 2026-09-26: 9 kept.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('maqam','earthapp','nawafeth')
     and status = 'active' and kind = 'source';
  if n <> 3 then
    raise exception 'expected 3 active source rows for wave 3b, found %', n;
  end if;
  raise notice 'wave 3b (maqam, earthapp, nawafeth) registered active+source';
end $verify$;
