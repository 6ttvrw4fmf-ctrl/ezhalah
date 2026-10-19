-- The thirty-five new platforms join platform_registry and the liveness registry, and dwelleo is
-- UN-RETIRED (owner decision 2026-09-24).
-- Lands together with scrapers/common/liveness_policies.py and sql/mirrors/liveness_registry.json:
-- the drift gate is GLOBAL and fail-closed, so a migration applied without its two mirrors blocks
-- EVERY deploy in the repo, for every session, until they catch up. The full-registry reseed
-- verify-liveness-registry-mirror.ts reads is …_reseed_liveness_registry_with_the_thirty_five_platforms,
-- applied right after this one.
--
-- No CREATE OR REPLACE here: two INSERTs into existing tables plus one UPDATE. All three tables were
-- introspected live, read-only, 2026-09-24 15:02 UTC: ops_liveness_registry held exactly the 69 rows
-- of the committed JSON mirror (same strategy/sla/grace on every one), platform_registry held none of
-- the thirty-five, and none of the tables carries a trigger.
--
-- DWELLEO IS A RETIRED PLATFORM COMING BACK (20260810124110 formalised the 2026-06-23 removal; the
-- owner overrode the reason on 2026-09-24 — recorded in scrapers/dwelleo/run.py's docstring). What
-- exists today: ONE row, platform_cadence (is_active=false, expected_hours=24, note «retired
-- (formalized 2026-08-10)…»). platform_registry and ops_liveness_registry have NO dwelleo row and its
-- old dwelleo_* tables were dropped. So: platform_cadence is UPDATED to active with the note the
-- owner asked for, and the two missing rows are INSERTED below like any other platform's. The
-- platform_registry insert is `on conflict (platform) do update` — NOT #3516's `do nothing`:
-- scrape_runs carries trg_auto_register_platform → mon_auto_register_platform, which inserts
-- (platform, 'active', 24, kind) with NULL notes on a platform's FIRST begin_run, so a platform
-- dispatched before this file lands would otherwise keep NULL notes / the default window_days and
-- the oracle notes below would never land. The update touches only the thirty-five rows in the
-- VALUES list. APPLY ORDER still holds: this file lands before the first dispatch.
--
-- EVERY ONE OF THE THIRTY-FIVE PRUNES ONLY THROUGH A MEASURED ORACLE. Each run.py hands
-- db.prune_unseen a verify_gone= callable (grep: every one of the 35 call sites passes it), so a row
-- at grace gets a DIRECT re-fetch of its own record and only an affirmative source answer may
-- deactivate it; every UNKNOWN shape (401/403/429/5xx, timeout, empty body, unresolved redirect)
-- holds the strike. That is the file's own definition of CANDIDATE_PLUS_DIRECT (the tier corrected
-- 2026-09-21 by 20260921203203: the tier grades the MECHANISM; coverage is measured separately by
-- pct_verified_in_sla). The death signals were measured live while each scraper was built, against
-- that platform's own gone ids with live controls — the REMOVAL ORACLE block of each run.py has
-- the numbers. Seven are worth naming because the obvious policy is wrong for them:
--
--   alrifai / justsa / marksa   *** NOT A 404 *** a gone id answers HTTP 200 with an empty shell /
--                               a not-found sentence / a soft-404 page — the shell, not the status,
--                               is the death.
--   villassa                    a removed record keeps answering, with data.main.status == "0".
--   flow                        the site's own 404 page is served with HTTP 200; __NEXT_DATA__'s
--                               externalRefId decides.
--   albdah                      Django DEBUG: an unknown id is an HTTP 500 DoesNotExist page; any
--                               OTHER 500 is no opinion.
--   sodasyat                    a gone id is a 302 to /search.
--   ebriza / eilmalriyada / jawher / m3tmd / senan / goldendeal / yameen / tamyaz / hazim / snam
--                               the HTML page is a soft-404 shell; the platform's own API record is
--                               the oracle (404 JSON, or a 200 for this id with a non-available
--                               status).
--   dwelleo                     a gone id is an HTTP 422 «The selected id is invalid», not a 404.
--   hasaad                      a 404 counts only with WordPress's own error404 body marker.
--
-- All thirty-five: CANDIDATE_PLUS_DIRECT / 168h / grace 3, the same sla and grace every oracle-guarded
-- small platform carries (liveness_policies.py, tier 3a).
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('dwelleo','CANDIDATE_PLUS_DIRECT',168,3),
       ('aqalemhajer','CANDIDATE_PLUS_DIRECT',168,3),
       ('sakani','CANDIDATE_PLUS_DIRECT',168,3),
       ('shatri','CANDIDATE_PLUS_DIRECT',168,3),
       ('alqasem','CANDIDATE_PLUS_DIRECT',168,3),
       ('fkralemar','CANDIDATE_PLUS_DIRECT',168,3),
       ('wadod','CANDIDATE_PLUS_DIRECT',168,3),
       ('almuteb','CANDIDATE_PLUS_DIRECT',168,3),
       ('aalbarrak','CANDIDATE_PLUS_DIRECT',168,3),
       ('alrifai','CANDIDATE_PLUS_DIRECT',168,3),
       ('sodasyat','CANDIDATE_PLUS_DIRECT',168,3),
       ('hasaad','CANDIDATE_PLUS_DIRECT',168,3),
       ('aqaralriyadh','CANDIDATE_PLUS_DIRECT',168,3),
       ('justsa','CANDIDATE_PLUS_DIRECT',168,3),
       ('snam','CANDIDATE_PLUS_DIRECT',168,3),
       ('jawher','CANDIDATE_PLUS_DIRECT',168,3),
       ('m3tmd','CANDIDATE_PLUS_DIRECT',168,3),
       ('senan','CANDIDATE_PLUS_DIRECT',168,3),
       ('goldendeal','CANDIDATE_PLUS_DIRECT',168,3),
       ('thousand','CANDIDATE_PLUS_DIRECT',168,3),
       ('yameen','CANDIDATE_PLUS_DIRECT',168,3),
       ('ebriza','CANDIDATE_PLUS_DIRECT',168,3),
       ('eilmalriyada','CANDIDATE_PLUS_DIRECT',168,3),
       ('daryusuf','CANDIDATE_PLUS_DIRECT',168,3),
       ('albdah','CANDIDATE_PLUS_DIRECT',168,3),
       ('eydah','CANDIDATE_PLUS_DIRECT',168,3),
       ('tamyaz','CANDIDATE_PLUS_DIRECT',168,3),
       ('hazim','CANDIDATE_PLUS_DIRECT',168,3),
       ('villassa','CANDIDATE_PLUS_DIRECT',168,3),
       ('marksa','CANDIDATE_PLUS_DIRECT',168,3),
       ('rightcompound','CANDIDATE_PLUS_DIRECT',168,3),
       ('livingcompound','CANDIDATE_PLUS_DIRECT',168,3),
       ('azure','CANDIDATE_PLUS_DIRECT',168,3),
       ('expattrusted','CANDIDATE_PLUS_DIRECT',168,3),
       ('flow','CANDIDATE_PLUS_DIRECT',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

-- expected_cadence_hours 24: none of the 35 run.py docstrings states a slower cadence and the
-- manifest names none, so every one is scheduled DAILY (small-sources-sync.yml), like the eleven
-- before them. The owner's standing note for small offices applies: the freshness bar is the
-- cadence, not a volume expectation.
insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('dwelleo','active',24,7,'دويليو (dwelleo.sa). RE-ONBOARDED 2026-09-24 (owner decision; retired 2026-06-23, formalised by 20260810124110 — its old tables were dropped, so it starts empty). Public JSON API api.dwelleo.sa/api/v1/properties, 20/page, ~11,480 rows on ~575 pages, no auth/challenge. A gone id answers HTTP 422 «The selected id is invalid» (or 404); a 200 whose availability is not «available» is gone by status; removals canary-gated.','source',now()),
       ('aqalemhajer','active',24,7,'مكتب أقاليم هجر للخدمات العقارية (aqalemhajer.com). Drupal, ~1,229 listings walked from the full node index (the probe said 0; the real count is 1,229). The office DELETES a node: a themed HTTP 404 «تم بيع العقار أو تأجيرة» (29 of 30 sampled absent ids); status decides a death, the node-id marker a life; canary-gated.','source',now()),
       ('sakani','active',24,7,'سكني (sakani.sa marketplace, rent only). ~282 rental units from the marketplace API. A COLD session draws a Cloudflare challenge on the detail route, so every probe goes through ONE warmed session. A deleted id answers 404 {"message":"not found"}; a 200 whose status left «published» or whose licence purpose is not rent is gone. Absence from the rent catalogue is NOT death.','source',now()),
       ('shatri','active',24,7,'الشاطري للتطوير العقاري (shatrirealestate.com). WordPress/Houzez, ~74 sale listings read from /wp-json/wp/v2/properties. A deleted post answers 404 rest_post_invalid_id; a 401/403/429/5xx or a non-JSON body is no opinion.','source',now()),
       ('alqasem','active',24,7,'القاسم العقارية (alqasem.com.sa). ~29 listings on /property/<slug>/ pages carrying postid-N. An unknown slug answers a REAL HTTP 404 with the not-found title (3/3); 403/429/5xx is no opinion.','source',now()),
       ('fkralemar','active',24,7,'فكر الإعمار (fkralemar.com). ~47 sale offers under /offers/<slug>; the card ribbon IS the status («مباع» = gone, read from this run''s own card map first), and an unknown slug answers a REAL HTTP 404 «404 - لم يتم العثور على الصفحة». No rent period is ever stated.','source',now()),
       ('wadod','active',24,7,'ودود العقارية (wadod.sa). ~33 listings. A rented/sold listing answers HTTP 404 with the site''s own «404 غير متوفر» page (3/3); a live one 200 with «المعلومات الأساسية للعقار».','source',now()),
       ('almuteb','active',24,7,'آل متعب العقارية (almuteb.sa). WordPress, 10 sale listings via the wp/v2 REST record; a missing id answers 404 rest_post_invalid_id. No listing has ever been deleted (the Wayback CDX holds exactly the 10 current URLs); a draft post answers 401 = no opinion.','source',now()),
       ('aalbarrak','active',24,7,'البراك للعقارات (aalbarrak.com). WordPress, ~10 listings via /wp/v2/properties; 3/3 REAL deleted posts (found through the Wayback CDX) answer 404 rest_post_invalid_id; a 200 whose own words carry «تم البيع/تم الايجار» is gone; a draft/trashed post answers 401 = no opinion.','source',now()),
       ('alrifai','active',24,7,'الرفاعي للعقار (alrifai.com.sa). ~21 sale listings on a single-page catalogue. *** NOT A 404 *** a gone id answers HTTP 200 with an EMPTY ~25.6 KB shell (no number, no price; 4/4). The complete single page is the site''s own notion of what is on offer.','source',now()),
       ('sodasyat','active',24,7,'سداسيات العقارية (sodasyat.sa). ~11 sale listings. A gone id answers HTTP 302 Location: /search (4/4); 200 on its own path with the h1 = live; anything else no opinion.','source',now()),
       ('hasaad','active',24,7,'حصاد الاقتصادية للعقارات (hasaadestate.com). WordPress projects with units — row grain is the UNIT, its fate read from its project page: a 404 carrying WordPress''s own <body class="error404 wp-theme-HASAAD"> marker (REQUIRED — a bare 404 from a WAF/CDN says nothing) or the unit absent / «مباع» = gone.','source',now()),
       ('aqaralriyadh','active',24,7,'عقار الرياض (aqaralriyadh.com). WordPress, ~14 monthly-or-longer rentals via the wp/v2 REST record; a gone id answers 404 rest_post_invalid_id (15/15); a 401/403 (a post moved to draft) is no opinion. Prune runs only after a complete, non-limited enumeration.','source',now()),
       ('justsa','active',24,7,'فقط نقطة العقارية (just.sa). ~80 listings. *** NOT A 404 *** a gone id answers HTTP 200 with a not-found sentence and no «تفاصيل سريعة» block; 200 + «تفاصيل سريعة» = live.','source',now()),
       ('snam','active',24,7,'سنام العقارية (snam.sa). ~72 sale units read from GET /api/public/projects/<id>; a unit gone from properties[] or with a status other than «available» is gone. The /ar/properties/<id> page is NOT an oracle (the same app shell answers 200 for anything).','source',now()),
       ('jawher','active',24,7,'جواهر للوساطة والتسويق العقاري (jawher2030.com). ~9 listings from a Laravel API detail route (shared engine with m3tmd and senan): a deleted id answers 404 «No query results for model [App/Models/Property]»; a 200 for this id with any status other than available is gone. The HTML page is a SOFT 404 (200 «Property Not Found»).','source',now()),
       ('m3tmd','active',24,7,'مقر المعتمد (m3tmd.com). Same engine as jawher (shared Laravel API); ~9 sale listings. A gone id answers 404 JSON (3/3); a 200 for THIS id whose availability_status is not «available» is gone; the HTML route soft-404s with 200.','source',now()),
       ('senan','active',24,7,'سنان العقارية (senanrealestate.sa). Same engine as jawher; ~77 sale units. A gone/archived id answers 404 JSON; sold and unavailable units still answer 200 with their status (6/6), so a 200 for THIS unit that is not «available» is gone.','source',now()),
       ('goldendeal','active',24,7,'الصفقة الذهبية العقارية (goldendeal.sa). Next.js front over a multi-tenant nzl-backend API (yameen is the second tenant); ~275 listings, rent quoted monthly/quarterly/semi-annual/annual, daily-only = a nightly let, skipped. A not-served id answers 404 «No query results…»; a 200 whose data.id is this id is live iff status is available. The WEB page cannot be the oracle (a retired id renders the full listing). Canary-gated.','source',now()),
       ('thousand','active',24,7,'1000 العقارية (1000.com.sa/offers). ~105 monthly-or-longer offers. A gone id answers a REAL themed HTTP 404 (~23 KB); a 200 echoing this listing''s own data-listing-id is live. Canary-gated on one live control re-fetched in-run.','source',now()),
       ('yameen','active',24,7,'يمين العقارية (yameen.sa). SAME ENGINE as goldendeal (tenant host meteen.nzl-backend.com — the tenant host is not the site name); ~27 listings. Cross-tenant ids answer 404; a rented id answers 200 with status rented (GONE by status); the web page for a rented id renders the full listing and never says gone.','source',now()),
       ('ebriza','active',24,7,'إبريزة العقارية (ebriza.com.sa). ~207 monthly-or-longer rentals read from the POST detail API. A GONE id still renders the HTML shell with HTTP 200, so THE HTML PAGE IS NOT THE ORACLE — the API answers 404 {"error":"No property found"} (sitemap ids 59/67/68).','source',now()),
       ('eilmalriyada','active',24,7,'علم الريادة الإدارية (eilmalriyada.com). ~303 listings from GET /api/recent/<id>; a gone id serves the bare HTML shell with HTTP 200, so the HTML is not the oracle — the API answers 404 «غير موجود». The sitemap is incomplete (107 API ids absent) and is never the enumeration.','source',now()),
       ('daryusuf','active',24,7,'دار يوسف العقارية (daryusuf.com). WordPress «portfolio» posts (~290) via /wp-json/wp/v2/portfolio/<id>; a gone id answers 404 rest_post_invalid_id; a 200 with a status other than publish is gone. Bilingual label/value facts (عمر العقار / Property Age …).','source',now()),
       ('albdah','active',24,7,'البداح للعقارات (albdah.sa). Plain Django HTML (curl_cffi chrome), ~10 listings. Django DEBUG is on: an unknown id answers HTTP 500 with the DoesNotExist page = gone; 200 + the page''s own «إعلان رقم <id>» = live; any other 500 (DEBUG turned off) = no opinion.','source',now()),
       ('eydah','active',24,7,'الإيضاح (eydah.com). Fully static HTML, 2 sale offers (/offers/EY-NNNN.html), no pagination. A missing offer does NOT 404: a 200 without the RealEstateListing JSON-LD is gone, a 404 is gone; removals additionally canary-gated.','source',now()),
       ('tamyaz','active',24,7,'تمايز العقارية (tamyaz-sa.com). Vite/React SPA backed by /api/properties/<id>; ~9 listings. A gone id answers 404 JSON «العقار غير موجود» (3/3); a 200 with published:false is gone (the UI never shows it). Publishes no ad licence, no age, no street width.','source',now()),
       ('hazim','active',24,7,'حازم (hazim.sa). Base44 low-code SPA, ~6 listings from …/entities/Property/<id>; a gone id answers 404 «not found» (4/4); a 200 with status مباع/مؤجر/محجوز is gone (the crawl skips those on sight); «متاح» is live.','source',now()),
       ('villassa','active',24,7,'فلل (villas-sa.com). ~14 listings. *** NOT A 404 *** a removed record keeps answering with data.main.status == "0" (record otherwise intact) = gone; a 5xx never carries a death, so such a row sits UNKNOWN.','source',now()),
       ('marksa','active',24,7,'مار العقارية (mar-ksa.com). ~10 sale listings. *** NOT A 404 *** a gone id renders the soft-404 shell with HTTP 200 (blank spec cells, the logo as the only slide); catalogue absence alone only SELECTS candidates.','source',now()),
       ('rightcompound','active',24,7,'RightCompound (rightcompound.com). ~254 compound unit types (monthly or longer); residential only — the scraper writes rightcompound_residential_listings alone. A compound that does not exist answers a REAL HTTP 404 (37,821-byte «We could not find that compound»); a unit is gone when its compound 404s or its compound page no longer lists it. Sitemap absence alone is never death.','source',now()),
       ('livingcompound','active',24,7,'LivingCompound (livingcompound.com). WordPress, ~19 compound units (monthly or longer). /?p=<post id> 301s to the property''s own URL when it exists (3/3) and answers a REAL HTTP 404 when it does not (3/3); prune runs only after a complete enumeration with an in-run positive control.','source',now()),
       ('azure','active',24,7,'Azure (azure.sa). 16 compound pages with unit types as rows (monthly or longer); residential only — the scraper writes azure_residential_listings alone. An unknown compound slug answers a REAL HTTP 404; a unit type is gone when its compound 404s or no longer carries it.','source',now()),
       ('expattrusted','active',24,7,'Expat Trusted Housing (expattrustedhousingriyadh.com). Next.js, 43 compounds with unit types as rows (monthly or longer). An unknown slug answers a REAL HTTP 404 with no `property` in pageProps (3/3 vs 43/43 live); a unit type is also gone when its id leaves `residences`.','source',now()),
       ('flow','active',24,7,'Flow (flow.life). Next.js, ~15 monthly-or-longer units. *** NOT A 404 *** the site''s own 404 shell («Oops! Looks like you are a little lost») is served with HTTP 200, so the oracle reads __NEXT_DATA__: externalRefId == fid = live, a readable page without it = gone, no __NEXT_DATA__ = no verdict.','source',now())
on conflict (platform) do update
  set status = 'active', expected_cadence_hours = excluded.expected_cadence_hours,
      window_days = excluded.window_days, notes = excluded.notes, kind = excluded.kind,
      updated_at = now();

-- dwelleo un-retire: the row that exists is UPDATED, never re-inserted.
update public.platform_cadence
   set is_active = true,
       expected_hours = 24,
       note = 're-onboarded 2026-09-24 (owner decision)'
 where platform = 'dwelleo';
insert into public.platform_cadence (platform, expected_hours, note, is_active)
select 'dwelleo', 24, 're-onboarded 2026-09-24 (owner decision)', true
 where not exists (select 1 from public.platform_cadence where platform = 'dwelleo');

do $verify$
declare v_strategy text; p text; n int; v_active boolean; v_note text;
begin
  foreach p in array ARRAY['dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
                           'wadod','almuteb','aalbarrak','alrifai','sodasyat','hasaad',
                           'aqaralriyadh','justsa','snam','jawher','m3tmd','senan',
                           'goldendeal','thousand','yameen','ebriza','eilmalriyada',
                           'daryusuf','albdah','eydah','tamyaz','hazim','villassa','marksa',
                           'rightcompound','livingcompound','azure','expattrusted','flow'] loop
    select strategy into strict v_strategy from public.ops_liveness_registry where platform = p;
    if v_strategy <> 'CANDIDATE_PLUS_DIRECT' then
      raise exception '% landed on the wrong liveness strategy: %', p, v_strategy;
    end if;
    if not exists (select 1 from public.platform_registry where platform = p and status = 'active') then
      raise exception '% is not active in platform_registry', p;
    end if;
  end loop;
  select is_active, note into strict v_active, v_note from public.platform_cadence where platform = 'dwelleo';
  if not v_active or v_note <> 're-onboarded 2026-09-24 (owner decision)' then
    raise exception 'dwelleo is still retired in platform_cadence (is_active=%, note=%)', v_active, v_note;
  end if;
  select count(*) into n from public.platform_registry where status = 'active';
  raise notice 'thirty-five platforms registered, dwelleo un-retired; platform_registry now has % active', n;
end $verify$;
