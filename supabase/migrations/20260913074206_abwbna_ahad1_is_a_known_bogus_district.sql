-- Owner-confirmed 2026-09-13: "أحد1" (abwbna.com's own internal district id/name for city_id 3677 /
-- الاحساء — verified live at abwbna.com/properties/53393, same numeric backend id reused across
-- listings scraped 8+ months apart) reads as a code, not a real neighborhood name a user would search
-- for. Owner wants it dropped to city-only matching rather than shown as a district.
--
-- NOT handled by widening district_ar_looks_bogus()'s general "digit glued to a word" pattern —
-- checked first: that exact shape (word immediately followed by 1-2 digits, no space) is the
-- CORRECT, live form for ~90 real districts fleet-wide (حي ج1..حي ج44, البستان1, النخيل1, حي أبا
-- العبلان1/2, ...). A pattern rule would have silently blanked all of those. Confirmed 'أحد1' exists
-- in loc_canonical_district under exactly one city (3677, الاحساء) and nowhere else, so a named,
-- single-value addition to the existing known-non-place blocklist (item 5, same mechanism as
-- 'حكومي1'/'حكومي'/'هخطط 10.5') has zero blast radius beyond this one value.
create or replace function public.district_ar_looks_bogus(t text)
 returns boolean
 language sql
 immutable
as $function$
  select
    -- 1. explicit subdivision-plan vocabulary ("مخطط" / "مخطط رقم") — always an internal plan
    --    reference ("مخطط الرياض (474/19)", "مخطط رقم 133"), never a neighborhood's own name.
    t ~ 'مخطط'
    -- 2. a run of 3+ consecutive digits anywhere — ASCII or Arabic-Indic (v2: 'النسيم مساحه ٦٠٠'
    --    slipped through the ASCII-only rule). Every genuine numbered Saudi sub-district observed
    --    stays single-digit (حي المصيف 1/2/3, الناصرية 4/5/6, زهراء ١); every 3+ digit run
    --    observed is a plot/scheme/parcel code (776/4, 8511, 602001011, 133, 253/4, ٦٠٠-size leaks).
    or t ~ '[0-9٠-٩]{3,}'
    -- 3. fewer than 2 Arabic letters survive once every digit/space/paren/dash/dot/slash/colon is
    --    stripped — too thin to be a place name at all ("33ج" -> "ج", "8511" -> "").
    or length(regexp_replace(t, '[0-9٠-٩\s\(\)\-\./:]', '', 'g')) < 2
    -- 4. longer than any real Saudi district name gets — catches a leaked full listing
    --    description sitting in the district field by scraper error, not a place at all.
    or length(t) > 40
    -- 4b. description-leak shapes (v2, عرعر cluster 2026-09-11): a colon anywhere, the phrase
    --     «مكون/مكونه/مكونة من» ("consisting of" — listing-description vocabulary, never a place),
    --     or a digit glued directly BEFORE Arabic letters ('1النرجس', a bidi/scraper artifact —
    --     genuine numbered districts put the digit AFTER the name, space-separated).
    or t ~ ':'
    or t ~ 'مكون[هة]? من'
    or t ~ '^[0-9٠-٩]+[ء-ي]'
    -- 5. known non-place values, same mechanism as the existing غير محدد/اخرى/أخرى blocklist.
    --    'أحد1' added 2026-09-13 (owner-confirmed): abwbna.com's own internal district id for
    --    الاحساء, not a real neighborhood name — see this migration's header for the verification.
    or t in ('حكومي1', 'حكومي', 'هخطط 10.5', 'أحد1')
$function$;