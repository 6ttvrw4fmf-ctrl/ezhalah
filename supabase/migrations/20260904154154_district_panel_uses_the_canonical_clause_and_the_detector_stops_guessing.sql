-- THE LAST STALE COPY OF THE CLAUSE, AND A DETECTOR THAT COULD NOT HAVE SEEN IT.
--
-- After 20260904143250 (canonical clause) and 20260904143656 (top_cities_by_deal_ar), an EXHAUSTIVE
-- sweep of every function in the schema found exactly one still carrying the pre-repair clause:
-- district_options_ar. Like top_cities_by_deal_ar it embeds the clause and is NOT in af_rpc_templates,
-- so no rebuild reaches it.
--
-- Measured on production before this migration — the district panel undercounting its own click-through
-- under a Buy budget of 400,000-900,000 in الرياض:
--
--     حي عكاظ   advertised 675   vs   click-through 676 (twice)   vs   independent DB truth 676
--
-- One row: a per-m²-only listing the derived total made budget-searchable, counted by the results RPC
-- and invisible to the district chip. R14.2.1 says the advertised count IS the count after clicking.
--
-- Same method as before, and for the same reason: the predicate is NOT retyped. The old clause occurs
-- exactly once verbatim and is swapped for the canonical one, with the old text reconstructed by the
-- exact inverse substitution and checked against the md5 captured before the repair.
--
-- AND THE CLASS, not the third example. mon_detect_af_count_surfaces_carry_af checked a HARDCODED list
-- of three functions, so top_cities_by_deal_ar was only caught because it happened to be on that list
-- and district_options_ar was never checked at all. Arm (e) below is CATALOG-DERIVED: any function
-- carrying the clause's own fingerprint must inline the CURRENT clause verbatim. A seventh surface
-- added tomorrow is covered the day it is written, with no list to remember.
--
-- The `mon\_%` exclusion is not tidiness, it is required, and a first attempt of this migration
-- proved it by failing closed: arm (e) has to QUOTE the fingerprint in order to search for it, so the
-- detector's own body matches the fingerprint and the detector reported ITSELF as a stale copy. A
-- monitor talks ABOUT the clause; it never serves a count with it. Excluding monitors is what keeps
-- the arm about surfaces users actually see.

do $mig$
declare
  oldc text; newc text; d text; occ int; n_over int; v_anon boolean;
  bad text := ''; r record; click bigint; v_city int;
begin
  newc := public.af_eligibility_clause();
  oldc := replace(newc, 's.price_total_effective ', 's.price_total ');
  if md5(oldc) <> (select clause_md5 from public.ops_af_rebuild_backup_20260904 limit 1) then
    raise exception 'reconstructed pre-repair clause does not match the captured md5 — refusing';
  end if;

  d := pg_get_functiondef('public.district_options_ar'::regproc);
  occ := (length(d) - length(replace(d, oldc, ''))) / length(oldc);
  if occ <> 1 then
    raise exception 'the pre-repair clause appears % time(s) in district_options_ar (expected exactly 1)', occ;
  end if;
  execute replace(d, oldc, newc);

  if position(newc in pg_get_functiondef('public.district_options_ar'::regproc)) = 0 then
    raise exception 'district_options_ar still does not inline the canonical clause verbatim';
  end if;
  select count(*) into n_over from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='district_options_ar' and p.prokind='f';
  if n_over <> 1 then raise exception 'district_options_ar has % overloads', n_over; end if;
  select has_function_privilege('anon', p.oid, 'EXECUTE') into v_anon
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='district_options_ar' and p.prokind='f';
  if not coalesce(v_anon,false) then raise exception 'anon lost EXECUTE on district_options_ar'; end if;

  -- advertised == click-through, on the case that exposed it and its neighbours
  select city_id into v_city from loc_catalog_city where city_ar='الرياض' limit 1;
  for r in select o.district_ar, o.match_values, o.listing_count
             from public.district_options_ar(p_city_id=>v_city, p_deal=>'بيع',
                  p_cities=>array['الرياض'], p_price_min=>400000, p_price_max=>900000) o
            where o.listing_count > 0 order by o.listing_count desc limit 8
  loop
    select r2.total_count into click from public.location_search_candidates_ar(
       p_deal=>'بيع', p_price_min=>400000, p_price_max=>900000, p_cities=>array['الرياض'],
       p_districts=>coalesce(r.match_values, array[r.district_ar]), p_limit=>1) r2 limit 1;
    if r.listing_count is distinct from click then
      bad := bad || format('%s advertised=%s click=%s; ', r.district_ar, r.listing_count, click);
    end if;
  end loop;
  if bad <> '' then raise exception 'district advertised count still disagrees with click-through: %', bad; end if;

  -- NOTHING ELSE MOVED: an unbudgeted district panel must be untouched by a Buy-budget-only edit
  for r in select o.district_ar, o.listing_count
             from public.district_options_ar(p_city_id=>v_city, p_deal=>'بيع', p_cities=>array['الرياض']) o
            where o.listing_count > 0 order by o.listing_count desc limit 5
  loop
    select r2.total_count into click from public.location_search_candidates_ar(
       p_deal=>'بيع', p_cities=>array['الرياض'], p_districts=>array[r.district_ar], p_limit=>1) r2 limit 1;
    if r.listing_count is distinct from click then
      bad := bad || format('unbudgeted %s advertised=%s click=%s; ', r.district_ar, r.listing_count, click);
    end if;
  end loop;
  if bad <> '' then raise exception 'an unbudgeted district count disagrees: %', bad; end if;
end
$mig$;

-- ── arm (e): the detector stops trusting a hardcoded list ────────────────────────────────────────
do $mig$
declare src text; anchor text; arm text;
begin
  src := pg_get_functiondef('public.mon_detect_af_count_surfaces_carry_af'::regproc);
  if position('af_clause_copy_stale' in src) > 0 then
    raise exception 'the catalog-derived arm is already present — refusing to double-apply';
  end if;
  anchor := E'  if jsonb_array_length(bad) > 0 then';
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'detector anchor not found exactly once';
  end if;

  arm := E'  -- (e) CATALOG-DERIVED, so a NEW surface is covered the day it is written. Any function\n'
      || E'  --     carrying the clause''s own fingerprint must inline the CURRENT clause verbatim. The\n'
      || E'  --     hardcoded list above could not see district_options_ar at all (2026-09-04), and only\n'
      || E'  --     saw top_cities_by_deal_ar because someone had remembered to add it. Monitors are\n'
      || E'  --     excluded because this arm must QUOTE the fingerprint to search for it, so without\n'
      || E'  --     that exclusion the detector reports ITSELF.\n'
      || E'  for fn in\n'
      || E'    select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace\n'
      || E'     where ns.nspname = ''public'' and p.prokind = ''f''\n'
      || E'       and p.proname <> ''af_eligibility_clause''\n'
      || E'       and p.proname not like ''mon\\_%''\n'
      || E'       and position(''-- CARDINALITY CAP (2026-08-15): an oversized array is anon-callable DoS'' in pg_get_functiondef(p.oid)) > 0\n'
      || E'       and position(v_clause in pg_get_functiondef(p.oid)) = 0\n'
      || E'     order by 1\n'
      || E'  loop\n'
      || E'    bad := bad || jsonb_build_object(''kind'',''af_clause_copy_stale'',''fn'',fn,\n'
      || E'      ''why'',''this function carries a COPY of af_eligibility_clause() that is no longer the ''\n'
      || E'         || ''current one, so its count can disagree with the results RPC. Swap the canonical ''\n'
      || E'         || ''clause in; do not retype the predicate.'');\n'
      || E'  end loop;\n\n'
      || anchor;

  execute replace(src, anchor, arm);
end
$mig$;

do $mig$
declare v int; stale int;
begin
  select count(*) into stale from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind='f' and p.proname <> 'af_eligibility_clause'
     and p.proname not like 'mon\_%'
     and position('-- CARDINALITY CAP (2026-08-15): an oversized array is anon-callable DoS' in pg_get_functiondef(p.oid)) > 0
     and position(public.af_eligibility_clause() in pg_get_functiondef(p.oid)) = 0;
  if stale <> 0 then raise exception '% surface(s) still carry a stale clause copy', stale; end if;

  -- and the arm must be ARMED, not merely present: it has to see a stale copy when one exists
  if position('af_clause_copy_stale' in pg_get_functiondef('public.mon_detect_af_count_surfaces_carry_af'::regproc)) = 0 then
    raise exception 'arm (e) is not compiled into the detector';
  end if;

  v := public.mon_detect_af_count_surfaces_carry_af();
  if v <> 0 then raise exception 'detector raised % after the repair', v; end if;
end
$mig$;
