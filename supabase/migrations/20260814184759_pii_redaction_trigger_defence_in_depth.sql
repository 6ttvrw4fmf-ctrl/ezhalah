-- PDPL barrier at the LAST possible hop: a database trigger no writer can bypass.
--
-- WHY THIS EXISTS. The Python barrier (scrapers/common/db.py::_redact_user_visible_text) is correct
-- and IS deployed — CI ran commit 6aecee41, which contains it, and the aqar sweep calls the guarded
-- upsert. Yet on 2026-08-14 row 2635162 was cleaned, re-written at 16:08:31, and came back carrying
-- «920016564» in `description`. Two facts pin it:
--   • the SAME write redacted `source_capture.source_text` (the OLD, pre-2026-08-10 redaction) but
--     NOT `description` (the new one) — so a writer is reaching the table without the new guard;
--   • there is NO `scrape_runs` row at 16:08, so the writer does not call begin_run() either.
-- A Python-side guard can only protect the paths that import it. This trigger protects the TABLE.
--
-- Scope is deliberately narrow and source-safe:
--   • only the free-text columns a user can read;
--   • only contact shapes — Saudi mobiles, 920 business lines, messaging links, e-mail;
--   • a value that is a bare number or a URL is left ALONE, so coordinates, prices, lot sizes,
--     REGA/FAL licences, deed/plan/parcel numbers and photo/QR links survive byte-identical.
-- Defence in depth: the Python barrier stays. This is the floor, not a replacement.

create or replace function trg_redact_user_visible_pii() returns trigger
language plpgsql as $$
declare
  cols constant text[] := array['description','title','street_name','residence_type',
                                'project_name','neighborhood','address_text','payment_terms'];
  c text; v text; nv text; rec jsonb := to_jsonb(NEW);
begin
  foreach c in array cols loop
    if not (rec ? c) then continue; end if;
    v := rec->>c;
    continue when v is null or length(btrim(v)) < 8;
    -- leave structured values untouched: a bare number or a URL carries no reachable contact
    continue when v ~ '^\s*https?://' or v ~ '^\s*-?[0-9][0-9,\.]*\s*$';
    nv := _redact_pii_sql(v);
    if nv is distinct from v then
      rec := jsonb_set(rec, array[c], coalesce(to_jsonb(nv), 'null'::jsonb));
    end if;
  end loop;
  NEW := jsonb_populate_record(NEW, rec);
  return NEW;
end $$;

comment on function trg_redact_user_visible_pii() is
  'PDPL floor. Strips broker contact details from user-visible free-text columns on EVERY write, '
  'whatever the writer. Numbers and URLs are skipped so licences/coordinates/prices survive. '
  'Python-side guard db.py::_redact_user_visible_text remains as the first line of defence.';

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