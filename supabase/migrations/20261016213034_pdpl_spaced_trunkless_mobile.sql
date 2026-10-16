-- 🦅 Falcon, 2026-10-16. PDPL: a mobile WITHOUT its trunk zero, written in spoken groups, was served.
--
-- MEASURED (active rows, title + description, every *_listings table): 54 aqar_residential + 1 rightcompound
-- descriptions show a phone as «5X XXX XXXX» / «5X-XXX-XX-XX», every one behind «للتواصل» / «للحجز والاستفسار» /
-- «يمكنكم التواصل», often wrapped in invisible direction marks (U+200E, U+202D…U+202C); one ad shows «[redacted]»
-- beside a SECOND, spaced number. No layer matched it: the legacy rule wants «0?5» + 8 UNBROKEN digits and the
-- shapes layer wants the trunk zero. A wider first try («5» + 8 digits, any grouping) also caught a list of
-- warehouse sizes, so the alternative is the phone's own grouping only: 2, then 3, then 4 (or 2 + 2).
--
-- (1) public._redact_pii_sql: the shapes layer gains that one alternative, byte-identical to
--     scrapers/common/pii.py _PHONE_SHAPES_RE (scrapers/common/tests pin the two). Built from the live body
--     (md5 faa3776e…, = 20261002152128), so no earlier layer is lost.
-- (2) mon_check_pii_leaks() and mon_scan_pii_capture_batch() learn the same alternative.
-- (3) NEW robot mon_detect_pii_in_served_text: nothing called mon_check_pii_leaks() — no detector, no cron —
--     so a phone in a served title/description could sit unwatched. Once per ~20 h (the daily slot) it scans
--     every active title and description with the shapes layer and raises P1 naming the tables.
-- (4) REPAIR: the 55 rows are touched so the zz_redact_pii trigger re-runs the new floor on them.
-- Positives and negatives below are invented digits in the live shapes.
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
      'واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}|(?:00|٠٠)[\s.\-][0-9٠-٩]{2}[\s.\-][0-9٠-٩]{2}[\s.\-][0٠][5٥][0-9٠-٩]{2}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])', '[redacted]', 'g'),
      '(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})(\+?966|00966)\s*5\d[\d\s\-]{6,}', '[redacted]', 'g'),
      'واتس\S*\s*\d[\d\s\-]{6,}', '[redacted]', 'g'),
      '(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫])(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{1})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{2})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{3})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{4})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{5})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{6})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{7})(?<!(?<![0-9٠-٩])[0-9٠-٩]{2}[.,٫][0-9٠-٩]{8})(0?5\d{8}|\y920\d{5,8}\y)', '[redacted]', 'g'),
      '(?<![ء-يA-Za-z])(?<!(?<![ء-يA-Za-z])جوال\s)(?<!(?<![ء-يA-Za-z])رقم\s)(?<!(?<![ء-يA-Za-z])هاتف\s)(?<!(?<![ء-يA-Za-z])صفة\s)(?<!(?<![ء-يA-Za-z])صفه\s)(?<!(?<![ء-يA-Za-z])نوع\s)(?<!(?<![ء-يA-Za-z])تصنيف\s)(و?(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:[ \t*]*(?:\r?\n[ \t*]*)?)(?:[\[(«"][ \t]*)?(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+(?:[ \t]+(?!(?:الرقم|الجوال|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل|جوال|رقم|هاتف|صفة|صفه|نوع|تصنيف|عمولة|عموله|أتعاب|اتعاب|سعي)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+){0,8}(?:[ \t]*[\])»"])?', '\1[redacted]', 'g')), '');
$function$;

do $do$
declare d text := pg_get_functiondef('public.mon_check_pii_leaks'::regproc);
  o text := $x$[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|$x$;
  n text := $x$[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}|$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_check_pii_leaks no longer carries the expected phone-shapes alternative';
  end if;
  execute replace(d, o, n);
end $do$;

do $do$
declare d text := pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc);
  o text := $x$[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|$x$;
  n text := $x$[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}|$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_scan_pii_capture_batch no longer carries the expected phone-shapes alternative';
  end if;
  execute replace(d, o, n);
end $do$;

do $proof$
declare s text; out text;
begin
  foreach s in array array['للحجز والاستفسار ‎ 55 123 4567 ـــ', 'للتواصل: 59-123-45-67', '‭58 765 4321‬', '٥٥ ١٢٣ ٤٥٦٧ للتواصل',
                           '[redacted] 56 111 2222 للتواصل'] loop
    out := public._redact_pii_sql(s);
    if out !~ '\[redacted\]' or out ~ '[0-9٠-٩]([^0-9٠-٩]?[0-9٠-٩]){6}' or public._redact_pii_sql(out) is distinct from out then
      raise exception 'ABORT: % was not redacted idempotently (got %)', s, out;
    end if;
  end loop;
  foreach s in array array['مستودع 5 120 25 25 25', 'السعر 550 000 000 ريال', 'المساحة 55 1234 م', 'رقم المخطط 54 123',
                           'ترخيص 7100261149', 'رقم المخطط : 002345 0802 0801 مخطط', 'السعر 1,250,000 ريال'] loop
    if public._redact_pii_sql(s) is distinct from s then
      raise exception 'ABORT: % was changed to %', s, public._redact_pii_sql(s);
    end if;
  end loop;
end $proof$;

create or replace function public.mon_pii_in_served_text_rows()
 returns table(tbl text, rows_with_phone bigint)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare r record; n bigint;
  rx constant text := $x$واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?<![0-9٠-٩][.,٫])(?:\+|00|٠٠)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,9}|\+[\s.\-]*[1-9١-٩](?:[\s.\-]?[0-9٠-٩]){7,14}|(?<![0-9٠-٩][.,٫])(?:00|٠٠)[1-9١-٩][0-9٠-٩]{0,2}[\s.\-]?[0-9٠-٩]{8,11}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}|(?:00|٠٠)[\s.\-][0-9٠-٩]{2}[\s.\-][0-9٠-٩]{2}[\s.\-][0٠][5٥][0-9٠-٩]{2}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩])$x$;
begin
  for r in select c.table_name, bool_or(c.column_name = 'title') has_t, bool_or(c.column_name = 'description') has_d
             from information_schema.columns c
             join information_schema.tables t on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
            where c.table_schema = 'public' and c.table_name like '%\_listings' and c.column_name in ('title', 'description', 'active')
            group by 1 having bool_or(c.column_name = 'active') and (bool_or(c.column_name = 'title') or bool_or(c.column_name = 'description'))
  loop
    execute format('select count(*) from public.%I where active and (%s) ~ %L', r.table_name,
      case when r.has_t and r.has_d then 'coalesce(title, '''') || '' '' || coalesce(description, '''')'
           when r.has_d then 'coalesce(description, '''')' else 'coalesce(title, '''')' end, rx) into n;
    if n > 0 then tbl := r.table_name; rows_with_phone := n; return next; end if;
  end loop;
end
$function$;

create or replace function public.mon_detect_pii_in_served_text()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int := 0; sample jsonb;
begin
  -- ~20h gate: this walks every *_listings table (mon_detect_stalled_daily_detector watches the gate).
  if not public.mon_claim_daily_slot('mon_detect_pii_in_served_text') then
    return 0;
  end if;
  select count(*), jsonb_agg(jsonb_build_object('table', s.tbl, 'rows', s.rows_with_phone))
    into v_n, sample from public.mon_pii_in_served_text_rows() s;
  if v_n > 0 then
    perform public.mon_raise('P1', 'pii_in_served_text', 'pdpl', 'pii_in_served_text',
      jsonb_build_object('tables', v_n, 'sample', sample,
        'why', 'An active title or description still carries a phone number in a shape the redaction floor knows. '
            || 'The zz_redact_pii trigger runs on every write, so a row here was stored before the floor learned its '
            || 'shape, or reached the table without the trigger (PDPL: never serve a phone).',
        'fix', 'Touch the rows (update … set description = description) so the trigger re-runs _redact_pii_sql; if a '
            || 'table has no zz_redact_pii trigger, attach it. Evidence is table:id keys only — never print the text.'));
  else
    perform public.mon_resolve_key('pii_in_served_text', 'pii_in_served_text');
  end if;
  return v_n;
end
$function$;

do $roster$
declare d text; anchor text := '''mon_detect_district_option_split_by_spelling'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_pii_in_served_text''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_pii_in_served_text'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_pii_in_served_text''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- (4) REPAIR: re-run the trigger on exactly the rows the new alternative finds.
update public.aqar_residential_listings set description = description
 where active and description ~ '(?<![0-9٠-٩])[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}(?![0-9٠-٩])';
update public.rightcompound_residential_listings set description = description
 where active and description ~ '(?<![0-9٠-٩])[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}(?![0-9٠-٩])';

do $proof2$
declare r int;
begin
  r := (select count(*) from public.aqar_residential_listings where active and description ~
          '(?<![0-9٠-٩])[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}(?![0-9٠-٩])')
     + (select count(*) from public.rightcompound_residential_listings where active and description ~
          '(?<![0-9٠-٩])[5٥][0-9٠-٩][\s\-][0-9٠-٩]{3}[\s\-]?[0-9٠-٩]{2}[\s\-]?[0-9٠-٩]{2}(?![0-9٠-٩])');
  if r <> 0 then raise exception 'PROOF: % row(s) still serve the spaced trunkless mobile after the repair', r; end if;
  r := (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_pii_in_served_text');
  if r <> 0 then raise exception 'PROOF: the new detector reads as orphaned'; end if;
end
$proof2$;
