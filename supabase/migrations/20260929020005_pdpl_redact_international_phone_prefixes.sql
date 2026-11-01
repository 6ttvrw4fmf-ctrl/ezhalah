-- PDPL: international phone prefixes the floor missed (2026-09-28).
--
-- ksaaqar ad KSA123412486002454 printed «… في الأردن للبيع هاتف 00962…» on its card: the floor only
-- knew 966 followed by a 5 mobile. A scan of every text column of every *_listings table found the
-- same gap in 43 rows / 7 tables (41 active) — dwelleo «+966-11-500-…» / «966115…» (26), rightcompound
-- «+966 13 …» (7), aqar «+9661…», «+9669200…» and «٠٠٥…» (5 + 3 street_name), almotmkenah «+9669200…»
-- (1), ksaaqar «00962…» (1) — and 41 private captures.
--
-- The shapes layer (scrapers/common/pii.py _PHONE_SHAPES_RE, byte-for-byte; a test pins the two):
--   • after 966 any Saudi number (landline, 920 unified, 800), not only a 5 mobile;
--   • «+» and any country code, 8-15 digits;
--   • «00»/«٠٠» and any other country code only as the code, at most one separator, then one unbroken
--     run of 8-11 digits;
--   • neither 966 nor 00 right after «<digit>.»: «?q=…,45.9661…» and «44.0012…» are map coordinates,
--     and the spaced «002673 0802 0801» is a plan number — all three measured on live rows.
-- (1) public._redact_pii_sql: that one layer changes; every other layer is unchanged.
-- (2) mon_check_pii_leaks() and (3) mon_scan_pii_capture_batch() (cron 65) learn the same shapes.
-- The zz_redact_pii triggers call the function on every write; the backfill is a separate, batched
-- statement recorded in the PR.
create or replace function public._redact_pii_sql(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(btrim(regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(coalesce(t,''),
      '(https?://)?(api\.whatsapp\.com/send\S*|wa\.me/\S+|t\.me/\S+|whatsapp[:\s]\S*)', '[redacted]', 'gi'),
      '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', '[redacted]', 'g'),
      '[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}', '[redacted]', 'g'),
      'واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])', '[redacted]', 'g'),
      '(\+?966|00966)\s*5\d[\d\s\-]{6,}', '[redacted]', 'g'),
      'واتس\S*\s*\d[\d\s\-]{6,}', '[redacted]', 'g'),
      '(0?5\d{8}|\y920\d{5,8}\y)', '[redacted]', 'g'),
      '(?<![ء-يA-Za-z])(?<!(?<![ء-يA-Za-z])جوال\s)(?<!(?<![ء-يA-Za-z])رقم\s)(?<!(?<![ء-يA-Za-z])هاتف\s)(?<!(?<![ء-يA-Za-z])صفة\s)(?<!(?<![ء-يA-Za-z])صفه\s)(?<!(?<![ء-يA-Za-z])نوع\s)(?<!(?<![ء-يA-Za-z])تصنيف\s)(و?(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:[ \t*]*(?:\r?\n[ \t*]*)?)(?:[\[(«"][ \t]*)?(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+(?:[ \t]+(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+){0,8}(?:[ \t]*[\])»"])?', '\1[redacted]', 'g')), '');
$function$;

do $do$
declare d text := pg_get_functiondef('public.mon_check_pii_leaks'::regproc);
  o text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?:\+|00)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
  n text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_check_pii_leaks no longer carries the expected phone-shapes pattern';
  end if;
  execute replace(d, o, n);
  if pg_get_functiondef('public.mon_check_pii_leaks'::regproc) not like '%٠٠%' then
    raise exception 'ABORT: mon_check_pii_leaks did not learn the international prefixes';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc);
  o text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?:\+|00)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
  n text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_scan_pii_capture_batch no longer carries the expected phone-shapes pattern';
  end if;
  execute replace(d, o, n);
  if pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc) not like '%٠٠%' then
    raise exception 'ABORT: mon_scan_pii_capture_batch did not learn the international prefixes';
  end if;
end $do$;

do $do$
declare s text; out text;
begin
  foreach s in array array['عقارات فلل قصور مصايف مزارع اراضي سكن استثماري في الأردن للبيع هاتف 00962791234567',
                           'للتواصل +966-11-500-1234.', 'Sales +966 13 800 1234 .', 'اتصلوا بنا الآن 966115001234',
                           'الرقم الموحد: +966920001234 مؤسسة', '+971 50 123 4567', '0020 1001234567', 'الافق ٠٠٥٦٤٠٠١٢٣٤ - x'] loop
    out := public._redact_pii_sql(s);
    if out !~ '\[redacted\]' or out ~ '[0-9٠-٩]([^0-9٠-٩]?[0-9٠-٩]){6}' or public._redact_pii_sql(out) is distinct from out then
      raise exception 'ABORT: % was not redacted idempotently (got %)', s, out;
    end if;
  end loop;
  foreach s in array array['رقم المخطط : 002345 0802 0801 مخطط', 'المخطط 002345-0815-0801 الارض',
                           'https://maps.google.com/?q=28.366812,45.966123456789', '?q=26.39,44.00123456789',
                           'ترخيص 7100306688', 'السعر 1,250,000 ريال', 'بسعر ٥٠٠٠٠٠ ريال'] loop
    if public._redact_pii_sql(s) is distinct from s then
      raise exception 'ABORT: % was changed to %', s, public._redact_pii_sql(s);
    end if;
  end loop;
end $do$;
