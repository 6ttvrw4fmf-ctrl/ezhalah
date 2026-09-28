-- A STREET IS NOT A DISTRICT, in the DROPDOWN as well as in the listing.
--
-- Owner decision 2026-09-27: retire the malformed names the الرياض district picker was offering —
-- «الشرق الرياض» (a slug fragment with the city glued on) and the street names beside it — while
-- leaving genuinely odd-looking but REAL districts alone («منطقة المستودعات» in القطيف, «منطقة
-- الصناعات الخفيفة» in ينبع الصناعية, «المنطقة الصناعية المرحلة الثانية والثالثة» in رابغ).
--
-- WHAT THIS IS NOT. It is not an edit of the curated catalogue. loc_canonical_district is DERIVED:
-- refresh_loc_canonical_district() truncates it and rebuilds from two arms — `cat`
-- (loc_catalog_district, curated, unfiltered) and `liv` (search_listings_ar, gated by
-- district_ar_looks_bogus()). Deleting rows there would be undone by the next refresh. The only
-- durable lever for a live-sourced name is the gate, which is exactly what this adds.
--
-- SELF-HEALED ALREADY, recorded so the count is not mistaken for a regression: two of the six names
-- the owner approved retiring were gone before this migration ran. «الشرق الرياض» and «حي شارع ابي
-- الفتوح» each had 0 listings left behind them once 20260927214447 and 20260927213758 cleared the
-- listing rows, so the 01:10 refresh dropped them on its own. That is the mechanism working.
--
-- THE FIVE THAT REMAINED are street names held up by one live listing each, across TWO platforms —
-- which is why the fix belongs in the shared gate rather than in a parser:
--   aqarmonthly 761963  «حي قرطبة شارع جعفر»  الرياض   (the 20260927205755 parser fix corrects this
--                                                       one on its next crawl; the gate does not
--                                                       wait for a crawl)
--   mustqr      615515  «شارع الثلاثين»        حائل
--   mustqr      614613  «شارع الملك خالد»      حائل
--   mustqr      614918  «شارع الملك عبدالله»   حائل
--   mustqr      615593  «شارع الملك فيصل»      حائل
--
-- WHY «شارع» IS SAFE AS A RULE, measured rather than assumed:
--   * 0 of 3,777 rows in loc_catalog_district contain «شارع» — no curated district is named after a
--     street, so no curated entry can be affected. The `cat` arm does not consult this function at
--     all, so curated rows are structurally immune even if one ever were.
--   * exactly 5 live rows / 5 distinct names are excluded by it today, the five listed above.
-- A Saudi district is not named «شارع X»; that is the street line leaking into the district field,
-- the same shape 20260927205755 fixed on aqarmonthly's side of the parser.
--
-- DELIBERATELY NOT ADDED: a rule for the city-glued shape («الشرق الرياض»). The predicate for it,
-- district_trailing_catalog_city_norm(), is id-free by design and also matches a district genuinely
-- named after its own city («حي المحالة» in المحالة) — 1,570 of 5,063 canonical rows trip it, which
-- is an upper bound and not a defect count. Gating on that would hollow out real districts, which
-- is precisely what strip_city_suffix()'s two-token floor exists to prevent. The listing-side
-- parsers already strip that suffix, and the self-heal above shows that path works.
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
    -- 10. a STREET name in the district field (owner decision 2026-09-27). The «حي بدر» work found
    --     the picker offering «شارع الملك خالد» (حائل) and «حي قرطبة شارع جعفر» (الرياض): the
    --     street line leaking into the district, the same shape 20260927205755 fixed inside
    --     aqarmonthly's slug parser. Measured before adding: 0 of 3,777 curated districts contain
    --     «شارع», and exactly 5 live rows across 2 platforms are excluded — so this cannot touch a
    --     real district, and the `cat` arm never consults this function anyway. A Saudi district is
    --     not named after a street; when a source says «شارع X», the district is simply unknown.
    or t ~ 'شارع'
$function$;

-- Rebuild the dropdown from the corrected gate. This is the table's OWN refresh path (it truncates
-- and rebuilds from catalogue + gated live rows, and self-asserts that no live row it inserted
-- looks bogus), not a hand-edit — so the result is reproducible by the next scheduled run.
do $mig$
declare n bigint; v_left int; v_real int;
begin
  n := public.refresh_loc_canonical_district();

  -- the five street names must be gone from the dropdown
  select count(*) into v_left
    from public.loc_canonical_district
   where canonical_district_ar ~ 'شارع';
  if v_left <> 0 then
    raise exception 'still % street-shaped canonical district(s) after the rebuild', v_left;
  end if;

  -- and the look-alike REAL districts must still be there — the whole point of not sweeping «منطقة»
  select count(*) into v_real
    from public.loc_canonical_district
   where canonical_district_ar in ('منطقة المستودعات','منطقة الصناعات الخفيفة',
                                   'المنطقة الصناعية المرحلة الثانية والثالثة');
  if v_real <> 3 then
    raise exception 'expected the 3 genuine «منطقة …» districts to survive, found %', v_real;
  end if;

  raise notice 'loc_canonical_district rebuilt: % rows, 0 street-shaped, 3 genuine «منطقة …» kept', n;
end $mig$;
