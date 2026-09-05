
-- DYNAMIC PLATFORM-DIVERSITY SIZING (owner PERMANENT rule 2026-09-04): adds distinct_platform_count
-- to location_search_candidates_ar's output - the exact count of distinct platforms holding at
-- least one row in the eligible set for this exact search. Never a hand-maintained platform
-- list/count: a platform that starts or stops matching changes this number automatically on the
-- very next call.
--
-- TWO PRIOR ATTEMPTS FAILED, both safely rolled back (Postgres commits DDL atomically - verified the
-- RPC stayed live and callable after each): (1) count(distinct x) over() -> "DISTINCT is not
-- implemented for window functions" (0A000); (2) max(dense_rank() over(...)) over() -> "window
-- function calls cannot be nested" (42P20). FINAL DESIGN, no window function at all: one new CTE,
-- `platform_count as (select count(distinct platform) as n from matched)`, computed ONCE (a plain CTE
-- referenced 2+ times materializes by default) and read as a scalar in both branches, next to the
-- existing `count(*) over() as total_count`. Zero extra scan of the base table beyond the CTE's own
-- one-time evaluation; zero change to any WHERE predicate, so `matched` (eligibility) and total_count
-- stay byte-for-byte identical.
--
-- Adding an OUT column changes the function's anonymous row type, which CREATE OR REPLACE refuses
-- (42P13, confirmed live on attempt 1). DROP + CREATE in ONE transaction (this whole apply_migration
-- call) is the correct, safe fix - Postgres commits both or neither.
--
-- Guarded needle-edit: the new body is built and verified server-side in one atomic block, every
-- insertion anchor asserted to match EXACTLY once before being touched.
do $guarded$
declare
  body text;
  new_body text;
  occ int;
begin
  select pg_get_functiondef(oid) into body from pg_proc where proname='location_search_candidates_ar';
  if body is null then raise exception 'function not found'; end if;

  occ := (length(body) - length(replace(body, 'bedrooms integer, af_canon jsonb)', ''))) / length('bedrooms integer, af_canon jsonb)');
  if occ <> 1 then raise exception 'RETURNS TABLE anchor: expected 1, found %', occ; end if;
  new_body := replace(body, 'bedrooms integer, af_canon jsonb)', 'bedrooms integer, af_canon jsonb, distinct_platform_count bigint)');

  -- new CTE, inserted right after `matched`'s closing paren and before the final query
  occ := (length(new_body) - length(replace(new_body, E'      and (p_unit_subtypes is null or cardinality(p_unit_subtypes) = 0 or s.unit_subtype_ar = any(p_unit_subtypes))\n\n  )\n  select u.source_table,', ''))) / length(E'      and (p_unit_subtypes is null or cardinality(p_unit_subtypes) = 0 or s.unit_subtype_ar = any(p_unit_subtypes))\n\n  )\n  select u.source_table,');
  if occ <> 1 then raise exception 'matched-CTE-close anchor: expected 1, found %', occ; end if;
  new_body := replace(new_body,
    E'      and (p_unit_subtypes is null or cardinality(p_unit_subtypes) = 0 or s.unit_subtype_ar = any(p_unit_subtypes))\n\n  )\n  select u.source_table,',
    E'      and (p_unit_subtypes is null or cardinality(p_unit_subtypes) = 0 or s.unit_subtype_ar = any(p_unit_subtypes))\n\n  ),\n  -- DYNAMIC PLATFORM-DIVERSITY SIZING (owner PERMANENT rule 2026-09-04): computed ONCE (a plain\n  -- CTE referenced 2+ times materializes by default), never a hand-maintained platform list/count.\n  platform_count as (select count(distinct platform) as n from matched)\n  select u.source_table,');

  occ := (length(new_body) - length(replace(new_body, E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon\n  from (', ''))) / length(E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon\n  from (');
  if occ <> 1 then raise exception 'final outer select anchor: expected 1, found %', occ; end if;
  new_body := replace(new_body, E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon\n  from (', E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon, u.distinct_platform_count\n  from (');

  occ := (length(new_body) - length(replace(new_body, 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank, a.photo_rank, a.rot_key', ''))) / length('a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank, a.photo_rank, a.rot_key');
  if occ <> 1 then raise exception 'branch a outer select anchor: expected 1, found %', occ; end if;
  new_body := replace(new_body, 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank, a.photo_rank, a.rot_key', 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.distinct_platform_count, a.div_rank, a.photo_rank, a.rot_key');

  occ := (length(new_body) - length(replace(new_body, 'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,', ''))) / length('count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,');
  if occ <> 1 then raise exception 'branch a inner select anchor: expected 1, found %', occ; end if;
  new_body := replace(new_body,
    'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,',
    'count(*) over() as total_count, (select n from platform_count) as distinct_platform_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,');

  occ := (length(new_body) - length(replace(new_body, E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,\n             case when coalesce(p_sort_by', ''))) / length(E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,\n             case when coalesce(p_sort_by');
  if occ <> 1 then raise exception 'branch t outer select anchor: expected 1, found %', occ; end if;
  new_body := replace(new_body,
    E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,\n             case when coalesce(p_sort_by',
    E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon, t.distinct_platform_count,\n             case when coalesce(p_sort_by');

  occ := (length(new_body) - length(replace(new_body, E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count,', ''))) / length(E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count,');
  if occ <> 1 then raise exception 'branch t inner select anchor: expected 1, found %', occ; end if;
  new_body := replace(new_body,
    E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count,',
    E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count, (select n from platform_count) as distinct_platform_count,');

  drop function public.location_search_candidates_ar(
    text, text[], text[], text[], text[], integer, integer, integer[], text[], numeric, numeric, text,
    integer, integer, integer[], integer, integer, boolean, integer, text, text[], boolean, text[],
    integer, text[], text[], integer, integer[], smallint, smallint, integer, integer, boolean, text,
    text, boolean, numeric, integer, text[], numeric, numeric, text
  );
  execute new_body;
end $guarded$;
