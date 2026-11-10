-- THE MAP FILTER ASKS LIKE THE FILTER (owner 2026-11-10: «this filter is like the one we have but it shows the result in
-- the map»). The map's two read functions matched a type by its stored name only, so the Filter's own rules were
-- missing: «أرض خام» is a tag (unit_subtype_ar), never a stored type, and read 0 on the map; land under «تجاري» sits in
-- residential tables and was cut by the map's table-name category test. Now both functions take the SAME scope the
-- Filter home sends (af_eligibility_clause): two table sets, two type lists, the raw-land tag, and the category gate
-- read from known_type_ar. Four parts, each a copy of the live object plus that rule:
--   1. map_listing_points_ar (the pins' source view) carries s.unit_subtype_ar;
--   2. map_nopin_ar (district markers) carries it, filled now and on every refresh;
--   3. map_pins_ar(…, p_tables, p_tables2, p_types2, p_macro) — the old version is DROPPED first, so no second overload;
--   4. map_nopin_markers_ar(…, same four) — same.
-- New arguments default to NULL = not narrowed, and the old p_category test stays, so the live site keeps working
-- before and after the frontend ships.

-- 1. The view: the same two branches, unit_subtype_ar appended (CREATE OR REPLACE VIEW may only add columns at the end).
do $v$
declare v text; v2 text;
begin
  v := pg_get_viewdef('public.map_listing_points_ar'::regclass, true);
  v2 := replace(v, 's.furnished' || chr(10), 's.furnished,' || chr(10) || '    s.unit_subtype_ar' || chr(10));
  if (length(v2) - length(v)) <> 2 * length(',' || chr(10) || '    s.unit_subtype_ar') then
    raise exception 'map_listing_points_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  execute 'create or replace view public.map_listing_points_ar as ' || v2;
end
$v$;

-- 2. The district-marker table and its refresh.
alter table public.map_nopin_ar add column if not exists unit_subtype_ar text;
update public.map_nopin_ar m set unit_subtype_ar = s.unit_subtype_ar
  from public.search_listings_ar s
 where s.source_table = m.source_table and s.listing_id = m.listing_id and s.unit_subtype_ar is not null;

do $mig$
declare v text; v2 text; n int; sig text; scope_s text; scope_m text;
  old_pins constant text := 'double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric,boolean';
  old_nopin constant text := 'double precision,double precision,double precision,double precision,text[],text,text[],integer[],integer,integer,numeric,numeric,integer,boolean';
  more_args constant text := ', p_tables text[] DEFAULT NULL::text[], p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_macro text DEFAULT NULL::text)';
begin
  -- The Filter's own type scope and category gate (af_eligibility_clause), for alias s; the marker table uses m.
  scope_s := $q$and ( ((p_tables is null or s.source_table = any (p_tables))
               and (p_types is null or s.type_ar = any (p_types) or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types))))
           or (p_tables2 is not null and p_types2 is not null and s.source_table = any (p_tables2)
               and (s.type_ar = any (p_types2) or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types2)))) )
        and (p_macro is null
             or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))
             or s.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = p_macro)
             or (s.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = 'both')
                 and (case p_macro when 'Residential' then s.source_table like '%\_residential\_listings'
                                   when 'Commercial' then s.source_table like '%\_commercial\_listings' else true end)))$q$;
  scope_m := replace(scope_s, 's.', 'm.');

  -- 2b. map_nopin_refresh_ar(): carry s.unit_subtype_ar into the table.
  v := pg_get_functiondef('public.map_nopin_refresh_ar()'::regprocedure);
  v2 := replace(v, 's.bedrooms beds, s.furnished', 's.bedrooms beds, s.furnished, s.unit_subtype_ar');
  v2 := replace(v2, 'type_ar, beds, furnished)', 'type_ar, beds, furnished, unit_subtype_ar)');
  v2 := replace(v2, 'type_ar, beds, furnished from map_nopin_new', 'type_ar, beds, furnished, unit_subtype_ar from map_nopin_new');
  if (length(v2) - length(v)) <> 2 * length(', s.unit_subtype_ar') + 2 * length(', unit_subtype_ar') then
    raise exception 'map_nopin_refresh_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  execute v2;

  -- 3. map_pins_ar: drop the 16-argument version, create the 20-argument one (the Filter's scope on every read path).
  v := pg_get_functiondef(('public.map_pins_ar(' || old_pins || ')')::regprocedure);
  n := (length(v) - length(replace(v, 'and (p_types is null or s.type_ar = any (p_types))', ''))) / length('and (p_types is null or s.type_ar = any (p_types))');
  if n <> 4 then raise exception 'map_pins_ar: expected 4 read paths, found %', n; end if;
  v2 := replace(v, ', p_furnished boolean DEFAULT NULL::boolean)' || chr(10) || ' RETURNS TABLE', ', p_furnished boolean DEFAULT NULL::boolean' || more_args || chr(10) || ' RETURNS TABLE');
  v2 := replace(v2, 'and p_price_max is null and p_furnished is null' || chr(10), 'and p_price_max is null and p_furnished is null' || chr(10) || '     and p_tables is null and p_tables2 is null and p_macro is null' || chr(10));
  v2 := replace(v2, 'and (p_types is null or s.type_ar = any (p_types))', scope_s);
  if position('p_macro text DEFAULT NULL::text)' || chr(10) || ' RETURNS TABLE' in v2) = 0 or position('and p_tables is null and p_tables2 is null and p_macro is null' in v2) = 0 then
    raise exception 'map_pins_ar: signature or grid fast-path not rewritten';
  end if;
  execute 'drop function public.map_pins_ar(' || old_pins || ')';
  execute v2;
  sig := 'public.map_pins_ar(' || old_pins || ',text[],text[],text[],text)';
  execute 'revoke all on function ' || sig || ' from public';
  execute 'grant execute on function ' || sig || ' to anon, authenticated, service_role';

  -- 4. map_nopin_markers_ar: same, 14 → 18 arguments.
  v := pg_get_functiondef(('public.map_nopin_markers_ar(' || old_nopin || ')')::regprocedure);
  v2 := replace(v, ', p_furnished boolean DEFAULT NULL::boolean)', ', p_furnished boolean DEFAULT NULL::boolean' || more_args);
  v2 := replace(v2, 'and (p_types is null or m.type_ar = any (p_types))', scope_m);
  if (length(v2) - length(v)) <> length(more_args) - 1 + length(scope_m) - length('and (p_types is null or m.type_ar = any (p_types))') then
    raise exception 'map_nopin_markers_ar: unexpected shape (delta %)', length(v2) - length(v);
  end if;
  execute 'drop function public.map_nopin_markers_ar(' || old_nopin || ')';
  execute v2;
  sig := 'public.map_nopin_markers_ar(' || old_nopin || ',text[],text[],text[],text)';
  execute 'revoke all on function ' || sig || ' from public';
  execute 'grant execute on function ' || sig || ' to anon, authenticated, service_role';
end
$mig$;