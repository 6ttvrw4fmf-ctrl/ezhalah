-- PDPL: the legacy phone rules stop cutting map coordinates (2026-10-02).
--
-- The three legacy number branches of the floor — (\+?966|00966)\s*5…, 0?5\d{8} and \y920… — have
-- no digit guard, so any 9 digits starting with 5 inside a number were redacted. Coordinates were
-- cut on cards and in captures: «maps?q=21.[redacted]91211,39.2», «?q=16.920…,42.[redacted]59»,
-- aqargate «adMapLatitude: 24.72201[redacted]6». Measured 2026-10-02 over every text column and
-- source_capture of every *_listings table: 549 cuts in the fraction of a TWO-digit number (16-50,
-- the cut starting 0-6 fraction digits in) across 17 tables. Every phone in that position followed
-- a 1- or 3-digit number instead — «0.[redacted]», «966.[redacted]», «996.[redacted]» (99 on aqar) —
-- and must stay redacted.
--
-- The guard (scrapers/common/pii.py _NOT_IN_A_COORDINATE, byte-for-byte; a test pins it): no legacy
-- match may start within the first 8 fraction digits of a number whose whole part is exactly two
-- digits. Nine fixed-width lookbehinds, valid in both Python re and PG AREs.
-- (1) public._redact_pii_sql: only the two legacy layers gain the guard; every other layer is
--     unchanged from 20260929020005.
-- (2) mon_check_pii_leaks() and (3) mon_scan_pii_capture_batch() (cron 65) carry the same legacy
--     branch and gain the same guard, so they do not report the coordinates the floor now keeps.
-- Already-cut coordinates cannot be rebuilt from our rows (the digits are gone); they heal when the
-- listing is re-captured from its source. Stored rows are unchanged by this migration: the guard
-- only ever removes a match, and «[redacted]» has no digits left to match.
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
      '(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})(\+?966|00966)\s*5\d[\d\s\-]{6,}', '[redacted]', 'g'),
      'واتس\S*\s*\d[\d\s\-]{6,}', '[redacted]', 'g'),
      '(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})(0?5\d{8}|\y920\d{5,8}\y)', '[redacted]', 'g'),
      '(?<![ء-يA-Za-z])(?<!(?<![ء-يA-Za-z])جوال\s)(?<!(?<![ء-يA-Za-z])رقم\s)(?<!(?<![ء-يA-Za-z])هاتف\s)(?<!(?<![ء-يA-Za-z])صفة\s)(?<!(?<![ء-يA-Za-z])صفه\s)(?<!(?<![ء-يA-Za-z])نوع\s)(?<!(?<![ء-يA-Za-z])تصنيف\s)(و?(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:[ \t*]*(?:\r?\n[ \t*]*)?)(?:[\[(«"][ \t]*)?(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+(?:[ \t]+(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+){0,8}(?:[ \t]*[\])»"])?', '\1[redacted]', 'g')), '');
$function$;

do $do$
declare d text := pg_get_functiondef('public.mon_check_pii_leaks'::regproc);
  o text := $x$(\+?966|00966|\y0)5[0-9]{8}|\y920[0-9]{5,8}\y|$x$;
  n text := $x$(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})(\+?966|00966|\y0)5[0-9]{8}|(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})\y920[0-9]{5,8}\y|$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_check_pii_leaks no longer carries the expected legacy mobile/920 pattern';
  end if;
  execute replace(d, o, n);
  if strpos(pg_get_functiondef('public.mon_check_pii_leaks'::regproc), n) = 0 then
    raise exception 'ABORT: mon_check_pii_leaks did not learn the coordinate guard';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc);
  o text := $x$(\+?966|00966|\y0)5[0-9]{8}|\y920[0-9]{5,8}\y|$x$;
  n text := $x$(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})(\+?966|00966|\y0)5[0-9]{8}|(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})\y920[0-9]{5,8}\y|$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_scan_pii_capture_batch no longer carries the expected legacy mobile/920 pattern';
  end if;
  execute replace(d, o, n);
  if strpos(pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc), n) = 0 then
    raise exception 'ABORT: mon_scan_pii_capture_batch did not learn the coordinate guard';
  end if;
end $do$;

do $do$
declare s text; out text;
begin
  -- coordinates survive (same shapes as the live cuts, digits invented)
  foreach s in array array['https://maps.google.com/maps?q=21.54012345691211,39.2', '?q=16.920816823732,42.5401234567859',
                           'adMapLatitude: 24.72201512345678, adMapLongitude: 46.6', 'خط العرض 21.44621512345679 واجهة',
                           '25.294036865234375%2C49.5401234567183594', 'q=16.92012345,44.1', '45.19665123456789',
                           '21,54012345691211'] loop
    if public._redact_pii_sql(s) is distinct from s then
      raise exception 'ABORT: coordinate % was changed to %', s, public._redact_pii_sql(s);
    end if;
  end loop;
  -- phones in the same position are still redacted, idempotently
  foreach s in array array['معافا : 966.512345678 للبيع', 'معافا : 996.512345678 للبيع', 'التواصل واتس اب. 0.512345678',
                           'رقم التواصل : (0.512345678)', 'زيارة: 996512345678', 'للتواصل 512345678', 'رقم 92012345 مؤسسة',
                           '+966 512345678', 'للتواصل 0512345678'] loop
    out := public._redact_pii_sql(s);
    if out !~ '\[redacted\]' or out ~ '5[0-9]{8}' or public._redact_pii_sql(out) is distinct from out then
      raise exception 'ABORT: % was not redacted idempotently (got %)', s, out;
    end if;
  end loop;
end $do$;
