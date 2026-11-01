-- FIVE DETECTORS THAT THROW ON THE ONLY PATH THAT HAS SOMETHING TO REPORT.
--
-- `declare live text[] := '{}';` then `live := live || 'some_key';` does NOT append an element. The
-- literal is UNKNOWN-typed, so `||` resolves to anyarray || anyarray and Postgres tries to parse
-- 'some_key' AS AN ARRAY: 22P02 malformed array literal. Proven on this database:
--   bare literal      -> THROWS 22P02: malformed array literal: "x"
--   declared variable -> OK -> {y}
--   explicit ::text   -> OK -> {z}
-- The line only runs when the detector has a finding, so each of these is GREEN every time it has
-- nothing to say and BROKEN the moment it matters. mon_run_all_detectors() catches per-detector
-- exceptions into its `failed` list, so the sweep survives — and the finding is silently never
-- raised. A guard that cannot fire is not a guard.
--
-- Found by the "34 aqarmonthly street districts" session and relayed by the batch-7 session; both
-- declined to take it. mon_detect_aqarmonthly_card_district_drift is MINE (20260927203335) and I
-- shipped the bug by copying the shape from mon_detect_wasalt_dead_but_active, which has it too.
-- Measured here rather than taken from the relay: five functions carry uncast appends (7 in total),
-- and mon_detect_liveness_checking_shortfall — which a looser regex of mine first flagged as a
-- sixth — is already correct at 1 cast append of 1. Selection is by that measurement, not by name:
--   mon_detect_aqarmonthly_card_district_drift  2 of 2 uncast
--   mon_detect_district_bridge_leak             2 of 2 uncast
--   mon_detect_dead_qa_oracle_wrapper           1 of 1 uncast
--   mon_detect_inactive_still_searchable        1 of 1 uncast
--   mon_detect_wasalt_dead_but_active           1 of 1 uncast
-- The rewrite appends an explicit ::text to the literal and changes nothing else. It refuses loudly
-- rather than silently no-opping, and the post-check compares CAST appends against ALL appends per
-- function, because the naive check ("still contains `live := live || '`") matches the fixed form
-- too — the prefix is identical. That looseness aborted two earlier attempts of this migration.
do $mig$
declare r record; v_def text; v_new text; v_fixed int := 0; v_bad int := 0;
begin
  for r in
    select p.oid as oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'mon_detect_%'
       and regexp_count(pg_get_functiondef(p.oid), E'live := live \\|\\| ''')
         > regexp_count(pg_get_functiondef(p.oid), E'live := live \\|\\| ''(?:[^'']|'''')*''::text')
     order by p.proname
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, E'(live := live \\|\\| )(''(?:[^'']|'''')*'')(::text)?', E'\\1\\2::text', 'g');
    if v_new = v_def then
      raise exception 'refusing to continue: rewrite was a no-op for %', r.proname;
    end if;
    execute v_new;
    v_fixed := v_fixed + 1;
  end loop;

  select count(*) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mon_detect_%'
     and regexp_count(pg_get_functiondef(p.oid), E'live := live \\|\\| ''')
       <> regexp_count(pg_get_functiondef(p.oid), E'live := live \\|\\| ''(?:[^'']|'''')*''::text');

  if v_fixed <> 5 then
    raise exception 'expected 5 detectors to rewrite, rewrote %', v_fixed;
  end if;
  if v_bad <> 0 then
    raise exception '% detector(s) still carry an uncast append after rewriting %', v_bad, v_fixed;
  end if;
  raise notice 'rewrote % detector(s); every append in every mon_detect_* is now explicitly ::text', v_fixed;
end $mig$;

-- THE NULL I WROTE UNCOVERED A STALE BRIDGE VALUE.
--
-- listing_native_location_v1 ends COALESCE(native district_ar, lal.district_ar), so clearing the
-- platform-table district does not remove a district from SEARCH — it reveals whatever
-- listings_arabic_locations still holds. Repair 20260927201934 set AQM6095977's district to NULL
-- (its slug names no district the catalog confirms), and search_listings_ar promptly began serving
-- the bridge's «الشرق الرياض» instead: the city glued onto a fragment, and «شرق» is catalogued in
-- تيماء / الدمام / المدينة المنورة / المجاردة — never in الرياض. The card shows nothing while search
-- claims a district: exactly the card/search disagreement 20260927201934 exists to end, one layer
-- down. The sibling session cleared 13 such rows for the street class in 20260927213758 and left
-- this one to its author.
--
-- Scoped by RULE, not by id: an aqarmonthly row whose own district is NULL and whose bridge value
-- is not catalog-attested for that row's city. Measured now: exactly 1 row matches, and 0 rows with
-- a catalogued bridge value are touched — legitimate bridge enrichment is left alone.
do $mig$
declare n int;
begin
  update public.listings_arabic_locations lal
     set district_ar = null
    from public.aqarmonthly_residential_listings a
   where lal.source_table = 'aqarmonthly_residential_listings'
     and lal.listing_id = a.id
     and a.district_ar is null
     and lal.district_ar is not null
     and not exists (select 1 from public.loc_catalog_district d
                      where d.city_id = a.city_id
                        and d.district_norm = public.norm_district_tok(lal.district_ar));
  get diagnostics n = row_count;
  raise notice 'cleared % uncatalogued bridge district(s) uncovered by 20260927201934', n;
end $mig$;
