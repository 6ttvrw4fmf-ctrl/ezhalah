-- Fix: the first version of this trigger round-tripped NEW through jsonb_populate_record() and the
-- assignment silently did not take (trigger fired, value unchanged — verified live on row 2635162).
-- Direct field assignment is unambiguous. `description` and `title` exist on every listing table
-- that carries a description, which is the attachment condition below.
--
-- Purpose unchanged: a PDPL floor no writer can bypass. The Python guard
-- (db.py::_redact_user_visible_text) is correct and deployed, yet on 2026-08-14 row 2635162 was
-- re-written at 16:08 with «920016564» back in `description` — by a path that redacted
-- source_capture (old code) but not description (new code), and that logged no scrape_runs row.
-- A guard in Python protects the callers that import it; this protects the TABLE.
--
-- Source-safe by construction: _redact_pii_sql only rewrites contact shapes (Saudi mobiles, 920
-- lines, wa.me/t.me links, e-mail). Licences, deeds, plan/parcel numbers, coordinates and prices
-- contain none of those shapes and pass through byte-identical.
create or replace function trg_redact_user_visible_pii() returns trigger
language plpgsql as $$
begin
  if NEW.description is not null then
    NEW.description := _redact_pii_sql(NEW.description);
  end if;
  if NEW.title is not null then
    NEW.title := _redact_pii_sql(NEW.title);
  end if;
  return NEW;
end $$;

comment on function trg_redact_user_visible_pii() is
  'PDPL floor. Strips broker contact details from description/title on EVERY write, whatever the '
  'writer — added after a non-scraper path reintroduced a phone number that the Python guard, '
  'though deployed, never saw. Contact shapes only: licences, deeds, coordinates and prices are '
  'untouched. db.py::_redact_user_visible_text remains the first line of defence and covers the '
  'other free-text columns.';

do $$
declare r record;
begin
  for r in select c.table_name from information_schema.columns c
           join information_schema.tables t on t.table_name=c.table_name
             and t.table_schema='public' and t.table_type='BASE TABLE'
           where c.table_schema='public' and c.table_name like '%\_listings'
             and c.column_name='description'
  loop
    execute format('drop trigger if exists zz_redact_pii on public.%I', r.table_name);
    execute format('create trigger zz_redact_pii before insert or update on public.%I '
                   'for each row execute function trg_redact_user_visible_pii()', r.table_name);
  end loop;
end $$;