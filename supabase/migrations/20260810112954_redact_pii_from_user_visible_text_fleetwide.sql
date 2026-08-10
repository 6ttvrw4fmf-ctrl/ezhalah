-- PDPL repair: strip broker contact details from the columns the app RENDERS, every platform.
--
-- Root cause is closed in scrapers/common/db.py::_redact_user_visible_text (called on every upsert
-- path). This migration cleans what the open write path already wrote. Doing only this half is what
-- failed on 2026-08-09 earlier: 9,785 descriptions were cleaned, ingestion kept writing new ones,
-- and within hours aqar was back to 1,895 phones / 684 WhatsApp links / 194 e-mails.
--
-- Patterns mirror scrapers/common/pii.py::redact_pii. NOTE: PostgreSQL regex \b is BACKSPACE, not a
-- word boundary — \y is used instead.
--
-- Reversible: every pre-change value is snapshotted with its table, row id and column.

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
      '(0?5\d{8}|\y9200\d{4,8}\y|\y920\d{6}\y)', '[redacted]', 'g')), '');
$fn$;

do $$
declare r record; c text; n bigint;
begin
  for r in
    select t.table_name
    from information_schema.tables t
    where t.table_schema='public' and t.table_name like '%\_listings'
  loop
    foreach c in array array['description','title'] loop
      -- skip tables that lack the column
      if not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name=r.table_name and column_name=c) then
        continue;
      end if;
      execute format($f$
        insert into pii_text_redaction_repair_20260809(table_name,row_id,col,old_value)
        select %L, id, %L, %I from public.%I
        where %I is not null and %I is distinct from _redact_pii_sql(%I)$f$,
        r.table_name, c, c, r.table_name, c, c, c);
      execute format($f$
        update public.%I set %I = _redact_pii_sql(%I)
        where %I is not null and %I is distinct from _redact_pii_sql(%I)$f$,
        r.table_name, c, c, c, c, c);
    end loop;
  end loop;
end $$;

select count(*) rows_repaired, count(distinct table_name) tables_touched
from pii_text_redaction_repair_20260809;
