-- MONTHLY ADVANCED FILTER, stage 2: the shared eligibility layer learns rating / review-confidence /
-- unit-subtype, and all four AF surfaces get the parameters — through the ONE sanctioned path
-- (af_eligibility_clause → af_rpc_templates → rebuild_af_filter_rpcs), never by hand-editing a
-- deployed function (docs/ops rule: ONE clause → 4 surfaces).
--
-- Predicates are STRICT and UNKNOWN-safe by SQL semantics:
--   s.rating >= p_rating_min          → NULL rating never satisfies a rating filter
--   s.reviews_count >= p_reviews_min  → reviews only ever exist WITH a rating (barrier-enforced),
--                                       so a review-confidence answer can never match unrated rows
--   s.unit_subtype_ar = any(...)      → NULL subtype (non-Gathern) never matches a subtype chip

do $$
declare src text; newsrc text; anchor text := 'coalesce(p_floor_max, 2147483647)))';
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='af_eligibility_clause';
  if src is null then raise exception 'af_eligibility_clause not found'; end if;
  if position('p_rating_min' in src) > 0 then raise notice 'clause already extended — no-op';
  else
    if position(anchor in src) = 0 then raise exception 'floor anchor missing from clause'; end if;
    newsrc := replace(src, anchor,
      anchor || chr(10)
      || '      and (p_rating_min is null or s.rating >= p_rating_min)' || chr(10)
      || '      and (p_reviews_min is null or s.reviews_count >= p_reviews_min)' || chr(10)
      || '      and (p_unit_subtypes is null or cardinality(p_unit_subtypes) = 0 or s.unit_subtype_ar = any(p_unit_subtypes))');
    execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $afc$%s$afc$', newsrc);
  end if;
end $$;

-- Template params: appended with DEFAULT NULL so every existing call shape keeps working.
update af_rpc_templates set template = replace(template,
  'p_floor_max integer DEFAULT NULL::integer)',
  'p_floor_max integer DEFAULT NULL::integer, p_rating_min numeric DEFAULT NULL::numeric, p_reviews_min integer DEFAULT NULL::integer, p_unit_subtypes text[] DEFAULT NULL::text[])')
where fn_name in ('af_eligible_count','apartment_guided_counts_ar','property_age_option_counts_ar')
  and position('p_rating_min' in template) = 0;

update af_rpc_templates set template = replace(template,
  'p_age_unknown boolean DEFAULT NULL::boolean)',
  'p_age_unknown boolean DEFAULT NULL::boolean, p_rating_min numeric DEFAULT NULL::numeric, p_reviews_min integer DEFAULT NULL::integer, p_unit_subtypes text[] DEFAULT NULL::text[])')
where fn_name = 'location_search_candidates_ar'
  and position('p_rating_min' in template) = 0;

-- Guided counts: the Monthly question chips. Thresholds are the DATA-DERIVED ones (9.5+ / 9.0+ /
-- 9.0+ with >=10 reviews — the only cuts that split this 1-10 distribution usefully; <=8.0 keeps
-- ~94% and filters nothing). Subtype counts cover Gathern's Monthly unit_type_ar vocabulary.
update af_rpc_templates set template = replace(replace(replace(template,
  'cnt_selected bigint)',
  'cnt_selected bigint, cnt_rating95 bigint, cnt_rating90 bigint, cnt_rating90_rc10 bigint, cnt_sub_studio bigint, cnt_sub_serviced bigint, cnt_sub_regular bigint)'),
  's.car_entrance, s.sanitation, s.electricity, s.water_supply',
  's.car_entrance, s.sanitation, s.electricity, s.water_supply, s.rating, s.reviews_count, s.unit_subtype_ar'),
  E'count(*)                                                as cnt_selected\n  from scoped;',
  E'count(*)                                                as cnt_selected,\n'
  || E'    count(*) filter (where rating >= 9.5)                   as cnt_rating95,\n'
  || E'    count(*) filter (where rating >= 9.0)                   as cnt_rating90,\n'
  || E'    count(*) filter (where rating >= 9.0 and reviews_count >= 10) as cnt_rating90_rc10,\n'
  || E'    count(*) filter (where unit_subtype_ar = ''استديو'')      as cnt_sub_studio,\n'
  || E'    count(*) filter (where unit_subtype_ar = ''شقق مخدومة'')  as cnt_sub_serviced,\n'
  || E'    count(*) filter (where unit_subtype_ar = ''شقة'')         as cnt_sub_regular\n  from scoped;')
where fn_name='apartment_guided_counts_ar' and position('cnt_rating95' in template) = 0;

-- One sanctioned rebuild: drops every overload, rebuilds all four from templates with the shared
-- clause, asserts exactly one signature each, records md5s, reloads PostgREST.
select fn_name, left(def_md5, 8) md5 from rebuild_af_filter_rpcs() as r(o_fn_name, o_def_md5)
, lateral (select r.o_fn_name fn_name, r.o_def_md5 def_md5) x;