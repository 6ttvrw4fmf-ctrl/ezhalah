-- PDPL fix, second attempt — the FIRST one silently did nothing and this documents why.
--
-- WHY THE COLUMN REVOKE FAILED: anon/authenticated hold TABLE-level SELECT on every listing table. In
-- PostgreSQL a table-level SELECT grant confers SELECT on all columns, and a column-level REVOKE cannot
-- carve a hole in it — the revoke is accepted silently and changes nothing. Verified live: after the first
-- migration, GET /rest/v1/aqar_residential_listings?select=id,source_capture with the ANON key still
-- returned the full scraped page text. The only correct construction is: REVOKE the table-level SELECT,
-- then GRANT SELECT on the explicit column list minus source_capture.
--
-- SAFETY: the app never reads source_capture — LIST_SELECT (src/data/remote.ts:1296) enumerates its columns
-- explicitly and omits it, and no client query uses select('*'). Searches read search_listings_ar (a
-- different table, which has no source_capture column at all), so search/filters are untouched. The
-- service_role keeps full access, so scrapers, parsers, the aqar_parse trigger and the hourly sync are
-- unaffected. Write privileges are left exactly as they were (they are already inert: RLS exposes only a
-- SELECT policy — verified live by attempting an anon PATCH and DELETE, both affected 0 rows).

do $$
declare t record; cols text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'source_capture'
  loop
    -- every column of this table EXCEPT source_capture, quoted
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = t.table_name and column_name <> 'source_capture';

    execute format('revoke select on public.%I from anon, authenticated', t.table_name);
    execute format('grant select (%s) on public.%I to anon, authenticated', cols, t.table_name);
  end loop;
end $$;