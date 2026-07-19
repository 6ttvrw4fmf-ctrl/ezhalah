-- Extend age_from_text_ar() (shared by dealapp/aqaratikom/souq24 via the jsonb_text age-registry
-- strategy) with two additional, narrowly-scoped patterns, evidence-verified via dry run against
-- real production data before applying (see project memory
-- aqarcity-dealapp-age-feasibility-2026-07-18 / dealapp-age-parser-2026-07-18):
--
-- 1. Dual-form digit prefix ("2 سنتين") — 75 real dealapp rows use this exact literal phrasing
--    (digit "2" + the Arabic grammatical dual form of "year", both redundantly meaning two years).
--    Zero ambiguity: the digit and the word agree.
-- 2. First-occurrence numeric fallback ("١٢ سنة (بناء شخصي ونظيف).", "قرابة 8 سنوات", etc.) — when
--    no exact full-string pattern matches, extract the first "N + سنة/سنوات/سنه/عام/أعوام" occurrence
--    from otherwise free-text commentary. Dry-run verified correct on all 16 real occurrences in
--    dealapp's data (spot-checked every one manually); zero false positives on the ~40 unrelated
--    HTML/meta-tag garbage rows already known to exist in this platform's raw data (none contain a
--    digit-then-year-word pattern, so this fallback cannot fire on them).
-- 3. Bare سنتين/سنتان anywhere in the string ("أكثر من سنتين", "سنتين (بحالة ممتازة...)") — 2 more
--    real rows, self-consistent (سنتين/سنتان always means "two").
--
-- Regression safety: aqaratikom_residential/commercial_listings and souq24_residential/commercial_listings
-- (the only other tables using this shared function via the age_source_registry) were checked live —
-- ZERO currently-unmatched non-null property_age_text rows exist for either platform, so these new
-- ELSE-branch patterns have no data to fire on there; this is a dealapp-only behavioral change in
-- practice. Deliberately NOT handling noisy "جديد" mentions (e.g. "/ جديد لم يسكن", 3 rows) since
-- "جديد" alone could ambiguously mean newly-built OR recently-renovated — left NULL, honest gap,
-- per the project's never-fabricate rule.
--
-- Verified live before/after (dealapp, active rows): residential aged 1,143 -> 1,199 (+56),
-- commercial aged 125 -> 131 (+6). search_listings_ar picks this up via the existing hourly
-- sync-search-listings-ar cron (jobid 28); listing_age_resolved reflects it immediately.
CREATE OR REPLACE FUNCTION public.age_from_text_ar(raw text)
 RETURNS smallint
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH n AS (
    SELECT btrim(regexp_replace(translate(coalesce(raw,''),'٠١٢٣٤٥٦٧٨٩','0123456789'),'\s+',' ','g')) s
  )
  SELECT (CASE
    WHEN s ~ '^(جديد|اقل من سنة|أقل من سنة|اقل من سنه|أقل من سنه)$'                 THEN 0
    WHEN s ~ '^(سنة|سنه|سنة واحدة|1 سنة|1 سنه)$'                                    THEN 1
    WHEN s ~ '^(سنتين|سنتان)$'                                                      THEN 2
    WHEN s ~ '^ثلاث سنوات$'                                                         THEN 3
    WHEN s ~ '^(اربع سنوات|أربع سنوات)$'                                            THEN 4
    WHEN s ~ '^خمس سنوات$'                                                          THEN 5
    WHEN s ~ '^ست سنوات$'                                                           THEN 6
    WHEN s ~ '^سبع سنوات$'                                                          THEN 7
    WHEN s ~ '^(ثمان سنوات|ثماني سنوات)$'                                           THEN 8
    WHEN s ~ '^تسع سنوات$'                                                          THEN 9
    WHEN s ~ '^عشر سنوات$'                                                          THEN 10
    WHEN s ~ '^(اكثر من عشر سنوات|أكثر من عشر سنوات|اكثر من 10 سنوات|أكثر من 10 سنوات)$' THEN 10
    WHEN s ~ '^[0-9]{1,2}$'                                                         THEN s::int
    WHEN s ~ '^[0-9]{1,2} (سنوات|سنة|سنه|عام|أعوام)$'                               THEN split_part(s,' ',1)::int
    WHEN s ~ '^[0-9]{1,2}\s*(سنتين|سنتان)$'                                         THEN 2
    WHEN s ~ '[0-9]{1,2}\s*(سنوات|سنة|سنه|عام|أعوام)'                               THEN substring(s from '([0-9]{1,2})\s*(?:سنوات|سنة|سنه|عام|أعوام)')::int
    WHEN s ~ '(سنتين|سنتان)'                                                        THEN 2
    ELSE NULL
  END)::smallint
  FROM n;
$function$;
