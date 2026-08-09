-- PDPL hardening (owner-approved Phase 1, 2026-08-09). Two changes, both data-protection only:
-- they do NOT alter any property fact, any search behaviour, or any filter result.
--
-- (1) REVOKE anon/authenticated SELECT on source_capture.
--     source_capture holds the de-tagged FULL TEXT of the scraped source page (schema aqar.v2-fulltext,
--     avg ~2.6k chars) and, on a handful of platforms, broker contact details lifted from that page.
--     It was readable by anyone holding the publishable anon key — verified live before this change by
--     fetching /rest/v1/aqar_residential_listings?select=id,source_capture with the anon key and getting
--     the full page text back. The APPLICATION NEVER READS IT: LIST_SELECT in src/data/remote.ts:1296
--     enumerates its columns explicitly and does not include source_capture, and no client query uses
--     select('*'). So revoking the column grant removes the exposure with zero product impact. The
--     service role (scrapers, parsers, triggers, sync) is unaffected.
--
-- (2) Redact Saudi phone numbers out of `description`.
--     description is rendered verbatim on the property card, so a broker mobile written into the advert
--     body was being republished by us. Only the phone token is replaced with «[محذوف]»; every property
--     fact in the text is preserved byte-for-byte. Patterns: +9665XXXXXXXX / 009665XXXXXXXX / 05XXXXXXXX
--     / 920XXXXXX / 9200XXXXX. Measured before applying: 74 active aqar rows, 0 elsewhere in description.
--     (An earlier estimate of ~7,900 was wrong — it used a loose 9-10-digit regex that also matched REGA
--     licence numbers and plot numbers. Verified with the strict Saudi-mobile pattern above.)

do $$
declare t record; n bigint; total bigint := 0;
begin
  -- (1) column-level revoke on every platform listing table
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'source_capture'
  loop
    execute format('revoke select (source_capture) on public.%I from anon, authenticated', t.table_name);
  end loop;

  -- (2) phone redaction in description, only where a Saudi phone shape is actually present
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'description'
      and c.table_name like '%\_listings'
  loop
    execute format($f$
      update public.%I
         set description = regexp_replace(description,
               '(\+?9665[0-9]{8}|009665[0-9]{8}|\m05[0-9]{8}\M|\m9200[0-9]{5}\M|\m920[0-9]{6}\M)',
               '[محذوف]', 'g')
       where description ~ '(\+?9665[0-9]{8}|009665[0-9]{8}|\m05[0-9]{8}\M|\m9200[0-9]{5}\M|\m920[0-9]{6}\M)'
    $f$, t.table_name);
    get diagnostics n = row_count;
    total := total + n;
    if n > 0 then raise notice 'redacted % row(s) in %', n, t.table_name; end if;
  end loop;
  raise notice 'TOTAL description rows redacted: %', total;
end $$;