-- A STREET IS NOT A DISTRICT — in the DROPDOWN either. (Supersedes 20260928014300.)
--
-- WHY A SECOND MIGRATION. 20260928014300 added the «شارع» rule and purged the dropdown correctly,
-- but it redefined district_ar_looks_bogus() WITHOUT carrying forward the contract that
-- scripts/verify-district-bogus-guard-catches-prose-leak.ts pins to whichever migration defines
-- that function LAST. That barrier is right to fail it: it exists precisely so a later edit cannot
-- quietly drop the 2026-09-19 prose-leak self-tests by being newer. The contract travels with the
-- definition, so this migration re-states it in full and extends it, rather than leaving the
-- barrier appeased by a filename. The function body here is 20260928014300's, unchanged.
--
-- SCOPE, unchanged from 20260919171833: this gates the live-promoted fallback half of
-- loc_canonical_district ONLY — never the curated catalog, never the underlying listing rows
-- (search_listings_ar.district_ar keeps whatever the source published; the card still shows it).
--
-- THE STREET RULE (rule 10), owner decision 2026-09-27. The «حي بدر» work found the الرياض picker
-- offering «الشرق الرياض» (a slug fragment with the city glued on) and حائل offering «شارع الملك
-- خالد» — the street line leaking into the district field, the same shape 20260927205755 fixed
-- inside aqarmonthly's slug parser. Measured before adding: 0 of 3,777 curated districts contain
-- «شارع», and exactly 5 live rows across TWO platforms were excluded (aqarmonthly 761963; mustqr
-- 615515 / 614613 / 614918 / 615593, all حائل) — which is why the fix belongs in this shared gate
-- and not in one platform's parser.
--
-- DELIBERATELY NOT ADDED: a city-glue rule. district_trailing_catalog_city_norm() is id-free by
-- design and also matches a district genuinely named after its own city («حي المحالة» in المحالة):
-- 1,570 of 5,063 canonical rows trip it, an upper bound and not a defect count. Gating on it would
-- hollow out real districts, exactly what strip_city_suffix()'s two-token floor prevents.
-- «الشرق الرياض» needed no rule: once 20260927214447 cleared its last listing it had zero rows
-- behind it and the scheduled rebuild dropped it on its own.
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
$function$;

comment on function public.district_ar_looks_bogus(text) is
  'Used only to gate the live-promoted fallback half of loc_canonical_district — never the '
  'curated catalog, never the underlying listing rows. See migrations 20260911201716 (original), '
  '20260919171833 (prose leak) and this one (rule 10, streets).';

do $$
declare v_bad_still_present int; v_false_positive_count int;
begin
  -- T1: every one of the eight known-bad Arar entries must still be caught, PLUS the street
  -- shapes rule 10 adds. An extension must not weaken what the prose-leak migration pinned.
  if not (select bool_and(public.district_ar_looks_bogus(x))
          from unnest(array[
            'الجوهرة الشقه مكونه من :',
            'الجوهره العماره مكونه من :',
            'الجوهره 💎 مكونه من :',
            'المنصوربة الشقه مكونه من :',
            'الربوه الشقه مكونه من:',
            'المساعديه الغربي الدور مكون من شقتين',
            'النسيم مساحه',
            ': الجوهره',
            -- rule 10, the five live offenders this migration retires
            'شارع الملك خالد',
            'شارع الثلاثين',
            'شارع الملك عبدالله',
            'شارع الملك فيصل',
            'حي قرطبة شارع جعفر'
          ]) x)
  then
    raise exception 'T1 FAILED: at least one known-bad entry is still NOT flagged bogus';
  end if;

  -- T2: real district names must NOT be caught — the sibling-branch positive assertion. The حائل
  -- and الرياض entries are added because rule 10 is the new risk: a real district must survive it.
  if (select bool_or(public.district_ar_looks_bogus(x))
      from unnest(array[
        'حي الجوهرة', 'حي المنصورية', 'حي الربوة', 'حي الناصرية', 'حي المساعدية', 'حي النسيم',
        'قرطبه أ', 'حي الخليج الغربي', 'حي القدس الغربي',
        'حي النقرة', 'حي السويفلة', 'حي المدائن', 'حي الوادي', 'حي قرطبة', 'حي الشرق',
        'منطقة المستودعات', 'منطقة الصناعات الخفيفة'
      ]) x)
  then
    raise exception 'T2 FAILED: a real district name was flagged bogus by the new rules';
  end if;

  -- T3: EXECUTE against the live canonical catalog — nothing matching the leak vocabulary may
  -- survive unflagged in production data, not a hand-picked fixture.
  select count(*) into v_bad_still_present
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar) is not true
     and (canonical_district_ar ~ 'مكون' or canonical_district_ar ~ 'مساحه' or canonical_district_ar ~ 'مساحة'
          or canonical_district_ar ~ '^:' or canonical_district_ar ~ ':$'
          or canonical_district_ar ~ '[\uD83C-\uDBFF][\uDC00-\uDFFF]'
          or canonical_district_ar ~ 'شارع');
  if v_bad_still_present > 0 then
    raise exception 'T3 FAILED: % live canonical rows match the leak vocabulary but are not '
                     'flagged bogus', v_bad_still_present;
  end if;

  -- T4: and the rules must not newly flag anything that was already legitimate.
  select count(*) into v_false_positive_count
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar)
     and canonical_district_ar not in (
       'الجوهرة الشقه مكونه من :', 'الجوهره العماره مكونه من :', 'الجوهره 💎 مكونه من :',
       'المنصوربة الشقه مكونه من :', 'الربوه الشقه مكونه من:',
       'المساعديه الغربي الدور مكون من شقتين', 'النسيم مساحه', ': الجوهره',
       -- rule 10's own five, retired deliberately and listed so they are not read as collateral
       'شارع الملك خالد', 'شارع الثلاثين', 'شارع الملك عبدالله', 'شارع الملك فيصل',
       'حي قرطبة شارع جعفر'
     )
     -- already caught by the pre-existing rules 1-5, so not attributable to THIS migration
     and not (canonical_district_ar ~ 'مخطط' or canonical_district_ar ~ '[0-9]{3,}'
              or length(regexp_replace(canonical_district_ar, '[0-9\s\(\)\-\./]', '', 'g')) < 2
              or length(canonical_district_ar) > 40
              or canonical_district_ar in ('حكومي1', 'حكومي', 'هخطط 10.5'));
  if v_false_positive_count > 0 then
    raise exception 'T4 FAILED: the rules newly flag % live canonical district(s) that were '
                     'not already caught — a real false positive', v_false_positive_count;
  end if;

  raise notice 'district_ar_looks_bogus self-tests T1-T4 PASSED (prose leak + street rule)';
end $$;

-- Purge immediately rather than waiting for the next scheduled rebuild — an unvetted raw-text
-- guess should not keep serving in the dropdown between now and the next refresh. (20260928014300
-- already ran this; it is idempotent and re-asserted here so this migration stands on its own.)
select public.refresh_loc_canonical_district();

do $$
declare v_remaining int;
begin
  select count(*) into v_remaining
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar);
  if v_remaining > 0 then
    raise exception 'PURGE FAILED: % garbage entries remain in loc_canonical_district after refresh',
      v_remaining;
  end if;
  raise notice 'canonical catalog purge verified: 0 remaining';
end $$;
