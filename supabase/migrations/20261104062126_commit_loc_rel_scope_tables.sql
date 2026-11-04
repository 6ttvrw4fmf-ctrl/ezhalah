-- COMMIT loc_rel_scope_tables() — a production-only object the loc_rel rotation depends on (2026-11-04).
--
-- loc_rel_refresh_tick() has always read loc_rel_scope_tables(), and 20261104061546 now sizes each tick from it, yet no
-- committed migration created it (verify-committed-sql-defines-what-it-calls.ts: the incident-#26 class). This is the
-- live definition, byte-for-byte from pg_get_functiondef on 2026-11-04, so applying it changes nothing in production;
-- it only makes the repo able to rebuild what production runs.
CREATE OR REPLACE FUNCTION public.loc_rel_scope_tables()
 RETURNS TABLE(source_table text, platform text, category_group text, has_capture boolean, has_scraped_at boolean)
 LANGUAGE sql
 STABLE
AS $function$
  select c.relname,
         regexp_replace(c.relname, '_(residential|commercial)_listings$', ''),
         case when c.relname ~ '_commercial_listings$' then 'commercial' else 'residential' end,
         exists (
           select 1 from information_schema.columns col
           where col.table_schema = 'public' and col.table_name = c.relname
             and col.column_name = 'source_capture'
         ),
         exists (
           select 1 from information_schema.columns col
           where col.table_schema = 'public' and col.table_name = c.relname
             and col.column_name = 'scraped_at'
         )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (c.relname ~ '_residential_listings$' or c.relname ~ '_commercial_listings$')
    and c.relname not like 'deal\_%'
$function$;
