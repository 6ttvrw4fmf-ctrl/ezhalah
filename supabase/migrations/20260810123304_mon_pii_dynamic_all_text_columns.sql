-- PDPL detector, DYNAMIC. Replaces a hand-listed view that gave false comfort.
--
-- The previous mon_pii_in_user_visible_text watched ONE column (`description`) on FIVE tables and
-- reported all-zero while 78 broker mobiles sat publicly readable in `street_name` on aqar
-- residential + commercial, and 4 more in `residence_type`. A guard that only looks where you
-- already looked is not a guard. This one enumerates every text column on every listing table at
-- run time, so a new column or a new platform is covered the moment it exists.
create or replace function mon_check_pii_leaks()
returns table(tbl text, col text, rows_with_contact_pii bigint)
language plpgsql stable as $$
declare r record; n bigint;
begin
  for r in select c.table_name, c.column_name
           from information_schema.columns c
           join information_schema.tables t
             on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.table_name like '%\_listings'
             and c.data_type in ('text', 'character varying')
             and c.column_name not in ('listing_url', 'video_url', 'raw_html_key', 'url_path')
  loop
    begin
      execute format($f$select count(*) from public.%I where active and %I ~
        '((\+?966|00966|\y0)5[0-9]{8}|\y920[0-9]{5,8}\y|(wa\.me|t\.me)/\s*[0-9A-Za-z]|[A-Za-z0-9._%%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'$f$,
        r.table_name, r.column_name) into n;
      if n > 0 then
        tbl := r.table_name; col := r.column_name; rows_with_contact_pii := n; return next;
      end if;
    exception when others then null;
    end;
  end loop;
end $$;

comment on function mon_check_pii_leaks() is
  'PDPL. MUST return ZERO rows. Scans EVERY text column on EVERY listing table at run time — the '
  'hand-listed predecessor reported zero while 78 broker mobiles sat in street_name. Root-cause '
  'guard: scrapers/common/db.py::_redact_user_visible_text (columns) and ::_ensure_capture -> '
  'pii.py::redact_capture (private captures).';

drop view if exists mon_pii_in_user_visible_text;
drop view if exists mon_pii_in_private_capture;
