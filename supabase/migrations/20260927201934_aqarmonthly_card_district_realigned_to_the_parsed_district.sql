-- The aqarmonthly CARD showed a district the search index disagreed with — «الفرسان الدمام الدمام».
--
-- What a user saw. Real-user test on ezhalah-app.vercel.app 2026-09-21 (إيجار → شهري → الرياض →
-- حي بدر, 105 results): two sa.aqar.fm cards read «بدر الرياض منطقة, الرياض» instead of «حي بدر,
-- الرياض». Measured with the anon key 2026-09-27: 1,352 of 1,801 active rows carried a district with
-- the city and/or an admin marker glued on, and another 256 rows showed no district at all.
--
-- Why the index looked fine. ResultCard renders the RAW scraped district whenever it is already
-- Arabic (owner rule 2026-07-06, src/data/remote.ts: `l.district = /[ء-ي]/.test(rawDistrict)
-- ? rawDistrict : ((ar?.district) || …)`), and that raw value is this table's `neighborhood`
-- column (remote.ts LIST_SELECT → `district: r.neighborhood`). So for an Arabic-raw platform the
-- catalog-canonical index value is never what a user reads. `district_ar` — which
-- listing_native_location_v1 and therefore search_listings_ar are built from — was already correct
-- («حي الفرسان»), which is exactly why every district monitor stayed green while the cards were wrong.
--
-- Root cause, in the scraper. `neighborhood` was filled by map_listing()'s own second parse,
-- re.search(r"حي\s+(\S+(?:\s+\S+){0,2})"), which takes up to three tokens after «حي» with no stop
-- condition. That is the identical corruption test_aqarmonthly_resolve_slug_district_suffix.py
-- pinned for district_ar on 2026-07-21 — the fix then landed in resolve_slug() only, and the column
-- the card actually renders kept the old parse. scrapers/aqarmonthly/run.py now writes ONE parsed
-- value (resolve_slug()'s city-suffix-stripped district, plus the catalog-validated address
-- fallback) into both columns, pinned by
-- scrapers/common/tests/test_aqarmonthly_card_district_is_the_parsed_district.py.
--
-- Why this repair is not an invention. It copies this row's OWN already-stored, already-displayed
-- district_ar into the display column beside it — the same value search_listings_ar has served for
-- this listing all along. No district is filled in from elsewhere, none is renamed, and no city is
-- guessed. The one row whose district_ar is NULL (AQM6095977, whose slug names no district the
-- catalog confirms) has its leftover «الشرق الرياض» cleared: a claim the parser cannot support is
-- an honest NULL, never a kept artifact — and the forward fix alone could not clear it, because the
-- shared upsert drops None keys so they can never overwrite a stored value.
--
-- Rows: 1,658 of 1,801 (1,657 realigned + 1 cleared). Single statement, far under the 25k/batch
-- ceiling this instance needs.
do $mig$
declare n_set int; n_null int;
begin
  update aqarmonthly_residential_listings
     set neighborhood = district_ar
   where district_ar is not null
     and neighborhood is distinct from district_ar;
  get diagnostics n_set = row_count;

  update aqarmonthly_residential_listings
     set neighborhood = null
   where district_ar is null
     and neighborhood is not null;
  get diagnostics n_null = row_count;

  raise notice 'aqarmonthly card district realigned: % rows set from district_ar, % cleared', n_set, n_null;

  if exists (select 1 from aqarmonthly_residential_listings
              where neighborhood is distinct from district_ar) then
    raise exception 'aqarmonthly neighborhood still disagrees with district_ar after the repair';
  end if;
end $mig$;
