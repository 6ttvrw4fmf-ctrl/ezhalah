-- FIVE NEW SOURCES, STAGED (owner order 2026-11-05, in this order): Keller Williams (kwsaudiarabia.com), Almajdiah
-- rentals (almajdiah.com), Asas Makeen (asasmakeen.com), Al Rajhi Development (mrajhi.com.sa), STeam Residence
-- (steam-realestate.com). Rows are stored, NOTHING reaches a customer until the owner says launch
-- (docs/ops/FIVE_SOURCES_LAUNCH.md). The exact Property Finder staging pattern (20261104101815 / 101823 / 102110):
--   * per platform its two listing tables, cloned from aqar_residential_listings INCLUDING ALL, + the four location
--     columns and the three fleet triggers (deactivated_at, hard-delete archive, PII redaction) — and NO anon /
--     authenticated read at all (the launch grants the served column set);
--   * Asas Makeen's off-plan units («طليعة المشرقية», the site's own «بيع على الخارطة» list) in their own table,
--     deliberately NOT named *_listings, so no search arm, detector or sweep that walks listing tables reaches it;
--   * a platform_registry row status 'retired' (+ kind 'source'): the registry's "deliberately out of search scope"
--     value — exempt from the unreachable-table and registry-orphan detectors, kept out of the app's search scope by
--     gen-searchable-tables.ts, and never auto-flipped ('dormant' would self-launch on the first ok crawl).
-- The tables are no arm of listing_native_location_v1 / active_listing_ids_v2, so no row can reach
-- search_listings_ar, map_pins_ar, the loader strip or Trending.
DO $$
DECLARE p text; t text; tbl text;
BEGIN
  FOREACH p IN ARRAY ARRAY['kellerwilliams','almajdiah','asasmakeen','mrajhi','steam'] LOOP
    FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
      tbl := p || '_' || t || '_listings';
      IF to_regclass('public.' || tbl) IS NOT NULL THEN
        RAISE NOTICE '% already exists — left as it is', tbl;
        CONTINUE;
      END IF;
      EXECUTE format('CREATE TABLE %I (LIKE aqar_residential_listings INCLUDING ALL)', tbl);
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', tbl);
      EXECUTE format('CREATE TRIGGER trg_set_deactivated_at BEFORE UPDATE ON %I FOR EACH ROW '
                     'WHEN (old.active IS DISTINCT FROM new.active) EXECUTE FUNCTION set_deactivated_at()', tbl);
      EXECUTE format('CREATE TRIGGER trg_archive_hard_delete AFTER DELETE ON %I FOR EACH ROW '
                     'EXECUTE FUNCTION tg_archive_hard_deleted_listing()', tbl);
      EXECUTE format('CREATE TRIGGER zz_redact_pii BEFORE INSERT OR UPDATE ON %I FOR EACH ROW '
                     'EXECUTE FUNCTION trg_redact_user_visible_pii()', tbl);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    END LOOP;
  END LOOP;
END $$;

create table if not exists public.asasmakeen_offplan_units (
  ad_number      text primary key,
  listing_url    text,
  project        text,
  side           text,
  record         jsonb not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
alter table public.asasmakeen_offplan_units enable row level security;
revoke all on public.asasmakeen_offplan_units from anon, authenticated;

insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes) values
('kellerwilliams', 'retired', 'source', 24, 7,
  'STAGED — NOT LAUNCHED (owner order 2026-11-05; the owner flips it on, docs/ops/FIVE_SOURCES_LAUNCH.md). Keller '
  'Williams Saudi Arabia (kwsaudiarabia.com). Read ONLY from the site''s own list API POST '
  'api.kw-saudiarabia.com/api/listings/list/properties {page,limit} (both robots.txt files are 404). Honest UA '
  '«Ezhalah-bot/1.0», ≤1 req/s, any 401/403/429/503/CAPTCHA stops the run. PRICE = current_list_price; a rent''s '
  'period only when the ad text ties one to the price, else NULL. REGA licence = mls_number (10 digits; 19 ads carry '
  'a KW-internal «MA000…» code instead → no licence). Pins on every ad. PDPL: agent/office/brokerage objects never '
  'stored, phones in the text redacted. Liveness: the complete list (unique ids = total_items) is the check.'),
('almajdiah', 'retired', 'source', 24, 7,
  'STAGED — NOT LAUNCHED (owner order 2026-11-05). Almajdiah (almajdiah.com) RENTALS ONLY; sales ON HOLD (no built / '
  'off-plan marker, no licence). Read ONLY from the public JSON the rental pages call: '
  'etmaam.almajdiah.com/api/client/v1/rental-request?page=N and /rental-request/<project>?page=N (robots: all '
  'allowed). TLS NOTE: almajdiah.com and etmaam.almajdiah.com have valid certificates; WWW.almajdiah.com serves a '
  'SELF-SIGNED certificate for an IP (browsers warn) — stored links use the bare host only. A unit has no page of its '
  'own: its link is its project page almajdiah.com/rentals/<project>?platform=web. PRICE = one_batches_price '
  '(«دفعة»); «دفعتين» + التأمين kept; no period word anywhere → rent_period NULL. Licence = rental_license.'),
('asasmakeen', 'retired', 'source', 24, 7,
  'STAGED — NOT LAUNCHED (owner order 2026-11-05). Asas Makeen (asasmakeen.com), Riyadh apartments, sale + rent. '
  'Read ONLY sitemap-units-ar.xml and the unit pages it lists (robots allows them; /api/ disallowed, never fetched) '
  '+ the two project-status pages «بيع على الخارطة» / «تحت الإنشاء». Off-plan projects (طليعة المشرقية) are stored '
  'in asasmakeen_offplan_units, never a listing. No pin, no REGA licence on any page; the district is the page''s '
  'own «الحي» line; bathrooms exist only as feature lines («3 دورات مياة»). PRICE = .unit-price-current; rent shows no '
  'period → NULL.'),
('mrajhi', 'retired', 'source', 24, 7,
  'STAGED — NOT LAUNCHED (owner order 2026-11-05). Al Rajhi Development & Investment (mrajhi.com.sa), yearly '
  'rentals in Riyadh. Read ONLY sitemap.xml and its /units/<code> pages (robots: Allow /units/, Disallow /api/). '
  '38 of 39 are also on Property Finder: owner 2026-11-05 KEEP BOTH copies. JSON-LD RealEstateListing gives price + '
  '«إيجار سنوي» (period stated). Licence «رقم رخصة الإعلان» on every unit. PDPL: the page''s «أرقام الحراس» block '
  '(a guard''s NAME and mobile) is NEVER read or stored.'),
('steam', 'retired', 'source', 24, 7,
  'STAGED — NOT LAUNCHED (owner order 2026-11-05). STeam Residence / ستيم العربية (steam-realestate.com), rent ads. '
  'Read ONLY property-sitemap.xml and its Arabic /property/<slug>/ pages (robots disallows /wp-json/, /?s=, /search/). '
  'The price field is empty on every ad: 3 ads write a figure only in their description, which is prose and never '
  'read as a price (owner 2026-08-04) → all price on request. No pin, no licence. Phones in the text redacted.')
on conflict (platform) do nothing;

do $verify$
declare p text; t text; tbl text;
begin
  foreach p in array array['kellerwilliams','almajdiah','asasmakeen','mrajhi','steam'] loop
    if not exists (select 1 from public.platform_registry where platform = p and status = 'retired' and kind = 'source') then
      raise exception '% is not registered staged (retired+source)', p;
    end if;
    foreach t in array array['residential','commercial'] loop
      tbl := p || '_' || t || '_listings';
      if to_regclass('public.' || tbl) is null then
        raise exception 'table not created: %', tbl;
      elsif (select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = tbl
                and column_name in ('city_ar','district_ar','city_id','region_id','license_number','license_expiry',
                                    'rent_now_pay_later','photo_urls','additional_info')) <> 9 then
        raise exception '% is missing a location / licence / instalment / photo / facts column', tbl;
      elsif not exists (select 1 from pg_constraint where conrelid = ('public.' || tbl)::regclass and contype = 'u'
                          and pg_get_constraintdef(oid) = 'UNIQUE (ad_number)') then
        raise exception '% has no UNIQUE (ad_number) — the scraper upserts on_conflict=ad_number', tbl;
      elsif (select count(*) from pg_trigger where tgrelid = ('public.' || tbl)::regclass and not tgisinternal
               and tgname in ('trg_set_deactivated_at','trg_archive_hard_delete','zz_redact_pii')) <> 3 then
        raise exception '% is missing a fleet trigger (deactivated_at / hard-delete archive / PII)', tbl;
      elsif has_table_privilege('anon', 'public.' || tbl, 'SELECT')
         or has_column_privilege('anon', 'public.' || tbl, 'ad_number', 'SELECT')
         or has_column_privilege('authenticated', 'public.' || tbl, 'ad_number', 'SELECT') then
        raise exception '% is readable by anon/authenticated — a STAGED platform must not be', tbl;
      end if;
    end loop;
  end loop;
  if to_regclass('public.asasmakeen_offplan_units') is null
     or has_table_privilege('anon', 'public.asasmakeen_offplan_units', 'SELECT')
     or has_table_privilege('authenticated', 'public.asasmakeen_offplan_units', 'SELECT') then
    raise exception 'asasmakeen_offplan_units missing or publicly readable';
  end if;
  raise notice 'five sources: 10 tables + off-plan table present, fleet triggers on, unreadable by anon/authenticated, registry retired (staged)';
end $verify$;
