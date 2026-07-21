-- Backfill for the already-corrupted rows behind fix/aqarmonthly-district-city-suffix-corruption
-- (the CODE fix, in scrapers/common/arabic_location.py, only stops NEW corruption going forward).
--
-- Source of truth: aqarmonthly_residential_listings.district_ar feeds listing_native_location_v1 ->
-- listing_native_location_v2 -> sync_search_listings_ar() (pg_cron jobid 28, hourly), which
-- unconditionally overwrites search_listings_ar.district_ar on every sync. Fixing ONLY
-- search_listings_ar would be silently reverted by the next hourly sync -- both tables are updated
-- here, in the same transaction, so they can never disagree even for the ~45 minutes until the next
-- sync tick.
--
-- Correction logic (byte-for-byte the same algorithm as the Python fix, re-verified independently in
-- SQL against all 6 known corruption shapes + 2 additional edge cases found during dry-run review --
-- a Makkah/Madinah-style official 2-word city name abbreviated to its first word in the slug, and
-- tatweel/hamza-form spelling variants): strip a TRAILING run of tokens that are either the row's own
-- (normalized) city name, its first word alone, or a known admin marker (امارة/منطقة) -- never a
-- leading token, so a district whose own name happens to equal the city name (e.g. "حي المحالة" in
-- المحالة city) is preserved, just de-duplicated to one occurrence instead of erased.
--
-- Verified via dry-run before writing this migration: 1,015 of ~1,471 aqarmonthly rows would change;
-- 0 produced a suspiciously short (<=3 char) or malformed (missing "حي " prefix) result; a random
-- 25-row sample of changes and a full review of the ~69 rows the function leaves unchanged both
-- checked out (the unchanged ones are either genuinely correct districts, or a DIFFERENT, out-of-scope
-- bug class -- street names captured as district, single-letter fragments, or the project's own
-- already-decided Al-Ahsa/Hofuf composite dual-label pattern -- left untouched on purpose).

do $mig$
declare
  n_raw int;
  n_search int;
begin
  create or replace function pg_temp.ar_norm_tok(t text)
  returns text
  language sql immutable
  as $fn$
    select translate(regexp_replace(coalesce(t,''), 'ـ+', '', 'g'), 'أإآٱةى', 'ااااهي');
  $fn$;

  create or replace function pg_temp.strip_district_city_suffix(p_district_ar text, p_city_ar text)
  returns text
  language plpgsql
  as $fn$
  declare
    dist_tokens text[];
    dist_norm text[];
    city_tokens_norm text[];
    city_first_norm text[];
    n int;
    cn int;
  begin
    if p_district_ar is null or p_city_ar is null then
      return p_district_ar;
    end if;
    dist_tokens := regexp_split_to_array(trim(p_district_ar), '\s+');
    dist_norm := (select array_agg(pg_temp.ar_norm_tok(x)) from unnest(dist_tokens) x);
    city_tokens_norm := (select array_agg(pg_temp.ar_norm_tok(x)) from unnest(regexp_split_to_array(trim(p_city_ar), '\s+')) x);
    city_first_norm := city_tokens_norm[1:1];
    loop
      n := array_length(dist_tokens, 1);
      exit when n <= 2;
      cn := array_length(city_tokens_norm, 1);
      if n > cn and dist_norm[n-cn+1:n] = city_tokens_norm then
        dist_tokens := dist_tokens[1:n-cn];
        dist_norm := dist_norm[1:n-cn];
        continue;
      end if;
      if n > 1 and dist_norm[n:n] = city_first_norm then
        dist_tokens := dist_tokens[1:n-1];
        dist_norm := dist_norm[1:n-1];
        continue;
      end if;
      if dist_norm[n] in ('اماره','منطقه') then
        dist_tokens := dist_tokens[1:n-1];
        dist_norm := dist_norm[1:n-1];
        continue;
      end if;
      exit;
    end loop;
    return array_to_string(dist_tokens, ' ');
  end;
  $fn$;

  -- 1) the true source of truth.
  update aqarmonthly_residential_listings r
    set district_ar = pg_temp.strip_district_city_suffix(r.district_ar, r.city_ar)
  where r.district_ar is not null and r.city_ar is not null
    and r.district_ar <> pg_temp.strip_district_city_suffix(r.district_ar, r.city_ar);
  get diagnostics n_raw = row_count;

  -- 2) the search index, immediately -- don't wait up to ~45 min for the next hourly sync tick.
  update search_listings_ar s
    set district_ar = pg_temp.strip_district_city_suffix(s.district_ar, s.city_ar)
  where s.platform = 'aqarmonthly' and s.district_ar is not null and s.city_ar is not null
    and s.district_ar <> pg_temp.strip_district_city_suffix(s.district_ar, s.city_ar);
  get diagnostics n_search = row_count;

  raise notice 'aqarmonthly_residential_listings rows corrected: %; search_listings_ar rows corrected: %', n_raw, n_search;
end
$mig$;
