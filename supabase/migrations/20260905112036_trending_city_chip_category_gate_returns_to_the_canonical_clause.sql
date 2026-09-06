-- THE TRENDING CITY CHIP UNDER-COUNTED BROAD COMMERCIAL BY UP TO 92% FOR SIX HOURS TODAY.
--
-- WHAT USERS SAW. On «فئة تجاري» + «بيع», the Trending city chips advertised الرياض 269 / جدة 189 /
-- الهفوف 157 while clicking any of them delivered 3,361 / 2,972 / 579. Because the Top-6 chips are
-- RANKED by that number, the ordering was wrong too — the chip list was not a view of the search.
--
-- WHERE IT CAME FROM. Migration 20260905045146 (applied 04:51 UTC today) changed
-- top_cities_by_deal_ar's category-purity gate from the canonical
--
--     (k.macro = p_category OR (k.macro = 'both' AND <table-suffix case>))
--
-- to a form that binds the table-suffix case to EVERY type:
--
--     (k.macro = p_category OR k.macro = 'both') AND <table-suffix case>
--
-- It did so to remove one row it had measured as a phantom +1 on
-- «Residential / شقة / إيجار / سنوي / مكة المكرمة» (Trending 556 vs. a search it measured at 555).
--
-- WHY THAT PREMISE WAS WRONG. The 555 was measured by calling location_search_candidates_ar with
-- p_tables restricted to residential-suffix tables and NO p_tables2/p_types2. That is not what the
-- client sends. searchTableScope() in src/data/remote.ts attaches misfile-recovery scope B to that
-- exact query — attachResScopeB fires because شقة ∈ RESIDENTIAL_TYPE_AR_COM — so the real request
-- carries p_tables2 = the commercial tables and p_types2 = ['شقة'], and it REACHES the row the
-- migration was trying to exclude. Measured on the anon path today, same scope object to both:
-- results RPC with the real client scope (A+B) = 557; with scope A alone = 556. The chip's 556 was
-- not one too many — it was one too FEW, and the "fix" pinned it to the wrong reference.
--
-- The migration's four control scopes were all NARROWED type searches (شقة، أرض سكنية، فيلا، مكتب),
-- none of which exercise the broad-Commercial path, so nothing it checked could have caught the
-- regression it introduced. Broad Commercial is the case where the gate matters most: the client
-- searches commercial TYPES sitting in RESIDENTIAL tables as scope A (mainTables = resTables(q),
-- p_types = COMMERCIAL_TYPE_AR_RES) and the commercial tables as scope B. Binding the table-suffix
-- case to every type deletes scope A in its entirety — ~92% of the broad-Commercial set.
--
-- THE BARRIER SAW IT AND NOBODY READ IT. mon_detect_af_count_surfaces_carry_af raised P1
-- af_count_surfaces_carry_af at 04:59 UTC — eight minutes after the change — naming
-- top_cities_by_deal_ar and the exact reason ("no longer embeds af_eligibility_clause() verbatim").
-- That alert has been open ever since. This migration is what closes it.
--
-- THE FIX. Put the canonical clause back, VERBATIM, by inverse substitution rather than by retyping
-- the predicate: reconstruct the strict variant from af_eligibility_clause() itself, prove it occurs
-- exactly once in the live definition, and swap the canonical clause in. top_cities_by_deal_ar is
-- NOT in af_rpc_templates, so rebuild_af_filter_rpcs() cannot reach it — this needle-edit from
-- pg_get_functiondef of the LIVE function is the same pattern 20260904143656 established, and the
-- 37-param signature is untouched (CREATE OR REPLACE, no new overload).
--
-- THE SELF-CHECK IS AN EQUALITY, NOT A PINNED NUMBER. The previous migration asserted
-- "مكة المكرمة == 555", which both encoded the wrong answer and rots as the index changes hourly.
-- This one asserts what the owner rule actually says — chip == the results RPC under the IDENTICAL
-- scope object — measured in this same transaction, across broad Commercial (بيع and إيجار), a
-- narrowed Residential search WITH its misfile-recovery scope B, and a narrowed Commercial search
-- with its mirror. Any disagreement aborts and rolls the whole thing back.
do $mig$
declare
  canon_gate text := $x$and (
                 k.macro = p_category
                 or (
                   k.macro = 'both'
                   and (case p_category
                          when 'Residential' then s.source_table like '%\_residential\_listings'
                          when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                          else true
                        end)
                 )
               )$x$;
  strict_gate text := $x$and (k.macro = p_category or k.macro = 'both')
               and (case p_category
                      when 'Residential' then s.source_table like '%\_residential\_listings'
                      when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                      else true
                    end)$x$;
  canon_clause text := public.af_eligibility_clause();
  strict_clause text;
  def text;
  occ int;
  n_over int;
  v_anon boolean;
  res_tables text[];
  com_tables text[];
  com_all text[];
  com_res text[];
  bad text := '';
  r record;
  v_click int;
begin
  -- Reconstruct the strict variant FROM the canonical clause, so the thing being replaced is
  -- provably the thing that is there — never a retyped copy that merely looks the same.
  strict_clause := replace(canon_clause, canon_gate, strict_gate);
  if strict_clause = canon_clause then
    raise exception 'the canonical clause does not contain the expected purity gate — refusing to swap blind';
  end if;

  def := pg_get_functiondef('public.top_cities_by_deal_ar'::regproc);

  if position(canon_clause in def) > 0 then
    raise notice 'top_cities_by_deal_ar already inlines the canonical clause — verification only';
  else
    occ := (length(def) - length(replace(def, strict_clause, ''))) / length(strict_clause);
    if occ <> 1 then
      raise exception 'the strict clause occurs % time(s) in top_cities_by_deal_ar (expected exactly 1) — refusing to guess', occ;
    end if;
    execute replace(def, strict_clause, canon_clause);
  end if;

  -- The detector's own condition: the clause must now be inlined VERBATIM.
  if position(canon_clause in pg_get_functiondef('public.top_cities_by_deal_ar'::regproc)) = 0 then
    raise exception 'top_cities_by_deal_ar still does not inline af_eligibility_clause() verbatim';
  end if;

  select count(*) into n_over from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'top_cities_by_deal_ar' and p.prokind = 'f';
  if n_over <> 1 then raise exception 'top_cities_by_deal_ar has % overloads (PGRST203 shape)', n_over; end if;

  select has_function_privilege('anon', p.oid, 'EXECUTE') into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'top_cities_by_deal_ar' and p.prokind = 'f';
  if not coalesce(v_anon, false) then raise exception 'anon lost EXECUTE on top_cities_by_deal_ar'; end if;

  -- Scope arrays derived from the physical tables, so this check does not carry its own copy of a
  -- table list that would rot the next time a platform is added. Chip and search are handed the
  -- SAME arrays, so the equality is valid whatever the set happens to be today.
  res_tables := array(select table_name::text from information_schema.tables
                       where table_schema = 'public' and table_name like '%\_residential\_listings' order by 1);
  com_tables := array(select table_name::text from information_schema.tables
                       where table_schema = 'public' and table_name like '%\_commercial\_listings' order by 1);
  select array_agg(distinct type_ar) into com_all from known_type_ar where macro = 'Commercial';
  com_res := array(select u from unnest(com_all) u where u <> 'عمارة');

  -- (1) BROAD COMMERCIAL — the case the regression destroyed and the previous migration never tested.
  --     Scope A = commercial types in RESIDENTIAL tables; scope B = the commercial tables.
  for r in
    select city_ar, listing_count from public.top_cities_by_deal_ar(
      p_deal => 'بيع', p_category => 'Commercial', p_types => com_res,
      p_tables => res_tables, p_tables2 => com_tables, p_types2 => com_all)
    order by listing_count desc limit 3
  loop
    select t.total_count into v_click from public.location_search_candidates_ar(
      p_deal => 'بيع', p_category => 'Commercial', p_types => com_res,
      p_tables => res_tables, p_tables2 => com_tables, p_types2 => com_all,
      p_cities => array[r.city_ar], p_limit => 1, p_offset => 0) t limit 1;
    if r.listing_count is distinct from v_click then
      bad := bad || format('broadCom/بيع %s chip=%s click=%s; ', r.city_ar, r.listing_count, v_click);
    end if;
  end loop;

  for r in
    select city_ar, listing_count from public.top_cities_by_deal_ar(
      p_deal => 'إيجار', p_rent_period => 'سنوي', p_category => 'Commercial', p_types => com_res,
      p_tables => res_tables, p_tables2 => com_tables, p_types2 => com_all)
    order by listing_count desc limit 3
  loop
    select t.total_count into v_click from public.location_search_candidates_ar(
      p_deal => 'إيجار', p_rent_period => 'سنوي', p_category => 'Commercial', p_types => com_res,
      p_tables => res_tables, p_tables2 => com_tables, p_types2 => com_all,
      p_cities => array[r.city_ar], p_limit => 1, p_offset => 0) t limit 1;
    if r.listing_count is distinct from v_click then
      bad := bad || format('broadCom/إيجار %s chip=%s click=%s; ', r.city_ar, r.listing_count, v_click);
    end if;
  end loop;

  -- (2) NARROWED RESIDENTIAL, WITH its misfile-recovery scope B — the shape the previous migration
  --     measured without scope B and therefore mis-adjudicated.
  for r in
    select city_ar, listing_count from public.top_cities_by_deal_ar(
      p_deal => 'إيجار', p_rent_period => 'سنوي', p_category => 'Residential', p_types => array['شقة'],
      p_tables => res_tables, p_tables2 => com_tables, p_types2 => array['شقة'])
    order by listing_count desc limit 3
  loop
    select t.total_count into v_click from public.location_search_candidates_ar(
      p_deal => 'إيجار', p_rent_period => 'سنوي', p_category => 'Residential', p_types => array['شقة'],
      p_tables => res_tables, p_tables2 => com_tables, p_types2 => array['شقة'],
      p_cities => array[r.city_ar], p_limit => 1, p_offset => 0) t limit 1;
    if r.listing_count is distinct from v_click then
      bad := bad || format('resApt %s chip=%s click=%s; ', r.city_ar, r.listing_count, v_click);
    end if;
  end loop;

  -- (3) NARROWED COMMERCIAL with the mirror scope B — proves the fix did not over-correct the
  --     commercial side.
  for r in
    select city_ar, listing_count from public.top_cities_by_deal_ar(
      p_deal => 'إيجار', p_category => 'Commercial', p_types => array['مكتب'],
      p_tables => com_tables, p_tables2 => res_tables, p_types2 => array['مكتب'])
    order by listing_count desc limit 3
  loop
    select t.total_count into v_click from public.location_search_candidates_ar(
      p_deal => 'إيجار', p_category => 'Commercial', p_types => array['مكتب'],
      p_tables => com_tables, p_tables2 => res_tables, p_types2 => array['مكتب'],
      p_cities => array[r.city_ar], p_limit => 1, p_offset => 0) t limit 1;
    if r.listing_count is distinct from v_click then
      bad := bad || format('comOffice %s chip=%s click=%s; ', r.city_ar, r.listing_count, v_click);
    end if;
  end loop;

  if bad <> '' then
    raise exception 'chip != click-through after the swap — rolling back: %', bad;
  end if;

  raise notice 'top_cities_by_deal_ar restored to the canonical clause; chip == click-through on all 12 checked city/scope pairs';
end $mig$;
