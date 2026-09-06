
-- CORRECTS the previous migration (location_search_candidates_ar_distinct_platform_count), which
-- hand-edited the live function directly - the EXACT rail this codebase has a permanent barrier
-- against (scripts/verify-af-rpcs-not-hand-edited.ts: "never hand-edit the 4 AF shared-eligibility
-- RPCs directly - go through the shared clause + rebuild_af_filter_rpcs()"). Confirmed live: a
-- concurrent session's rebuild_af_filter_rpcs() call landed 4 seconds later and silently reverted
-- the hand-edit, because af_rpc_templates never knew about it. Correct fix, same pattern as the
-- 2026-08-30 repair of the 2026-08-29 photo/rotation hand-edit: fold the change into
-- af_rpc_templates FIRST, then call rebuild_af_filter_rpcs() so the four generated surfaces stay
-- ONE definition of eligibility, machine-verified by this same barrier going forward.
--
-- distinct_platform_count: the exact count of distinct platforms holding at least one row in the
-- eligible set for this search - owner PERMANENT rule 2026-09-04 (dynamic initial-batch platform
-- diversity sizing). One new CTE, `platform_count as (select count(distinct platform) as n from
-- matched)`, computed once and read as a plain scalar in both branches - no window-function
-- nesting. Never a hand-maintained platform list/count.
--
-- CORRECTION mid-flight (this same migration, first attempt): the template's WHERE clause is the
-- single placeholder __AF_ELIGIBILITY_WHERE__, not the literal predicate text the live function
-- has post-rebuild - the CTE-close anchor is placeholder-aware here, unlike the reverted attempt.
do $guarded$
declare
  tmpl text;
  new_tmpl text;
  occ int;
  bad text;
  rebuilt record;
begin
  select template into tmpl from af_rpc_templates where fn_name = 'location_search_candidates_ar';
  if tmpl is null then raise exception 'template row not found'; end if;

  occ := (length(tmpl) - length(replace(tmpl, 'bedrooms integer, af_canon jsonb)', ''))) / length('bedrooms integer, af_canon jsonb)');
  if occ <> 1 then raise exception 'RETURNS TABLE anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(tmpl, 'bedrooms integer, af_canon jsonb)', 'bedrooms integer, af_canon jsonb, distinct_platform_count bigint)');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E'__AF_ELIGIBILITY_WHERE__\n  )\n  select u.source_table,', ''))) / length(E'__AF_ELIGIBILITY_WHERE__\n  )\n  select u.source_table,');
  if occ <> 1 then raise exception 'matched-CTE-close (placeholder) anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    E'__AF_ELIGIBILITY_WHERE__\n  )\n  select u.source_table,',
    E'__AF_ELIGIBILITY_WHERE__\n  ),\n  -- DYNAMIC PLATFORM-DIVERSITY SIZING (owner PERMANENT rule 2026-09-04): computed ONCE (a plain\n  -- CTE referenced 2+ times materializes by default), never a hand-maintained platform list/count.\n  platform_count as (select count(distinct platform) as n from matched)\n  select u.source_table,');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon\n  from (', ''))) / length(E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon\n  from (');
  if occ <> 1 then raise exception 'final outer select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl, E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon\n  from (', E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon, u.distinct_platform_count\n  from (');

  occ := (length(new_tmpl) - length(replace(new_tmpl, 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank, a.photo_rank, a.rot_key', ''))) / length('a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank, a.photo_rank, a.rot_key');
  if occ <> 1 then raise exception 'branch a outer select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl, 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank, a.photo_rank, a.rot_key', 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.distinct_platform_count, a.div_rank, a.photo_rank, a.rot_key');

  occ := (length(new_tmpl) - length(replace(new_tmpl, 'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,', ''))) / length('count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,');
  if occ <> 1 then raise exception 'branch a inner select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,',
    'count(*) over() as total_count, (select n from platform_count) as distinct_platform_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,\n             case when coalesce(p_sort_by', ''))) / length(E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,\n             case when coalesce(p_sort_by');
  if occ <> 1 then raise exception 'branch t outer select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,\n             case when coalesce(p_sort_by',
    E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon, t.distinct_platform_count,\n             case when coalesce(p_sort_by');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count,', ''))) / length(E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count,');
  if occ <> 1 then raise exception 'branch t inner select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count,',
    E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count, (select n from platform_count) as distinct_platform_count,');

  occ := (length(new_tmpl) - length(replace(new_tmpl, '__AF_ELIGIBILITY_WHERE__', ''))) / length('__AF_ELIGIBILITY_WHERE__');
  if occ <> 1 then raise exception 'placeholder integrity check failed: found % occurrences', occ; end if;

  update af_rpc_templates set template = new_tmpl where fn_name = 'location_search_candidates_ar';

  select string_agg(format('%s: [%s]', w.o_fn_name, array_to_string(w.o_dropped, ', ')), '; ')
    into bad from af_rebuild_would_revert() w;
  if bad is not null then
    raise exception 'refusing to rebuild - would revert: %', bad;
  end if;

  for rebuilt in select * from rebuild_af_filter_rpcs() loop
    raise notice 'rebuilt % -> %', rebuilt.o_fn_name, rebuilt.o_def_md5;
  end loop;
end $guarded$;
