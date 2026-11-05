-- THREE OF THE FIVE SOURCES LAUNCH STEP (asasmakeen, mrajhi, steam; owner said launch 2026-11-05; KW + Almajdiah launch separately) — apply ONLY when the owner says launch (docs/ops/FIVE_SOURCES_LAUNCH.md), in file order.
-- Generated 2026-11-05 from the APPLIED Property Finder launch migration 20261104180000 (the newest shape of this step) with the
-- platform list changed to the three sources (Asas Makeen, Al Rajhi, STeam). It refuses if the live shape moved: re-generate, never force.
-- (a) the 10 listing tables get the fleet's PDPL column grant (every column but source_capture); (b) the five registry
-- rows leave 'retired' for active+source, which arms every per-platform detector. Wiring into search is step 02.
DO $$
DECLARE tbl text; cols text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['asasmakeen_residential_listings','asasmakeen_commercial_listings','mrajhi_residential_listings','mrajhi_commercial_listings','steam_residential_listings','steam_commercial_listings'] LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = tbl AND column_name <> 'source_capture';
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', cols, tbl);
  END LOOP;
END $$;

update public.platform_registry
   set status = 'active',
       notes = replace(notes, 'STAGED — NOT LAUNCHED', 'LAUNCHED by the owner ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') || ' (was staged from 2026-11-05)'),
       updated_at = now()
 where platform in ('asasmakeen','mrajhi','steam') and status = 'retired';

do $verify$
declare tbl text;
begin
  if (select count(*) from public.platform_registry where platform in ('asasmakeen','mrajhi','steam') and status = 'active' and kind = 'source') <> 3 then
    raise exception 'the three sources (Asas Makeen, Al Rajhi, STeam) are not all active+source';
  end if;
  foreach tbl in array array['asasmakeen_residential_listings','asasmakeen_commercial_listings','mrajhi_residential_listings','mrajhi_commercial_listings','steam_residential_listings','steam_commercial_listings'] loop
    if has_column_privilege('anon', 'public.' || tbl, 'source_capture', 'SELECT')
       or not has_column_privilege('anon', 'public.' || tbl, 'license_number', 'SELECT') then
      raise exception '% column grant is wrong: anon must read license_number and must NOT read source_capture', tbl;
    end if;
  end loop;
  raise notice 'three sources: registry active, PDPL column grant in place on all 10 tables';
end $verify$;
