-- listing_rich_attrs is read-only to the public key again. 20261022230940 rebuilt the view with the older
-- pattern's «GRANT ALL … TO … anon, authenticated» AFTER the born-revoked event trigger had stripped writes
-- (verify-mon-views-are-not-public.ts caught it on PR #8285). A UNION ALL view cannot be written through,
-- so nothing was writable in practice — but every public view must be read-only, and this one now is.
set local statement_timeout = '1min';
revoke insert, update, delete, truncate on table public.listing_rich_attrs from public, anon, authenticated;

do $proof$
begin
  if has_table_privilege('anon', 'public.listing_rich_attrs', 'INSERT')
     or has_table_privilege('anon', 'public.listing_rich_attrs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.listing_rich_attrs', 'DELETE') then
    raise exception 'PROOF: listing_rich_attrs is still writable by the public key';
  end if;
  if not has_table_privilege('anon', 'public.listing_rich_attrs', 'SELECT') then
    raise exception 'PROOF: the public key lost read access to listing_rich_attrs';
  end if;
end $proof$;
