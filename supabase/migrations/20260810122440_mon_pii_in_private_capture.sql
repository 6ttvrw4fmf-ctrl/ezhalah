-- SUPERSEDED the same day by 20260810125629_mon_pii_capture_scanner_batched_stateful.sql.
-- Committed for migration-history parity with production (AGENTS.md "Migration drift guard").
--
-- Why it was replaced: mon_check_private_capture_pii() scanned every capture key of every listing
-- table in ONE statement and hit the statement timeout on aqar's largest key. A monitor that cannot
-- finish on our biggest platform verifies nothing.
create or replace function mon_check_private_capture_pii()
returns table(table_name text, key text, rows_with_contact_pii bigint)
language plpgsql stable as $$
declare r record; kk text; n bigint;
  keys text[] := array['source_text','description','title','addressText','locationAsPerDeed',
                       'content','gd','ob','notes','obligations'];
begin
  for r in select c.table_name from information_schema.columns c
           where c.table_schema='public' and c.table_name like '%\_listings'
             and c.column_name='source_capture' loop
    foreach kk in array keys loop
      execute format($f$select count(*) from public.%I
        where jsonb_typeof(source_capture)='object'
          and source_capture->>%L ~ '((\+?966|00966|\y0)5[0-9]{8}|\y920[0-9]{5,8}\y|(wa\.me|t\.me)/\s*[0-9A-Za-z]|[A-Za-z0-9._%%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'$f$,
        r.table_name, kk) into n;
      if n > 0 then
        table_name := r.table_name; key := kk; rows_with_contact_pii := n; return next;
      end if;
    end loop;
  end loop;
end $$;
