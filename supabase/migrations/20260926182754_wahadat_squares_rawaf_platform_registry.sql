-- platform_registry rows for wave 3's first three. Each note records what was MEASURED, including
-- the trap that would have mis-onboarded the platform, so the next engineer does not rediscover it.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values
  ('wahadat', 'active', 'source', 24, 7,
   'وحدات (wahadat.sa). Project→unit new-build marketplace: 100 project pages in the sitemap, each '
   'carrying a full unitsData array inside the Next.js App Router RSC payload (decode '
   'self.__next_f.push([1,"…"]) chunks with json.loads PER CHUNK — a blanket unicode_escape mangles '
   'every Arabic character). Measured over ALL 100 projects: 1,533 units — available 968, reserved '
   '450, sold 115; purpose SALE 100/100; city الرياض 100/100. *** THE ROSTER SAID 103; IT IS 968 *** '
   '— 103 counted project PAGES, not the units inside them. Only status=available is listed, per the '
   'owner''s ready-only rule. TWO TRAPS: category_for_type() takes the CANONICAL ENGLISH type, not '
   'the Arabic word (handing it «دور» returns Commercial for everything, which would have filed every '
   'residential floor as commercial); and «تاون هاوس» is absent from the scrapers'' map_type_exact '
   'although the shipped app maps it to Villa, which would have dropped 30 of 128 measured units. '
   'Also «ڤيلا» is spelled with ڤ (U+06A4) here. BEDROOMS STAY NULL: the payload''s `rooms` is never '
   'labelled as bedrooms, the same trap as tuba/iBaax/villassa. Pages, not the API: robots disallows '
   '/api/ and the per-unit endpoint on pro.wahadat.sa answers 403 unauthenticated.'),
  ('squares', 'active', 'source', 24, 7,
   'شركة المربعات العقارية (squares.com.sa). WordPress `property` CPT on the public REST API; '
   'X-WP-Total=18 matched the 18 rows returned, so one GET is a complete, self-declaring '
   'enumeration. 16 listable (2 «مول» have no type in our taxonomy and are skipped, not forced). '
   '*** THIS SOURCE PUBLISHES NO PRICE *** — verified in the API and by rendering a detail page; '
   'only 3 of 18 descriptions mention any number and those are plot dimensions and street widths as '
   'often as money, so price stays unset rather than being mined out of prose. TYPE: the taxonomy '
   'REST routes are closed (rest_no_route), and the detail page renders sidebar/related term links '
   'too (34 type links across 18 pages), so an id→name map is learned from each page''s FIRST link '
   'and every post is then resolved through its OWN class_list id. DEAL — a bug caught before it '
   'shipped: learning the status term the same way put terms 89 and 90 both on «للبيع» because a '
   'sidebar sale link came first on the single rent post, which would have published this source''s '
   'one rental as a sale. Deal now comes from the listing''s own TITLE (17 للبيع / 1 للإيجار, stated '
   '18/18) cross-checked against the class_list term; they agreed 18/18 and a disagreement skips.'),
  ('rawaf', 'active', 'source', 24, 7,
   'رواف (rawaf.ai). New-build project marketplace: GET /api/deals → 11 projects, '
   'GET /api/deals/<projectId> → that project''s units. *** 215 IS NOT AN INVENTORY; 19 IS *** — the '
   'roster''s 215 is sum(totalUnits), every unit these projects ever contained. Measured across all '
   '11: SOLD 171, NOT_AVAILABLE 25, AVAILABLE 19, which is exactly what the projects'' own '
   'remainingUnits totals and what the homepage prints. Only AVAILABLE is listed. FOUR HAZARDS, all '
   'measured: (1) beta.rawaf.ai is a stale dev host answering 502 on every /api path while nginx '
   'serves the SPA shell — it reads as a dead site and is NOT the production host; the resource is '
   'also called `deals`, not properties/listings/ads. (2) The endpoint alternates between JSON and '
   'XML: it served clean JSON during measurement then began answering application/xhtml+xml with a '
   '<List><item>… body, to plain curl WITH Accept: application/json and to curl_cffi on every '
   'impersonation profile — so run.py parses both. (3) ?page=N is a no-op: every page returns the '
   'SAME 11 projects. (4) A project that fails to serve its units suppresses prune_unseen entirely, '
   'so one bad response cannot retire live stock. BEDROOMS ARE REAL here — the field is literally '
   '`bedroom`, beside separate bathroom/majlis/diningRoom — unlike wahadat/iBaax/tuba.')
on conflict (platform) do update
  set status = excluded.status, kind = excluded.kind,
      expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes;

do $verify$
declare n int;
begin
  select count(*) into n from public.platform_registry
   where platform in ('wahadat','squares','rawaf') and status='active' and kind='source';
  if n <> 3 then
    raise exception 'expected 3 active source rows for wave-3''s first three, found %', n;
  end if;
  raise notice 'wahadat, squares and rawaf are registered active+source';
end $verify$;
