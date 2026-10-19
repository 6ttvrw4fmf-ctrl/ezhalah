-- PDPL: a mobile whose digit groups a right-to-left renderer reversed (2026-10-02).
--
-- aqar and aqarcity ads print «للتواصل : 00 44 33 0502» — the number 0502 33 44 00 with its groups in
-- display order — on 6 live rows. No earlier layer matches it (the 00-prefix rule wants one unbroken
-- digit run). One new alternative in the shapes layer (scrapers/common/pii.py _PHONE_SHAPES_RE,
-- byte-for-byte; a test pins the two): «00», two digits, two digits, «05» + two digits, each group
-- split by one separator. Nothing else matches that shape: plan numbers («002673 0802 0801»), dates
-- and a bare «0044330502» all survive (pinned).
-- (1) public._redact_pii_sql: that one layer changes; every other layer is unchanged.
-- (2) mon_check_pii_leaks() and (3) mon_scan_pii_capture_batch() (cron 65) learn the same shape.
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
      'واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|(?:00|٠٠)[\s.\-][0-9٠-٩]{2}[\s.\-][0-9٠-٩]{2}[\s.\-][0٠][5٥][0-9٠-٩]{2}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])', '[redacted]', 'g'),
      '(\+?966|00966)\s*5\d[\d\s\-]{6,}', '[redacted]', 'g'),
      'واتس\S*\s*\d[\d\s\-]{6,}', '[redacted]', 'g'),
      '(0?5\d{8}|\y920\d{5,8}\y)', '[redacted]', 'g'),
      '(?<![ء-يA-Za-z])(?<!(?<![ء-يA-Za-z])جوال\s)(?<!(?<![ء-يA-Za-z])رقم\s)(?<!(?<![ء-يA-Za-z])هاتف\s)(?<!(?<![ء-يA-Za-z])صفة\s)(?<!(?<![ء-يA-Za-z])صفه\s)(?<!(?<![ء-يA-Za-z])نوع\s)(?<!(?<![ء-يA-Za-z])تصنيف\s)(و?(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:[ \t*]*(?:\r?\n[ \t*]*)?)(?:[\[(«"][ \t]*)?(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+(?:[ \t]+(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+){0,8}(?:[ \t]*[\])»"])?', '\1[redacted]', 'g')), '');
$function$;

do $do$
declare d text := pg_get_functiondef('public.mon_check_pii_leaks'::regproc);
  o text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
  n text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|(?:00|٠٠)[\s.\-][0-9٠-٩]{2}[\s.\-][0-9٠-٩]{2}[\s.\-][0٠][5٥][0-9٠-٩]{2}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_check_pii_leaks no longer carries the expected phone-shapes pattern';
  end if;
  execute replace(d, o, n);
  if (length(pg_get_functiondef('public.mon_check_pii_leaks'::regproc)) - length(replace(pg_get_functiondef('public.mon_check_pii_leaks'::regproc), n, ''))) / length(n) <> 1 then
    raise exception 'ABORT: mon_check_pii_leaks did not learn the reversed-group mobile';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc);
  o text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
  n text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|(?:00|٠٠)[\s.\-][0-9٠-٩]{2}[\s.\-][0-9٠-٩]{2}[\s.\-][0٠][5٥][0-9٠-٩]{2}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_scan_pii_capture_batch no longer carries the expected phone-shapes pattern';
  end if;
  execute replace(d, o, n);
  if (length(pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc)) - length(replace(pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc), n, ''))) / length(n) <> 1 then
    raise exception 'ABORT: mon_scan_pii_capture_batch did not learn the reversed-group mobile';
  end if;
end $do$;

do $do$
declare s text; out text;
begin
  foreach s in array array['السعر قابل للتفاوض للتواصل : 00 44 33 0502.', 'للتواصل : ٠٠ ٤٤ ٣٣ ٠٥٠٢', '00-44-33-0502',
                           'عقارات فلل قصور مصايف مزارع اراضي سكن استثماري في الأردن للبيع هاتف 00962791234567', '+971 50 123 4567'] loop
    out := public._redact_pii_sql(s);
    if out !~ '\[redacted\]' or out ~ '[0-9٠-٩]([^0-9٠-٩]?[0-9٠-٩]){6}' or public._redact_pii_sql(out) is distinct from out then
      raise exception 'ABORT: % was not redacted idempotently (got %)', s, out;
    end if;
  end loop;
  foreach s in array array['رقم المخطط : 002345 0802 0801 مخطط', 'رقم المخطط 00 12 34 0802 0801', 'تاريخ 00 12 12 2025',
                           'رقم الطلب 0044330502', 'كود 0044 33 0502', 'كود 00 4433 0502', 'كود 00 44 330502',
                           'https://maps.google.com/?q=28.366812,45.966123456789', 'ترخيص 7100306688', 'السعر 1,250,000 ريال'] loop
    if public._redact_pii_sql(s) is distinct from s then
      raise exception 'ABORT: % was changed to %', s, public._redact_pii_sql(s);
    end if;
  end loop;
end $do$;
