-- Part B: store the four surface templates. Built SERVER-SIDE from pg_get_functiondef of the LIVE
-- functions (needle-edit with RAISE guards), so the template is byte-derived from what actually
-- runs — no hand transcription. Edits per template:
--   * excise the eligibility WHERE span -> the __AF_ELIGIBILITY_WHERE__ marker
--   * counts + age-counts: replace the param list with the FULL canonical eligibility surface
--   * results: append p_age_unknown (all other params/order untouched)
--   * af_eligible_count referee: counts' CTE prologue + count(*) over the marker
do $do1$
declare
  elig constant text :=
    'p_deal text DEFAULT NULL::text, p_rent_period text DEFAULT NULL::text, '
 || 'p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], '
 || 'p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], '
 || 'p_region_ids integer[] DEFAULT NULL::integer[], p_tables2 text[] DEFAULT NULL::text[], '
 || 'p_types2 text[] DEFAULT NULL::text[], p_types text[] DEFAULT NULL::text[], '
 || 'p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, '
 || 'p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, '
 || 'p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, '
 || 'p_category text DEFAULT NULL::text, p_age_min integer DEFAULT NULL::integer, '
 || 'p_age_max integer DEFAULT NULL::integer, p_age_unknown boolean DEFAULT NULL::boolean, '
 || 'p_is_new_construction boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], '
 || 'p_bath_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], '
 || 'p_furnished boolean DEFAULT NULL::boolean, p_tenant text DEFAULT NULL::text, '
 || 'p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, '
 || 'p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, '
 || 'p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer';
  marker constant text := '    __AF_ELIGIBILITY_WHERE__';
  fnq constant text := chr(36) || 'function' || chr(36);
  def text; tpl text; ws int; we int; ps int; pe int; prologue text;
begin
  ------------------------------------------------------------------ results
  select pg_get_functiondef(p.oid) into strict def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'location_search_candidates_ar';
  ws := position('    where (s.production_ready' in def);
  we := position(E'\n  )\n  select u.source_table' in def);
  if ws = 0 or we = 0 or we < ws then raise exception 'results WHERE anchors not found (%/%)', ws, we; end if;
  tpl := left(def, ws - 1) || marker || substring(def from we);
  if position('p_sort_by text DEFAULT NULL::text)' in tpl) = 0 then
    raise exception 'results signature anchor not found';
  end if;
  tpl := replace(tpl, 'p_sort_by text DEFAULT NULL::text)',
                      'p_sort_by text DEFAULT NULL::text, p_age_unknown boolean DEFAULT NULL::boolean)');
  insert into public.af_rpc_templates(fn_name, template)
  values ('location_search_candidates_ar', tpl)
  on conflict (fn_name) do update set template = excluded.template;

  ------------------------------------------------------------------ counts
  select pg_get_functiondef(p.oid) into strict def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apartment_guided_counts_ar';
  ws := position('    where (s.production_ready' in def);
  we := position(E'\n  )\n  select\n    count(*)' in def);
  if ws = 0 or we = 0 or we < ws then raise exception 'counts WHERE anchors not found (%/%)', ws, we; end if;
  tpl := left(def, ws - 1) || marker || substring(def from we);
  ps := position('(p_deal text' in tpl);
  pe := position(E')\n RETURNS TABLE' in tpl);
  if ps = 0 or pe = 0 or pe < ps then raise exception 'counts param anchors not found (%/%)', ps, pe; end if;
  tpl := left(tpl, ps - 1) || '(' || elig || substring(tpl from pe);
  insert into public.af_rpc_templates(fn_name, template)
  values ('apartment_guided_counts_ar', tpl)
  on conflict (fn_name) do update set template = excluded.template;

  -- referee prologue comes from the counts def (shared CTE block), before its WHERE was excised
  ps := position('  with district_tokens' in def);
  pe := position('), scoped as (' in def);
  if ps = 0 or pe = 0 then raise exception 'counts CTE prologue anchors not found'; end if;
  prologue := substring(def from ps for pe - ps) || ')';

  ------------------------------------------------------------------ age counts
  select pg_get_functiondef(p.oid) into strict def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'property_age_option_counts_ar';
  ws := position('    where (s.production_ready' in def);
  we := position(E'\n  )\n  select\n    count(*) filter (where property_age = 0)' in def);
  if ws = 0 or we = 0 or we < ws then raise exception 'age WHERE anchors not found (%/%)', ws, we; end if;
  tpl := left(def, ws - 1) || marker || substring(def from we);
  ps := position('(p_deal text' in tpl);
  pe := position(E')\n RETURNS TABLE' in tpl);
  if ps = 0 or pe = 0 or pe < ps then raise exception 'age param anchors not found (%/%)', ps, pe; end if;
  tpl := left(tpl, ps - 1) || '(' || elig || substring(tpl from pe);
  insert into public.af_rpc_templates(fn_name, template)
  values ('property_age_option_counts_ar', tpl)
  on conflict (fn_name) do update set template = excluded.template;

  ------------------------------------------------------------------ referee
  tpl := 'CREATE OR REPLACE FUNCTION public.af_eligible_count(' || elig || E')\n'
      || E' RETURNS bigint\n LANGUAGE sql\n STABLE\nAS ' || fnq || E'\n'
      || prologue || E'\n'
      || E'  select count(*)\n  from public.search_listings_ar s\n'
      || marker || E'\n'
      || fnq;
  insert into public.af_rpc_templates(fn_name, template)
  values ('af_eligible_count', tpl)
  on conflict (fn_name) do update set template = excluded.template;
end
$do1$;
