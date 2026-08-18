-- MATCH DEFECT: a حي search returns listings from a DIFFERENT حي.
--
-- Found by the expanded Normal-Filter stress matrix (2026-08-18, 1,348 searches). Reproducible:
--   حائل + مزرعة + بيع + حي «حقروصين»  ->  returns dealapp_residential_listings:1284676,
--   whose district_ar is «حي جعرانة». The user asked for one حي and got another.
--
-- ROOT CAUSE. location_search_candidates_ar builds its district match set in the district_tokens
-- CTE as: the requested name, UNION anything the source-observed district_name_bridge maps it to.
-- That bridge is noisy — it holds TWO rows for district_en='حقروصين': one -> 'حقروصين' (right) and
-- one -> 'حي جعرانة' (wrong) — and the join had NO ambiguity guard, so the foreign حي was injected
-- as a search token.
--
-- This is the SAME bug class the CITY branch already fixed on 2026-08-15, whose own comment in this
-- function reads: "AMBIGUITY GUARD (2026-08-15): only bridge an English name that resolves to
-- exactly ONE canonical Arabic city. The bridge is source-observed and noisy ('Riyadh' -> 19
-- distinct Arabic cities), so an unguarded join fans a single city request out across the country."
-- The district branch never received that guard. This migration applies the identical rule, so the
-- two location levels can no longer disagree about how much they trust the same kind of bridge.
--
-- MEASURED BLAST RADIUS (before the fix): 68 bridge names map to more than one canonical Arabic
-- district, producing 126 distinct (requested حي -> foreign حي) injection pairs; 38,174
-- production_ready listings sit in districts reachable as a foreign token.
--
-- SCOPE. This NARROWS results to what the user asked for; it can never hide a listing that genuinely
-- belongs to the requested حي, because the first UNION branch always keeps the literal request.
-- Applied as a guarded NEEDLE-EDIT on the live pg_get_functiondef text: this is the P0 search RPC
-- (the 2026-07-16 PGRST203 outage lived here), so nothing is retyped and only the district_tokens
-- CTE is replaced. The migration aborts if the needle is not found or if the edit would change the
-- function's signature/overload count.

do $$
declare
  v_def text; v_new text; v_before_md5 text; v_overloads int;
  needle constant text :=
    'district_tokens as (' || E'\n' ||
    '    select norm_district_tok(d) as tok from unnest(coalesce(p_districts, ''{}'')) d' || E'\n' ||
    '    union' || E'\n' ||
    '    select norm_district_tok(b.district_ar)' || E'\n' ||
    '    from unnest(coalesce(p_districts, ''{}'')) d' || E'\n' ||
    '    join district_name_bridge b on norm_en_place(b.district_en) = norm_en_place(d)' || E'\n' ||
    '  )';
  replacement constant text :=
    'district_tokens as (' || E'\n' ||
    '    select norm_district_tok(d) as tok from unnest(coalesce(p_districts, ''{}'')) d' || E'\n' ||
    '    union' || E'\n' ||
    '    -- AMBIGUITY GUARD (2026-08-18, mirrors the city guard below): only bridge a name that' || E'\n' ||
    '    -- resolves to exactly ONE canonical Arabic district. district_name_bridge is' || E'\n' ||
    '    -- source-observed and noisy (''حقروصين'' -> both ''حقروصين'' and ''حي جعرانة''), so an' || E'\n' ||
    '    -- unguarded join injects a FOREIGN حي as a search token and the user gets listings from a' || E'\n' ||
    '    -- حي they did not select. Measured: 68 ambiguous names, 126 leaking pairs.' || E'\n' ||
    '    select norm_district_tok(b.district_ar)' || E'\n' ||
    '    from unnest(coalesce(p_districts, ''{}'')) d' || E'\n' ||
    '    join district_name_bridge b on norm_en_place(b.district_en) = norm_en_place(d)' || E'\n' ||
    '    where (select count(distinct norm_district_tok(b2.district_ar))' || E'\n' ||
    '             from district_name_bridge b2' || E'\n' ||
    '            where norm_en_place(b2.district_en) = norm_en_place(d)) = 1' || E'\n' ||
    '  )';
begin
  select count(*) into v_overloads from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'location_search_candidates_ar';
  if v_overloads <> 1 then
    raise exception 'expected exactly 1 overload of location_search_candidates_ar, found % — refusing (PGRST203 risk)', v_overloads;
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'location_search_candidates_ar';
  v_before_md5 := md5(v_def);

  if position(needle in v_def) = 0 then
    raise exception 'district_tokens needle not found — the CTE has changed shape; refusing to edit blind';
  end if;
  if position('AMBIGUITY GUARD (2026-08-18' in v_def) > 0 then
    raise notice 'district ambiguity guard already present — nothing to do';
    return;
  end if;

  v_new := replace(v_def, needle, replacement);
  if v_new = v_def then
    raise exception 'replacement was a no-op';
  end if;
  execute v_new;
end $$;

-- Prove it in the same transaction: guard present, still exactly one overload, and the known
-- leaking pair no longer injects the foreign حي while the correct حي is untouched.
do $$
declare v_def text; v_overloads int; v_leak int; v_ok int;
begin
  select count(*) into v_overloads from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='location_search_candidates_ar';
  if v_overloads <> 1 then raise exception 'overload count changed to % — PGRST203 risk', v_overloads; end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='location_search_candidates_ar';
  if position('AMBIGUITY GUARD (2026-08-18' in v_def) = 0 then
    raise exception 'guard missing after edit';
  end if;

  select count(*) into v_leak from public.location_search_candidates_ar(
      p_deal := 'بيع', p_cities := array['حائل'], p_districts := array['حقروصين'],
      p_types := array['مزرعة'], p_category := 'Residential', p_limit := 500) c
   where public.norm_district_tok(c.district_ar) <> public.norm_district_tok('حقروصين');
  if v_leak > 0 then raise exception 'still leaking % foreign-حي rows', v_leak; end if;

  select count(*) into v_ok from public.location_search_candidates_ar(
      p_deal := 'بيع', p_cities := array['حائل'], p_districts := array['القاعد'],
      p_types := array['مزرعة'], p_category := 'Residential', p_limit := 500) c;
  if v_ok = 0 then raise exception 'the correct-حي search now returns nothing — the guard over-narrowed'; end if;
end $$;
