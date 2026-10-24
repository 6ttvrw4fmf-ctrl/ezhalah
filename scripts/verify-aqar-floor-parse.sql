-- Verifies the 2026-07-19 aqar_parse() floor_number fix end-to-end (calls the REAL live function,
-- not a reimplementation) against synthetic page text covering every corruption category found in
-- the live-data forensic audit, plus the legitimate structured shapes that must keep working.
--
-- Run against a branch/staging DB AFTER applying 20260719_aqar_floor_number_structured_only.sql:
--   supabase db execute -f scripts/verify-aqar-floor-parse.sql   (or psql -f, or via execute_sql)
-- Exits via RAISE EXCEPTION on the first failing case; prints one NOTICE per pass and a final
-- "ALL N CASES PASSED" on success.

do $$
declare
  case_name text;
  input_text text;
  expected text;   -- NULL means "expect JSON key absent / SQL NULL"
  actual text;
  n int := 0;
begin
  -- ── Legitimate structured shapes (must still work — no regression) ──────────────────────────
  for case_name, input_text, expected in values
    ('structured: digit floor',
     'تفاصيل الإعلان المساحة 150 م² الفئة عوائل غرف النوم 5 الصالات 1 دورات المياه 2 الدور 2 عمر العقار 3 سنوات المميزات مطبخ',
     '2'),
    ('structured: ground (أرضي) — recovered, was NULL before the fix',
     'تفاصيل الإعلان عرض الشارع 39 م المساحة 900 م² الفئة عوائل غرف النوم 2 الصالات 2 دورات المياه 2 الدور أرضي عمر العقار جديد',
     '0'),
    ('structured: ground with al- prefix',
     'تفاصيل الإعلان المساحة 45 م² الدور الأرضي عمر العقار 4 سنوات',
     '0'),
    ('structured: upper (علوي) is AMBIGUOUS — must be NULL, never guessed',
     'تفاصيل الإعلان المساحة 900 م² الدور علوي عمر العقار جديد',
     null),
    ('structured: ordinal word (rare but real on live Aqar pages)',
     'تفاصيل الإعلان المساحة 126 م² الدور الثالث عمر العقار سنتين',
     '3'),
    ('structured: two-digit floor at the boundary (60 = accept)',
     'تفاصيل الإعلان المساحة 300 م² الدور 60 عمر العقار جديد',
     '60'),
    ('structured: license/direction fields untouched (regression guard on shared _aqar_between)',
     'تفاصيل الإعلان الواجهة شمال المساحة 136 م² الدور 2 عمر العقار جديد رخصة الإعلان 7200897327',
     '2'),

  -- ── Free-text corruption categories from the live forensic audit — must ALL become NULL ──────
    ('free-text: comma-grouped price leak (288,239 ريال truncated to 288 under the old bug)',
     'تفاصيل الإعلان الاولى في الدور العلوي بسعر 288,239 ريال تتكون من عدد 2 مجلس الشقة الثانية في الدور الارضي بسعر 200,000 ريال',
     null),
    ('free-text: area figure leak (198.44 mistaken for the floor)',
     'تفاصيل الإعلان حي الواحة الدور الثالث خمس غرف مساحة العقار 198.44 غرفه للشغاله',
     null),
    ('free-text: bare uncomma''d asking price leak (1,100,000 read as a floor)',
     'تفاصيل الإعلان للبيع فلة مساحة 400 م تتكون من دور علوي وشقتين أرضيه الدور العلوي وشقة ارضيه مؤجره الحد 1100000',
     null),
    ('free-text: TV screen size leak (50-inch TV mistaken for floor 50)',
     'تفاصيل الإعلان الدور الأول مواصفات الاستديو غرفة كبيرة واسعة مكيف سبليت شاشة تلفزيون 50 بوصة اشتراك Netflix',
     null),
    ('free-text: parking-distance note leak (20 m mistaken for floor 20)',
     'تفاصيل الإعلان غرفة صغيرة مؤثثة مدخل مشترك مع غرفة أخرى فقط و في الدور الأرضي قريبة من الشارع الرئيسي بشرط عدم إيقاف السيارة أمام المدخل وانما على بعد 20 م',
     null),
    ('free-text: street-width leak (20 m street width mistaken for floor 20)',
     'تفاصيل الإعلان للبيع دور نظام تاون هاوس علوي دور اول شقه في الدور الاخير شارع 20 م امام مرفق بالقرب من جميع الخدمات',
     null),
    ('free-text: agent reference code leak (an ad''s own internal code number)',
     'تفاصيل الإعلان الوحدة تباع بالكامل الدور فيها كود المعلن رقم 20 للتواصل مباشر',
     null),
    ('free-text: round-number rent-price camouflage inside the "sane" range (50,000 -> 50)',
     'تفاصيل الإعلان مجدد ب الكامل مطبخ راكب قريب من الخدمات الدور الأول سعر الإيجار : 50,000 بصمة الابداع العقارية',
     null),
    ('free-text: multi-word ordinal combo — not an exact match, must reject',
     'تفاصيل الإعلان الدور الاول والثاني مجلس ومقلط',
     null),
    ('free-text: three-digit / out-of-range floor from a truncated big price (720,000 -> 720)',
     'تفاصيل الإعلان شقق تمليك مخطط الطارق الدور الأرضي شقتان بمساحة 141 م² من الدور الأول إلى الثالث السعر: 720,000 ريال',
     null),
    ('free-text: 61 is one past the valid ceiling even as a clean-looking digit',
     'تفاصيل الإعلان المساحة 300 م² الدور 61 عمر العقار جديد',
     null),
    ('no تفاصيل الإعلان heading at all: pure free text, no structured block anywhere',
     'شقة للبيع في الدور الثالث مساحة 150 متر السعر 500000 ريال للتواصل',
     null)
  loop
    n := n + 1;
    actual := aqar_parse(input_text)->>'floor_number';
    if actual is distinct from expected then
      raise exception 'FAILED [%]: expected %, got % (input: %)', case_name,
        coalesce(expected, 'NULL'), coalesce(actual, 'NULL'), input_text;
    end if;
    raise notice 'PASS [%]: floor_number = %', case_name, coalesce(actual, 'NULL');
  end loop;

  raise notice 'ALL % CASES PASSED', n;
end $$;

-- Defense-in-depth checkpoint: the CHECK constraint itself must reject an out-of-range value even
-- if some future code path bypasses aqar_parse() entirely (only meaningful after Step 4 of the
-- migration VALIDATEs the constraint — run this block manually at that point, not part of the
-- pass/fail loop above since it intentionally tries to violate the constraint):
-- BEGIN;
--   INSERT INTO aqar_residential_listings (floor_number, ad_number, listing_url, property_type, transaction_type)
--     VALUES (999, 'test-guard', 'https://example.invalid/test', 'Apartment', 'Buy');
--   -- ^ must raise a check_violation on floor_number_sane_range
-- ROLLBACK;
