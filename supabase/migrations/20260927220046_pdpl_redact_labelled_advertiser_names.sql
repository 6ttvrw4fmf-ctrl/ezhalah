-- PDPL (owner rule, permanent): never show an advertiser's or ad officer's NAME.
--
-- WHY. The DB floor (_redact_pii_sql, called by trg_redact_user_visible_pii on every write) only knew
-- contact SHAPES — phones, 920 lines, wa.me/t.me, e-mail. A name has no shape; it has a LABEL. REGA's
-- standard ad block prints «صاحب الترخيص : <licence holder>» and «الموظف المسؤول عن الإعلان: <employee>»,
-- and on 2026-09-27 a real-user test found one on a Jeddah dealapp card. Active rows measured the same
-- day: dealapp 4,363 employee names + 1,416 licence holders; aqar, tuba, dwelleo, muktamel and ~10
-- more platforms carry «المعلن:», «مسوق:», «مسؤول الإعلان:», «اسم المالك:» and friends.
--
-- WHAT. One more pass, after the phone passes: the label stays, the name becomes [redacted] — the
-- token phones already get. The pattern text is byte-identical to scrapers/common/pii.py
-- _NAME_LABEL_RE (a test pins that), so the Python guard and this floor cannot drift apart.
--   • a whole-word qualifier in front makes it a number/phone/role/terms field, NOT a name, and it
--     survives: «رقم المعلن: 7112226», «جوال المعلن», «صفة المعلن: وسيط», «عمولة الوسيط: على المشتري».
--   • a name is letters only, ≤9 words on one line, and stops at a digit, punctuation, a stop word
--     («رقم», «تاريخ», …) or the next «label:». «المدينة: جدة الحي: النرجس» is never touched —
--     places are not people, and no place label is in the list.
--   • idempotent: «المعلن: [redacted]» redacts to itself, so re-writes are stable.
--
-- ALSO. 54 *_listings tables created after 2026-08-14 never got the zz_redact_pii trigger at all
-- (no PDPL floor for phones either). Attach it wherever description+title exist and it is missing.
create or replace function public._redact_pii_sql(t text)
 returns text
 language sql
 immutable
as $function$
  select nullif(btrim(regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(coalesce(t,''),
      '(https?://)?(api\.whatsapp\.com/send\S*|wa\.me/\S+|t\.me/\S+|whatsapp[:\s]\S*)', '[redacted]', 'gi'),
      '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', '[redacted]', 'g'),
      '[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}', '[redacted]', 'g'),
      '(\+?966|00966)\s*5\d[\d\s\-]{6,}', '[redacted]', 'g'),
      'واتس\S*\s*\d[\d\s\-]{6,}', '[redacted]', 'g'),
      '(0?5\d{8}|\y920\d{5,8}\y)', '[redacted]', 'g'),
      '(?<![ء-يA-Za-z])(?<!(?<![ء-يA-Za-z])جوال\s)(?<!(?<![ء-يA-Za-z])رقم\s)(?<!(?<![ء-يA-Za-z])هاتف\s)(?<!(?<![ء-يA-Za-z])صفة\s)(?<!(?<![ء-يA-Za-z])صفه\s)(?<!(?<![ء-يA-Za-z])نوع\s)(?<!(?<![ء-يA-Za-z])تصنيف\s)(و?(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:[ \t*]*(?:\r?\n[ \t*]*)?)(?:[\[(«"][ \t]*)?(?!(?:رقم|الرقم|جوال|الجوال|هاتف|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+(?:[ \t]+(?!(?:رقم|الرقم|جوال|الجوال|هاتف|الهاتف|تاريخ|رخصة|رخصه|ترخيص|الترخيص|للتواصل|التواصل|تواصل|واتس|واتساب|الضمانات|نأمل)(?![ء-يA-Za-z])|[ء-يA-Za-z]+[ \t]*:|(?:(?:الموظف\s+)?(?:ال)?مس[ؤئو]ول(?:\s+عن)?\s+ال[إاأ]علان|الموظف\s+(?:ال)?مس[ؤئو]ول|صاحب\s+(?:ال)?ترخيص|(?:اسم\s+)?(?:ال)?معلن|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?مسوق[ةه]?(?:\s+(?:ال)?عقاري[ةه]?)?|(?<!(?<![ء-يA-Za-z])عمولة\s)(?<!(?<![ء-يA-Za-z])عموله\s)(?<!(?<![ء-يA-Za-z])أتعاب\s)(?<!(?<![ء-يA-Za-z])اتعاب\s)(?<!(?<![ء-يA-Za-z])سعي\s)(?:اسم\s+)?(?:ال)?وسيط(?:\s+(?:ال)?عقاري)?|اسم\s+(?:ال)?(?:مالك|موظف|وكيل))[ \t]*:)[ء-يA-Za-z]+){0,8}(?:[ \t]*[\])»"])?', '\1[redacted]', 'g')), '');
$function$;

comment on function public._redact_pii_sql(text) is
  'PDPL floor redactor used by trg_redact_user_visible_pii: contact shapes (phones, 920, wa.me/t.me, '
  'e-mail) AND labelled advertiser/ad-officer names («صاحب الترخيص :», «الموظف المسؤول عن الإعلان:», '
  '«المعلن:», «مسوق:», …). The name pattern is byte-identical to scrapers/common/pii.py _NAME_LABEL_RE.';

do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname like '%\_listings'
             and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'description' and not a.attisdropped)
             and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'title' and not a.attisdropped)
             and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'zz_redact_pii')
  loop
    execute format('create trigger zz_redact_pii before insert or update on public.%I '
                   'for each row execute function trg_redact_user_visible_pii()', r.relname);
  end loop;
end $$;
