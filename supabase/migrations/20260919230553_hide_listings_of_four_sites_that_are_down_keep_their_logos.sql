-- FOUR SOURCE SITES ARE DOWN. Hide their listings; KEEP the platforms and their logos.
-- Owner instruction 2026-09-19: "LETS REMOVE THESE LISTINGS OK RIGHT NOW BUT WE INCLUDE THERE
-- LOGOS OK CUZ ITS TEMPORARY DOWN BUT LETS HIDE THERE LISTINGS OK"
--
-- Verified by direct probe AND in a real rendering browser on 2026-09-19:
--   eastabha.sa      HTTP 200, title "Coming Soon" — Hostinger placeholder, "New WordPress website
--                    is being built and will be published soon". Every deep link 302s to the apex.
--   24.com.sa        HTTP 200, redirects to /cgi-sys/suspendedpage.cgi — "This Account has been
--                    suspended. Contact your hosting provider." (souq24)
--   sadin.com.sa     HTTP 502 Bad Gateway (nginx/1.24.0)
--   1october.com.sa  HTTP 502 / no response (october)
--
-- NONE of these is a block on us: a block returns 403/Access Denied/a challenge. A "Coming Soon"
-- page and a cPanel suspension page are what these hosts serve to EVERY visitor. Not our doing —
-- but failing to notice was: eastabha's rows carried last_seen_at = today while the site had been a
-- placeholder since early September, because liveness asked "did the page answer?" and a placeholder
-- answers 200. That oracle gap is tracked separately; this migration only stops the bleeding.
--
-- WHAT THIS DOES *NOT* DO — deliberately:
--   • It does NOT touch platform_registry. All four stay ACTIVE platforms with their logos on the
--     card and in the search animation, per the owner's standing rule that a source which fails is
--     still one of our platforms and is never removed.
--   • It does NOT delete a single listing row. Rows are set active=false and keep their data, so
--     when these sites come back (eastabha literally says it is rebuilding) the next successful
--     scrape resurrects them with no loss.

do $$
declare
  v_tbl        text;
  v_deact      bigint := 0;
  v_one        bigint;
  v_pruned     bigint;
  v_left       bigint;
  v_registry   bigint;
  c_tables constant text[] := array[
    'eastabha_residential_listings', 'eastabha_commercial_listings',
    'souq24_residential_listings',   'souq24_commercial_listings',
    'sadin_residential_listings',    'sadin_commercial_listings',
    'october_residential_listings',  'october_commercial_listings'
  ];
begin
  -- 1. Deactivate. deactivated_at is set by the set_deactivated_at trigger where it exists; set it
  --    explicitly too so the reason-in-time is recorded even on tables without that trigger.
  foreach v_tbl in array c_tables loop
    if to_regclass('public.' || v_tbl) is null then
      raise exception 'expected table public.% is missing — refusing to half-apply', v_tbl;
    end if;
    execute format(
      'update public.%I set active = false, deactivated_at = coalesce(deactivated_at, now()) '
      'where active', v_tbl);
    get diagnostics v_one = row_count;
    v_deact := v_deact + v_one;
    raise notice 'deactivated % row(s) in %', v_one, v_tbl;
  end loop;

  -- 2. Drop them out of search through the SHARED prune path, not a bespoke delete, so this behaves
  --    exactly like every other deactivation and cannot diverge from it.
  v_pruned := public.prune_inactive_from_search();
  raise notice 'prune_inactive_from_search removed % row(s) overall', v_pruned;

  -- 3. GUARD: nothing from these four may still be searchable.
  select count(*) into v_left from public.search_listings_ar
   where split_part(source_table, '_', 1) in ('eastabha','souq24','sadin','october');
  if v_left <> 0 then
    raise exception 'REFUSING: % row(s) from the four down sites are still in search', v_left;
  end if;

  -- 4. GUARD: the owner asked for the logos to STAY. If this migration ever cost them their
  --    platform rows it would have broken the instruction it was written to follow.
  select count(*) into v_registry from public.platform_registry
   where platform in ('eastabha','souq24','sadin','october') and status = 'active';
  if v_registry <> 4 then
    raise exception 'REFUSING: expected all 4 platforms still active in the registry, found %',
      v_registry;
  end if;

  raise notice 'DONE: % listing(s) hidden, all 4 platforms still active and keeping their logos',
    v_deact;
end $$;

-- Post-condition, executed: the inventory detector must see no unreachable served rows introduced
-- by this change. mon_detect_search_scope_unreachable_inventory is the routine that owns that claim.
select public.mon_detect_search_scope_unreachable_inventory() as unreachable_inventory_after;
