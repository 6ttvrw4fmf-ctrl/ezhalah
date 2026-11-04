-- PROPERTY FINDER LAUNCH STEP 1 — apply ONLY when the owner launches (docs/ops/PROPERTYFINDER_LAUNCH.md).
-- (a) the two listing tables get the fleet's PDPL column grant (every column but source_capture — haraj's
--     20261016231026 grant), so a deep link / card can read a row; (b) the registry row leaves its staged
--     'retired' state for active+source, which arms every per-platform detector. Wiring into search is step 2.
DO $$
DECLARE t text; tbl text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    tbl := 'propertyfinder_' || t || '_listings';
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = tbl AND column_name <> 'source_capture';
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', cols, tbl);
  END LOOP;
END $$;

update public.platform_registry
   set status = 'active',
       notes = replace(notes, 'STAGED — NOT LAUNCHED', 'LAUNCHED by the owner ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') || ' (was staged from 2026-11-04)'),
       updated_at = now()
 where platform = 'propertyfinder' and status = 'retired';

do $verify$
declare t text; tbl text;
begin
  if not exists (select 1 from public.platform_registry where platform = 'propertyfinder' and status = 'active' and kind = 'source') then
    raise exception 'propertyfinder is not active+source';
  end if;
  foreach t in array array['residential','commercial'] loop
    tbl := 'propertyfinder_' || t || '_listings';
    if has_column_privilege('anon', 'public.' || tbl, 'source_capture', 'SELECT')
       or not has_column_privilege('anon', 'public.' || tbl, 'license_number', 'SELECT') then
      raise exception '% column grant is wrong: anon must read license_number and must NOT read source_capture', tbl;
    end if;
  end loop;
  raise notice 'propertyfinder: registry active, PDPL column grant in place';
end $verify$;
