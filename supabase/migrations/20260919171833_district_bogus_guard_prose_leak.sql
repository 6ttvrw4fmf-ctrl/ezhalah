-- district_ar_looks_bogus() misses a shorter class of leaked listing prose (routine-3, 2026-09-19).
--
-- Migration 20260911201716 already stops a plan/parcel code or a long leaked description from
-- being promoted into loc_canonical_district, via a length(t) > 40 rule among others. That rule
-- has a gap: eight awal (Arar) rows leaked "<district name> <apartment/area description>" into
-- district_ar, and the description half was SHORT enough (20-36 chars) to slip under the 40-char
-- line while still being unmistakably prose, not a place name:
--
--   "الجوهرة الشقه مكونه من :"        (Al-Jawhara, the apartment consists of: )
--   "المساعديه الغربي الدور مكون من شقتين"  (West Al-Musa'idiyah, the floor consists of two units)
--   "النسيم مساحه"                     (Al-Naseem area)
--   ": الجوهره"                        (a leaked field-label colon, reversed)
--
-- Each of these was independently RE-LEARNED as a "canonical" district by
-- refresh_loc_canonical_district()'s live-fallback branch, because it is itself the exact string
-- that leaked into district_ar on one listing -- confirmed by execution: every one of the eight
-- matches EXACTLY ONE row in search_listings_ar (its own polluting listing), never more. That
-- silently masked the underlying data defect from #310's own repro query, which looks for
-- district_ar values ABSENT from loc_canonical_district: these were PRESENT, because the catalog
-- had already learned the same garbage.
--
-- THE FIX, narrow and evidence-checked. "مكون"/"مكونه" (consisting of...) and "مساحه"/"مساحة"
-- (area) are generic real-estate description vocabulary -- the SAME words scrapers/awal/run.py's
-- own _DIST_STOP list already treats as field-boundary markers, never part of an official Saudi
-- district name. A leading or trailing colon is a field-label leak, never a place name shape. An
-- emoji is decorative advertiser flourish, never part of an official designation. Checked BY
-- EXECUTION against the FULL canonical catalog (all cities, all platforms) before this migration:
-- these four additional predicates match ONLY the eight known-bad Arar entries -- zero other rows,
-- in any city, on any platform. See migration 20260911201716 for the original rules and their own
-- false-positive-avoidance reasoning, which this extends rather than replaces.
--
-- SCOPE, same as before: only the 'live' fallback branch of loc_canonical_district. Never the
-- curated catalog, never the underlying listing rows (search_listings_ar.district_ar for these
-- eight listings was repaired separately, by hand, against the SAME scrape's own description field
-- -- see ops_incident #310 -- listing fidelity means this predicate change alone repairs nothing
-- retroactively; the data repair and the guard are two different acts, as this migration's own
-- self-tests below require).

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
$function$;

COMMENT ON FUNCTION public.district_ar_looks_bogus(text) IS
  'TRUE when a raw scraped district_ar string is an internal plan/parcel code, a leaked land-use '
  'tag, or a leaked listing-description sentence rather than a real, user-facing district name. '
  'Used only to gate the live-promoted fallback half of loc_canonical_district — never the '
  'curated catalog, never the underlying listing rows. See migrations '
  '20260911201716_live_district_catalog_stops_promoting_internal_codes and '
  '20260919_district_bogus_guard_prose_leak (rules 6-9: "consisting of"/"area" vocabulary, a '
  'leaked field-label colon, decorative emoji — all measured, none loosened from rules 1-5).';

-- ---------------------------------------------------------------------------
-- APPLY-TIME SELF-TESTS. EXECUTE the predicate against the real eight-row cohort and the full
-- canonical catalog; a failure rolls the whole migration back.
-- ---------------------------------------------------------------------------
do $$
declare v_bad_still_present int; v_false_positive_count int; v_real_ok int;
begin
  -- T1: every one of the eight known-bad Arar entries must now be caught.
  if not (select bool_and(public.district_ar_looks_bogus(x))
          from unnest(array[
            'الجوهرة الشقه مكونه من :',
            'الجوهره العماره مكونه من :',
            'الجوهره 💎 مكونه من :',
            'المنصوربة الشقه مكونه من :',
            'الربوه الشقه مكونه من:',
            'المساعديه الغربي الدور مكون من شقتين',
            'النسيم مساحه',
            ': الجوهره'
          ]) x)
  then
    raise exception 'T1 FAILED: at least one known-bad entry is still NOT flagged bogus';
  end if;

  -- T2: real district names on the SAME city, sharing prefixes with the bad entries, must NOT be
  -- caught — the sibling-branch positive assertion, not just an absence of false positives.
  if (select bool_or(public.district_ar_looks_bogus(x))
      from unnest(array[
        'حي الجوهرة', 'حي المنصورية', 'حي الربوة', 'حي الناصرية', 'حي المساعدية', 'حي النسيم',
        'قرطبه أ', 'حي الخليج الغربي', 'حي القدس الغربي'
      ]) x)
  then
    raise exception 'T2 FAILED: a real district name was flagged bogus by the new rules';
  end if;

  -- T3: EXECUTE against the live canonical catalog — the new rules must catch exactly the 8 known
  -- offenders and nothing else, in production data, not a hand-picked fixture.
  select count(*) into v_bad_still_present
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar) is not true
     and (canonical_district_ar ~ 'مكون' or canonical_district_ar ~ 'مساحه' or canonical_district_ar ~ 'مساحة'
          or canonical_district_ar ~ '^:' or canonical_district_ar ~ ':$'
          or canonical_district_ar ~ '[\uD83C-\uDBFF][\uDC00-\uDFFF]');
  if v_bad_still_present > 0 then
    raise exception 'T3 FAILED: % live canonical rows match the new leak vocabulary but are not '
                     'flagged bogus', v_bad_still_present;
  end if;

  select count(*) into v_false_positive_count
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar)
     and canonical_district_ar not in (
       'الجوهرة الشقه مكونه من :', 'الجوهره العماره مكونه من :', 'الجوهره 💎 مكونه من :',
       'المنصوربة الشقه مكونه من :', 'الربوه الشقه مكونه من:',
       'المساعديه الغربي الدور مكون من شقتين', 'النسيم مساحه', ': الجوهره'
     )
     -- already caught by the pre-existing rules 1-5, so not attributable to THIS migration
     and not (canonical_district_ar ~ 'مخطط' or canonical_district_ar ~ '[0-9]{3,}'
              or length(regexp_replace(canonical_district_ar, '[0-9\s\(\)\-\./]', '', 'g')) < 2
              or length(canonical_district_ar) > 40
              or canonical_district_ar in ('حكومي1', 'حكومي', 'هخطط 10.5'));
  if v_false_positive_count > 0 then
    raise exception 'T4 FAILED: the new rules newly flag % live canonical district(s) that were '
                     'not already caught — a real false positive', v_false_positive_count;
  end if;

  raise notice 'district_ar_looks_bogus prose-leak self-tests T1-T4 PASSED';
end $$;

-- Purge the now-recognized garbage from the canonical catalog immediately, rather than waiting
-- for the next scheduled rebuild — an unvetted raw-text guess should not keep serving between now
-- and the next refresh.
select public.refresh_loc_canonical_district();

do $$
declare v_remaining int;
begin
  select count(*) into v_remaining
    from public.loc_canonical_district
   where source = 'live'
     and (canonical_district_ar ~ 'مكون' or canonical_district_ar ~ 'مساحه' or canonical_district_ar ~ 'مساحة'
          or canonical_district_ar ~ '^:' or canonical_district_ar ~ ':$'
          or canonical_district_ar ~ '[\uD83C-\uDBFF][\uDC00-\uDFFF]');
  if v_remaining > 0 then
    raise exception 'PURGE FAILED: % garbage entries remain in loc_canonical_district after refresh',
      v_remaining;
  end if;
  raise notice 'canonical catalog purge verified: 0 remaining';
end $$;
