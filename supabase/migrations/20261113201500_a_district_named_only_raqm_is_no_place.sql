-- A DISTRICT NAMED ONLY «رقم» IS NO PLACE (🦅 2026-11-13, backlog 606).
--
-- WHAT LEAKED. Haraj stores «رقم» (7 ads) and Wasalt «(حي رقم (7» (9 ads, RTL-garbled «حي رقم (7)») for the same
-- Al-Lith (city 1390) sub-district; the Filter list offered «رقم» as a district — a label no customer types, which
-- also split one district across two spellings (the 9 Wasalt ads were offered nowhere). Rule 3 of
-- district_ar_looks_bogus() keeps a value only when 2+ Arabic letters survive the strip, and «رقم» keeps three.
--
-- THE RULE. A district value that is nothing but «(حي) رقم» plus digits, brackets, dashes or spaces names no place:
-- the number was the only identity and it does not survive the fold onto the plain name. It is treated like every
-- other bogus shape: never asserted into the Filter list; the card keeps the site's own wording and the ad stays in
-- its city's results. A real numbered district («حي المصيف 1», «الناصرية 4») carries a name and is untouched.
-- Measured before the change: 1 catalog row («رقم», city 1390) and 16 served rows match; 0 real districts.
--
-- Callers: refresh_loc_canonical_district (its next scheduled rebuild drops the «رقم» entry — never hand-run),
-- served_district_not_offered, mon_detect_district_catalog_pollution, mon_detect_service_facility_types_regressed.
-- No index, generated column or view depends on this function (checked 2026-11-13).
-- Guard: scripts/verify-district-named-only-raqm-is-bogus.ts.
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
    -- 6. "consisting of..." — awal's own listing-structure phrase ("الشقه مكونه من:", "الدور مكون
    --    من شقتين"), the SAME vocabulary scrapers/awal/run.py's own _DIST_STOP already treats as
    --    a field boundary, never itself a place name. Short leaked descriptions (20-36 chars) slip
    --    under rule 4's 40-char line while still carrying this unmistakable tell.
    or t ~ 'مكون'
    -- 7. "area..." — the other awal field-label word that leaks the same way ("النسيم مساحه",
    --    "المساعديه المساحه 8736 يوجد عليها..."). Never part of a place's own name.
    or t ~ 'مساحه' or t ~ 'مساحة'
    -- 8. a leading or trailing colon — a field-label boundary that leaked ONTO the value
    --    (": الجوهره", "الربوه الشقه مكونه من:") rather than being stripped at the boundary.
    or t ~ '^:' or t ~ ':$'
    -- 9. an emoji — decorative advertiser flourish in free text ("الجوهره 💎 مكونه من :"),
    --    never part of an official Saudi district designation.
    or t ~ '[\uD83C-\uDBFF][\uDC00-\uDFFF]'
    -- 10. a STREET name in the district field (owner decision 2026-09-27) — «شارع الملك خالد»
    --     (حائل), «حي قرطبة شارع جعفر» (الرياض). A Saudi district is not named after a street;
    --     when a source says «شارع X», the district is simply unknown. 0 of 3,777 curated
    --     districts contain it, and the curated arm never consults this function anyway.
    or t ~ 'شارع'
    -- 11. only «(حي) رقم» and a number (🦅 2026-11-13, backlog 606): «رقم», «(حي رقم (7», «حي رقم 7». The number was
    --     the whole identity and the fold to the plain name removes it, leaving a word no customer would pick.
    or t ~ '^[\s\(\)\-]*(حي\s*)?رقم[\s0-9٠-٩\(\)\-]*$'
$function$;

do $proof$
begin
  if not public.district_ar_looks_bogus('رقم') then raise exception 'PROOF: «رقم» must be bogus'; end if;
  if not public.district_ar_looks_bogus('(حي رقم (7') then raise exception 'PROOF: «(حي رقم (7» must be bogus'; end if;
  if not public.district_ar_looks_bogus('حي رقم 7') then raise exception 'PROOF: «حي رقم 7» must be bogus'; end if;
  if public.district_ar_looks_bogus('حي المصيف 1') then raise exception 'PROOF: a real numbered district must stay'; end if;
  if public.district_ar_looks_bogus('الناصرية 4') then raise exception 'PROOF: a real numbered district must stay'; end if;
  if public.district_ar_looks_bogus('حي الرقمية') then raise exception 'PROOF: a name containing the letters stays'; end if;
  raise notice 'SUCCESS: a district named only «رقم» is no place; real numbered districts untouched';
end $proof$;
