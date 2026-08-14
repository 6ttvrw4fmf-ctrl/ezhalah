-- PDPL barrier at the LAST possible hop: a database trigger no writer can bypass.
--
-- WHY. The Python guard (scrapers/common/db.py::_redact_user_visible_text) is correct AND deployed
-- — CI ran commit 6aecee41 which contains it, and the aqar sweep calls the guarded upsert. Yet on
-- 2026-08-14 row 2635162 of aqar_residential_listings was cleaned, re-written at 16:08:31, and came
-- back carrying «920016564» in `description`. Two facts pin the writer as OUTSIDE the guarded path:
--   • the same write redacted source_capture.source_text (the pre-2026-08-10 redaction) but NOT
--     description (the newer one) — so it ran a code path that has one and not the other;
--   • there is NO scrape_runs row at 16:08, so it is not one of the registered scrapers.
-- A Python guard protects the callers that import it. This protects the TABLE.
--
-- Source-safe by construction: _redact_pii_sql rewrites ONLY contact shapes (Saudi mobiles, 920
-- business lines, wa.me/t.me links, e-mail). REGA/FAL licences, deed/plan/parcel numbers,
-- coordinates and prices contain none of those shapes and pass through byte-identical — proven
-- live: «ترخيص 7100306688» survived a write whose phone numbers were stripped in the same string.
--
-- Defence in depth: the Python guard stays and still covers street_name, residence_type,
-- project_name, neighborhood, address_text, payment_terms. This trigger is the floor.
--
-- NOTE: an earlier revision round-tripped NEW through jsonb_populate_record(); the trigger fired but
-- the assignment silently did not take (verified live). Direct field assignment is unambiguous.
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
  'writer. Contact shapes only: licences, deeds, coordinates and prices are untouched. '
  'db.py::_redact_user_visible_text remains the first line of defence.';

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
