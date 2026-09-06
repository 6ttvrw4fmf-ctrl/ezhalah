-- THE TRENDING CITY CHIP WAS COUNTING A DIFFERENT SET THAN CLICKING IT RETURNED.
--
-- #1661 rewired FOUR AF/search entry points to `price_total_effective` (the per-m² × area derived
-- total, owner rule 2026-09-03). `top_cities_by_deal_ar` is a FIFTH surface that embeds
-- af_eligibility_clause() and it was not rewired — and, unlike the other four, it is not in
-- af_rpc_templates, so rebuild_af_filter_rpcs() never reaches it.
--
-- That is a live R14.2.1 violation, measured on production before this migration, under a plain
-- Buy budget of 400,000–900,000 SAR — chip vs. the count clicking that city actually returns:
--
--     الرياض           13,664  vs  13,673   (-9)
--     جدة              10,835  vs  10,925   (-90)
--     الدمام            3,577  vs   3,582   (-5)
--     مكة المكرمة       2,582  vs   2,636   (-54)
--     الخبر             2,213  vs   2,242   (-29)
--     المدينة المنورة    1,585  vs   1,617   (-32)
--
-- Every chip UNDERSTATED, because the per-m²-only listings that the derived total made budget-
-- searchable are counted by the results RPC and were invisible to the chip. Owner rule 2026-08-22:
-- count shown = click-through result count = RPC truth = DB truth.
--
-- THE PREDICATE IS NOT RETYPED — that is what mon_detect_af_count_surfaces_carry_af's own guidance
-- demands, and it is the rule that keeps one definition of eligibility. The OLD clause occurs
-- EXACTLY ONCE, verbatim, in this function; it is swapped for the canonical one. The old text is
-- itself reconstructed from the live clause by the exact inverse substitution and checked against
-- the md5 captured before today's repair (1ad7fee69acebe472558d066e43ae156), so the thing being
-- replaced is provably the thing that was there.
--
-- WHAT MUST NOT MOVE: the clause edit touches only the BUY budget comparison. Unbudgeted Buy,
-- unbudgeted Rent, a Rent budget (which reads price_annual) and a stacked AF state must all return
-- byte-identical counts. 32 such rows were captured before and are re-checked after; any drift rolls
-- this back.

do $mig$
declare
  oldc text; newc text; d text; occ int; n_over int; v_anon boolean;
  bad text := ''; r record; chip bigint; click bigint;
begin
  newc := public.af_eligibility_clause();
  oldc := replace(newc, 's.price_total_effective ', 's.price_total ');

  if md5(oldc) <> (select clause_md5 from public.ops_af_rebuild_backup_20260904 limit 1) then
    raise exception 'reconstructed pre-repair clause does not match the captured md5 — refusing to swap blind';
  end if;
  if newc = oldc then
    raise exception 'the canonical clause does not carry the derived total — run the clause repair first';
  end if;

  d := pg_get_functiondef('public.top_cities_by_deal_ar'::regproc);
  occ := (length(d) - length(replace(d, oldc, ''))) / length(oldc);
  if occ <> 1 then
    raise exception 'the pre-repair clause appears % time(s) in top_cities_by_deal_ar (expected exactly 1)', occ;
  end if;

  execute replace(d, oldc, newc);

  -- the canonical clause must now be inlined VERBATIM (this is the detector's actual condition)
  if position(newc in pg_get_functiondef('public.top_cities_by_deal_ar'::regproc)) = 0 then
    raise exception 'top_cities_by_deal_ar still does not inline af_eligibility_clause() verbatim';
  end if;

  select count(*) into n_over from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='top_cities_by_deal_ar' and p.prokind='f';
  if n_over <> 1 then raise exception 'top_cities_by_deal_ar has % overloads (PGRST203 shape)', n_over; end if;

  select has_function_privilege('anon', p.oid, 'EXECUTE') into v_anon
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='top_cities_by_deal_ar' and p.prokind='f';
  if not coalesce(v_anon,false) then raise exception 'anon lost EXECUTE on top_cities_by_deal_ar'; end if;

  -- THE FIX ITSELF: chip must now equal click-through under the budget that exposed the bug
  for r in select city_ar, listing_count
             from public.top_cities_by_deal_ar(p_deal=>'بيع', p_price_min=>400000, p_price_max=>900000)
            order by listing_count desc limit 6
  loop
    select r2.total_count into click from public.location_search_candidates_ar(
        p_deal=>'بيع', p_price_min=>400000, p_price_max=>900000,
        p_cities=>array[r.city_ar], p_limit=>1, p_offset=>0) r2 limit 1;
    if r.listing_count is distinct from click then
      bad := bad || format('%s chip=%s click=%s; ', r.city_ar, r.listing_count, click);
    end if;
  end loop;
  if bad <> '' then
    raise exception 'chip still disagrees with click-through after the swap: %', bad;
  end if;

  -- AND NOTHING ELSE MOVED
  for r in select label, city, n from public.ops_trending_baseline_20260904 loop
    if r.label like 'nobudget_buy:%' then
      select listing_count into chip from public.top_cities_by_deal_ar(p_deal=>'بيع') where city_ar = r.city;
    elsif r.label like 'nobudget_rent:%' then
      select listing_count into chip from public.top_cities_by_deal_ar(p_deal=>'إيجار') where city_ar = r.city;
    elsif r.label like 'rentbudget:%' then
      select listing_count into chip from public.top_cities_by_deal_ar(p_deal=>'إيجار', p_price_min=>20000, p_price_max=>60000) where city_ar = r.city;
    else
      select listing_count into chip from public.top_cities_by_deal_ar(
        p_deal=>'إيجار', p_rent_period=>'سنوي', p_category=>'Residential',
        p_types=>array['شقة'], p_amenities=>array['elevator'], p_bath_min=>3) where city_ar = r.city;
    end if;
    if chip is distinct from r.n then
      bad := bad || format('%s moved %s -> %s; ', r.label, r.n, chip);
    end if;
  end loop;
  if bad <> '' then
    raise exception 'a count that must not change moved: %', bad;
  end if;

  raise notice 'top_cities_by_deal_ar regenerated with the canonical clause; chip = click-through; 32 control counts unchanged';
end
$mig$;
