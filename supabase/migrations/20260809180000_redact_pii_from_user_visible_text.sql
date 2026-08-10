-- PDPL repair + detector: broker contact details must never live in the columns the app RENDERS.
--
-- Root cause is closed in scrapers/common/db.py::_redact_user_visible_text, called on EVERY upsert
-- path. This migration cleans what the open write path already wrote, and ships the detector that
-- was missing the first time.
--
-- History that justifies the detector: on 2026-08-09 a one-off UPDATE cleaned 9,785 descriptions and
-- the work was reported FIXED. Ingestion was never changed, so within hours aqar was back to 1,895
-- descriptions with Saudi mobiles, 684 with WhatsApp/Telegram links and 194 with e-mail addresses —
-- several beside the agent's name («حسام : 05XXXXXXXX»). Data repair without closing the write path
-- is a delay, not a fix.
--
-- PostgreSQL regex note: \b is BACKSPACE, not a word boundary — \y is used.
create table if not exists pii_text_redaction_repair_20260809 (
  table_name text, row_id bigint, col text, old_value text, captured_at timestamptz default now()
);

create or replace function _redact_pii_sql(t text) returns text language sql immutable as $fn$
  select nullif(btrim(regexp_replace(
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
      '(0?5\d{8}|\y920\d{5,8}\y)', '[redacted]', 'g')), '');
$fn$;

do $$
declare r record; c text;
begin
  for r in select t.table_name from information_schema.tables t
           where t.table_schema='public' and t.table_name like '%\_listings' loop
    foreach c in array array['description','title'] loop
      if not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name=r.table_name and column_name=c) then
        continue;
      end if;
      execute format($f$insert into pii_text_redaction_repair_20260809(table_name,row_id,col,old_value)
        select %L, id, %L, %I from public.%I
        where %I is not null and %I is distinct from _redact_pii_sql(%I)$f$,
        r.table_name, c, c, r.table_name, c, c, c);
      execute format($f$update public.%I set %I = _redact_pii_sql(%I)
        where %I is not null and %I is distinct from _redact_pii_sql(%I)$f$,
        r.table_name, c, c, c, c, c);
    end loop;
  end loop;
end $$;
