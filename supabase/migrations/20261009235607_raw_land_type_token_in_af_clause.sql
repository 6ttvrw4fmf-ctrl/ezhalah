-- «أرض خام» (raw land) becomes a TYPE the whole search understands — owner 2026-10-09.
--
-- The previous migration (raw_land_subtype_tag) tags raw lands with unit_subtype_ar = 'أرض خام' and keeps
-- each row's own source type. Here the shared WHERE clause (af_eligibility_clause, rendered into all six
-- templated RPCs by rebuild_af_filter_rpcs) learns ONE thing: the type token 'أرض خام' in p_types /
-- p_types2 matches a row carrying that tag. So results, city counts, district counts, AF counts and the
-- AI agent all read one definition, and a union («أرض خام» + «أرض تجارية») is exact. Under a category
-- pill a raw row requested by that token passes the category gate: a raw RESIDENTIAL or AGRICULTURAL
-- plot is still a raw land when the user asks for raw land under تجاري → «الأراضي» (owner placement).
--
-- STEP 1 FIRST — the AF rail had drifted (backlog 323, Falcon 10-09): migration 20261003222926 hand-edited
-- the category block of top_cities_by_deal_ar and district_options_ar into a semi-join, so
-- rebuild_af_filter_rpcs() refused to run (af_rebuild_would_revert: WHOLE-DEFINITION DIVERGENCE). The
-- same positional edit is ported into the clause itself, which makes the rendering reproduce both
-- hand-edited functions; the refusal check is asserted empty BEFORE the first rebuild. The semi-join is
-- an algebraic rewrite of the EXISTS (same rows), already live on two of the six surfaces since 10-03.
-- STEP 2 — the raw-land token, then a second rebuild. Guarded by the clause md5 this was written against.
do $mig$
declare
  c text; nc text; pre text; blk text; v_bad text;
  p int; q int; s int; e int; depth int; ch text;
  port_blk constant text := $n$(s.type_ar in (select k.type_ar from known_type_ar k where k.macro = p_category)
           or (s.type_ar in (select k.type_ar from known_type_ar k where k.macro = 'both')
               and (case p_category
                      when 'Residential' then s.source_table like '%\_residential\_listings'
                      when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                      else true
                    end)))$n$;
  n1 constant text := $n$and (p_types is null or s.type_ar = any(p_types)))$n$;
  r1 constant text := $n$and (p_types is null or s.type_ar = any(p_types)
                  or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any(p_types))))$n$;
  n2 constant text := $n$and s.type_ar = any(p_types2))$n$;
  r2 constant text := $n$and (s.type_ar = any(p_types2)
                  or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any(p_types2))))$n$;
  n3 constant text := $n$and (p_category is null$n$;
  r3 constant text := $n$and (p_category is null
           or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any(coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))$n$;
begin
  if md5(pg_get_functiondef('public.af_eligibility_clause'::regproc)) <> '8d9c9312948bd90aaef0001e1701fbe6' then
    raise exception 'af_eligibility_clause changed since this migration was written — re-read it first';
  end if;

  -- STEP 1: port 20261003222926 into the clause (the same positional edit, on the clause text).
  c := public.af_eligibility_clause();
  p := position('known_type_ar' in c);
  if p = 0 or position('known_type_ar' in substr(c, p + 13)) <> 0 then
    raise exception 'expected exactly one known_type_ar block in the clause';
  end if;
  pre := substr(c, 1, p);
  q := position(reverse('exists (') in reverse(pre));
  s := length(pre) - q - 6;
  if substr(c, s, 8) <> 'exists (' then raise exception 'exists ( not found'; end if;
  depth := 0; e := s + 7;
  loop
    ch := substr(c, e, 1);
    if ch = '(' then depth := depth + 1; elsif ch = ')' then depth := depth - 1; end if;
    exit when depth = 0 or e > length(c);
    e := e + 1;
  end loop;
  blk := substr(c, s, e - s + 1);
  if depth <> 0 or position('k.macro = p_category' in blk) = 0 or position('select 1 from known_type_ar k' in blk) = 0 then
    raise exception 'category block not recognised';
  end if;
  nc := substr(c, 1, s - 1) || port_blk || substr(c, e + 1);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as %L',
                 'select ' || quote_literal(nc) || '::text');

  select string_agg(format('%s: %s', w.o_fn_name, array_to_string(w.o_dropped, ', ')), '; ')
    into v_bad from public.af_rebuild_would_revert() w;
  if v_bad is not null then raise exception 'port did not reproduce the live hand-edits: %', v_bad; end if;
  perform * from public.rebuild_af_filter_rpcs();

  -- STEP 2: the raw-land type token.
  c := public.af_eligibility_clause();
  if (length(c) - length(replace(c, n1, ''))) / length(n1) <> 1
     or (length(c) - length(replace(c, n2, ''))) / length(n2) <> 1
     or (length(c) - length(replace(c, n3, ''))) / length(n3) <> 1 then
    raise exception 'a raw-land needle is not unique in the clause';
  end if;
  nc := replace(replace(replace(c, n1, r1), n2, r2), n3, r3);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as %L',
                 'select ' || quote_literal(nc) || '::text');
  perform * from public.rebuild_af_filter_rpcs();
end
$mig$;
