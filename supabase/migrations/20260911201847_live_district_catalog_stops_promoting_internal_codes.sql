-- LIVE DISTRICT CATALOG STOPS PROMOTING PLAN/PARCEL CODES AND LEAKED TEXT AS DISTRICT NAMES.
--
-- Owner report, 2026-09-11: the Riyadh Advanced Filter district dropdown showed entries like
-- "الخبر الحمراء 3537" / "الخبر الحمراء 3541" / "حي الدكاترة 3420" / "حي الدكاترة 3422" — raw
-- internal numbers, never meant to be user-facing.
--
-- ROOT CAUSE, traced to source. public.refresh_loc_canonical_district() rebuilds the ENTIRE
-- district picklist nightly from two sources: the curated static catalog (loc_catalog_district,
-- always wins) and, as a fallback for anything with no curated entry, the RAW district_ar text
-- scraped straight off search_listings_ar (tagged source='live'). The only existing filter on that
-- fallback was three literal placeholder tokens ('غير محدد','اخرى','أخرى'). Anything else — an
-- internal plan/scheme code, a parcel reference, a land-use tag, even a whole leaked listing
-- description — was promoted VERBATIM as a selectable "district."
--
-- Confirmed against the full live table (every source='live' row containing a digit, all cities,
-- not a sample): the Riyadh examples are nowaisiry's own internal scheme/plot numbering ("الخير
-- الأمراء 3537" / "3540" / "3541" are three DIFFERENT plots inside the same development, not the
-- same district saved three times) sitting next to genuinely real, correctly-numbered Saudi
-- sub-districts elsewhere in the same table (e.g. تبوك's "حي المصيف 1/2/3", جازان's "المحمدية
-- 1/2/3") — real places where the number IS the distinguishing part of the official name. A rule
-- that strips digits indiscriminately would silently merge those into one wrong entry each,
-- exactly what the owner said must never happen. This rule targets the SHAPE of an internal code
-- (subdivision-plan vocabulary, a 3+ digit run — no observed genuine Saudi sub-district numbers
-- past single digits informally, a name too thin in real letters to be a place, or a leaked
-- sentence far longer than any real district name), never a bare digit count — so "المصيف 1" and
-- "المحمدية 3" are untouched and still shown as the distinct real places they are.
--
-- SCOPE, deliberately narrow. This touches ONLY the 'live' fallback branch of the refresh
-- function. The curated static catalog (loc_catalog_district, pref=0) always wins the dedup
-- regardless and is completely unaffected — this can only ever remove an unvetted raw-text guess,
-- never a trusted curated name. Raw district_ar values on the underlying listing rows are NEVER
-- touched (Listing fidelity — data is never modified/estimated); a listing whose only district
-- text was a plan code stays fully searchable at the city level, it just stops being offered as
-- its own bogus dropdown entry, same mechanism already used for 'غير محدد'/'اخرى'/'أخرى'.
--
-- ONE KNOWN RESIDUAL, reported rather than hidden: 'هخطط 10.5' (الباحة) is an OCR-style typo of
-- 'مخطط 10.5' (different first letter) that no shape-based rule catches cleanly without risking a
-- false positive elsewhere, so it is blocked by explicit literal alongside 'حكومي1' (n=153 in
-- جدة — reads as a leaked land-use/category tag from the source site's own form, not a place).
CREATE OR REPLACE FUNCTION public.district_ar_looks_bogus(t text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  select
    -- 1. explicit subdivision-plan vocabulary ("مخطط" / "مخطط رقم") — always an internal plan
    --    reference ("مخطط الرياض (474/19)", "مخطط رقم 133"), never a neighborhood's own name.
    t ~ 'مخطط'
    -- 2. a run of 3+ consecutive digits anywhere. Every genuine numbered Saudi sub-district
    --    observed stays single-digit (حي المصيف 1/2/3, الناصرية 4/5/6); every 3+ digit run
    --    observed is a plot/scheme/parcel code (776/4, 8511, 602001011, 133, 253/4).
    or t ~ '[0-9]{3,}'
    -- 3. fewer than 2 Arabic letters survive once every digit/space/paren/dash/dot/slash is
    --    stripped — too thin to be a place name at all ("33ج" -> "ج", "8511" -> "").
    or length(regexp_replace(t, '[0-9\s\(\)\-\./]', '', 'g')) < 2
    -- 4. longer than any real Saudi district name gets — catches a leaked full listing
    --    description sitting in the district field by scraper error, not a place at all.
    or length(t) > 40
    -- 5. known non-place values, same mechanism as the existing غير محدد/اخرى/أخرى blocklist.
    or t in ('حكومي1', 'حكومي', 'هخطط 10.5')
$function$;

COMMENT ON FUNCTION public.district_ar_looks_bogus(text) IS
  'TRUE when a raw scraped district_ar string is an internal plan/parcel code, a leaked land-use '
  'tag, or a leaked listing-description sentence rather than a real, user-facing district name. '
  'Used only to gate the live-promoted fallback half of loc_canonical_district — never the '
  'curated catalog, never the underlying listing rows. See migration '
  '20260911201716_live_district_catalog_stops_promoting_internal_codes.';

CREATE OR REPLACE FUNCTION public.refresh_loc_canonical_district()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare n bigint;
begin
  truncate public.loc_canonical_district;
  insert into public.loc_canonical_district (city_id, district_norm, canonical_district_ar, source, refreshed_at)
  with cat as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 0 as pref, 1::bigint cnt
    from public.loc_catalog_district
    where district_ar is not null and btrim(district_ar) <> ''
  ),
  liv as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 1 as pref, count(*)::bigint cnt
    from public.search_listings_ar
    where production_ready and district_ar is not null and btrim(district_ar) <> ''
      and district_ar not in ('غير محدد','اخرى','أخرى')
      and not public.district_ar_looks_bogus(district_ar)
    group by 1,2,3
  ),
  allrows as (select * from cat union all select * from liv),
  ranked as (
    select city_id, k, sp, pref,
      row_number() over (partition by city_id, k order by pref asc, cnt desc, length(sp) asc, sp asc) rn
    from allrows
    where k is not null and k <> ''
  )
  select city_id, k, sp, case when pref = 0 then 'catalog' else 'live' end, now()
  from ranked where rn = 1;
  get diagnostics n = row_count;
  return n;
end;
$function$;