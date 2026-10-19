-- PDPL: contact numbers in the shapes the floor missed (night audit 2026-09-28).
--
-- A fleet-wide scan of ACTIVE titles/descriptions found phones still printed on cards — ~230 on aqar
-- alone, plus aqarcity, rightcompound, dwelleo, vmksa, dealapp and a handful of others — in shapes
-- neither redact_pii() nor this floor knew: Arabic-Indic digits «٠٥٥١٢٣٤٥٦٧» (109 aqar rows), a
-- mobile split by spaces / dashes / dots «055 123 4567» or «0 5 5 1 …», the international form with
-- a bracketed trunk zero «+966 (0) 58 123 4567», a landline «٠١١ …», and «واتس اب : 5XXXXXXXX».
-- mon_check_pii_leaks() reported ONE row (a false positive) because it shared the same blind spots.
--
-- One pattern, every shape, either digit set; no digit may touch either end, so REGA/FAL licences
-- («٧٢٠٠…», «١١٠٠…»), commercial-registration numbers, prices and areas never match. It is
-- scrapers/common/pii.py _PHONE_SHAPES_RE byte-for-byte (a test pins the two), applied right after
-- the bracketed-loose pass, exactly where redact_pii() applies it.
--
-- (1) function public._redact_pii_sql gains that one layer; every other layer is unchanged.
-- (2) mon_check_pii_leaks() — the text-column PII sweep — learns the same shapes, so it would have
--     caught this and will catch a regression.
-- The existing zz_redact_pii triggers call the function on every write; the backfill is a separate,
-- batched no-op UPDATE of the matching rows (≤25k per statement), recorded in the PR.
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
      'واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?:\+|00)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])', '[redacted]', 'g'),
      '(\+?966|00966)\s*5\d[\d\s\-]{6,}', '[redacted]', 'g'),
      'واتس\S*\s*\d[\d\s\-]{6,}', '[redacted]', 'g'),
      '(0?5\d{8}|\y920\d{5,8}\y)', '[redacted]', 'g'),
      '(?<![ء-يA-Za-z])(?<!(?<![ء-يA-Za-z])جوال\s)(?<!(?<![ء-يA-Za-z])رقم\s)(?<!(?<![ء-يA-Za-z])هاتف\s)(?<!(?<![ء-يA-Za-z])صفة\s)(?<!(?<![ء-يA-Za-z])صفه\s)(?<!(?<![ء-يA-Za-z])نوع\s)(?<!(?<![ء-يA-Za-z])تصنيف\s)(و?(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:[ \t*]*(?:\r?\n[ \t*]*)?)(?:[\[(«"][ \t]*)?(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+(?:[ \t]+(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+){0,8}(?:[ \t]*[\])»"])?', '\1[redacted]', 'g')), '');
$function$;

do $do$
declare d text := pg_get_functiondef('public.mon_check_pii_leaks'::regproc);
  o text := $x$[A-Za-z]{2,})'$f$$x$;
  n text := $x$[A-Za-z]{2,}|واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?:\+|00)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩]))'$f$$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_check_pii_leaks no longer has the expected pattern tail';
  end if;
  execute replace(d, o, n);
end $do$;

do $do$
declare s text; out text;
begin
  foreach s in array array['للتواصل ٠٥٥١٢٣٤٥٦٧ شكرا', 'للتواصل: 055 123 4567', 'ابوغالية 0 5 5 1 2 3 4 5 6 7',
                           'للمفاهمه +966 (0) 58 123 4567', '00966 55 512 3456', 'واتس اب : 551234567',
                           'للتواصل / ٠١١٤٥٦٧٨٩٠', '0555.123.456 للاستفسار'] loop
    out := public._redact_pii_sql(s);
    if out !~ '\[redacted\]' or out ~ '[0-9٠-٩]([^0-9٠-٩]?[0-9٠-٩]){6}' then
      raise exception 'ABORT: % was not redacted (got %)', s, out;
    end if;
  end loop;
  foreach s in array array['رقم ترخيص الاعلان (٧٢٠٠٥١٢٣٤٥)', 'رخصة فال ١١٠٠٠١٢٣٤٥', 'سجل تجاري رقم : ١٠١٠١٢٣٤٥٦',
                           'ترخيص 7100306688', 'السعر 1,250,000 ريال', 'بسعر ٥٠٠٠٠٠ ريال', 'المساحة ٥٠٠ م'] loop
    if public._redact_pii_sql(s) is distinct from s then
      raise exception 'ABORT: % was changed to %', s, public._redact_pii_sql(s);
    end if;
  end loop;
  if pg_get_functiondef('public.mon_check_pii_leaks'::regproc) not like '%٩٦٦%' then
    raise exception 'ABORT: mon_check_pii_leaks did not learn the new shapes';
  end if;
end $do$;
