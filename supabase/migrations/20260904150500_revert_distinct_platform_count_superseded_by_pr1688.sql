
-- REVERTS distinct_platform_count (added by the previous two migrations,
-- 20260904143246 / 20260904143618) from location_search_candidates_ar. Superseded by a concurrent
-- session's PR #1688 ("The first screen shows the whole market, not the ten biggest listings"),
-- merged to main at 2026-09-04T14:47:21Z, BEFORE this branch's own PR was opened. #1688 solves the
-- identical owner PERMANENT rule (MATCH -> DIVERSITY -> PHOTO, initial_visible_count = min(total,
-- max(10, distinct platforms))) entirely client-side: distinctPlatformCount() in
-- src/lib/platformDiversity.ts counts platforms from the rows already fetched by the existing
-- Filter/AF pipeline, and initialReveal() takes an optional `platforms` argument. No DB column
-- needed - #1688's barrier (verify-initial-batch-covers-platforms.ts) is mutation-proven 13 ways
-- and already live in production (confirmed via direct curl: ezhalah-app.vercel.app serves
-- entry-be294ceea4de8c27e3e5bf6ddd8049c8.js, #1688's bundle hash).
--
-- git grep 'distinct_platform_count' origin/main: ZERO hits. Nothing on main reads this column -
-- it is dead weight (a COUNT(DISTINCT platform) CTE evaluated on every search call for a value
-- nobody consumes). Reverting rather than leaving an orphaned OUT column and an orphaned CTE live
-- forever, per the same "no half-understood/no dead surface" discipline this repo holds ranking SQL
-- to elsewhere.
--
-- Exact inverse of 20260904143618: same six anchors, replacement and anchor swapped, so the
-- template returns byte-identical to its pre-2026-09-04-14:32 state. Guarded needle-edit: every
-- anchor asserted to match EXACTLY once before being touched, all inside one atomic block.
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

  occ := (length(tmpl) - length(replace(tmpl, 'bedrooms integer, af_canon jsonb, distinct_platform_count bigint)', ''))) / length('bedrooms integer, af_canon jsonb, distinct_platform_count bigint)');
  if occ <> 1 then raise exception 'RETURNS TABLE anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(tmpl, 'bedrooms integer, af_canon jsonb, distinct_platform_count bigint)', 'bedrooms integer, af_canon jsonb)');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E'__AF_ELIGIBILITY_WHERE__\n  ),\n  -- DYNAMIC PLATFORM-DIVERSITY SIZING (owner PERMANENT rule 2026-09-04): computed ONCE (a plain\n  -- CTE referenced 2+ times materializes by default), never a hand-maintained platform list/count.\n  platform_count as (select count(distinct platform) as n from matched)\n  select u.source_table,', ''))) / length(E'__AF_ELIGIBILITY_WHERE__\n  ),\n  -- DYNAMIC PLATFORM-DIVERSITY SIZING (owner PERMANENT rule 2026-09-04): computed ONCE (a plain\n  -- CTE referenced 2+ times materializes by default), never a hand-maintained platform list/count.\n  platform_count as (select count(distinct platform) as n from matched)\n  select u.source_table,');
  if occ <> 1 then raise exception 'platform_count CTE anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    E'__AF_ELIGIBILITY_WHERE__\n  ),\n  -- DYNAMIC PLATFORM-DIVERSITY SIZING (owner PERMANENT rule 2026-09-04): computed ONCE (a plain\n  -- CTE referenced 2+ times materializes by default), never a hand-maintained platform list/count.\n  platform_count as (select count(distinct platform) as n from matched)\n  select u.source_table,',
    E'__AF_ELIGIBILITY_WHERE__\n  )\n  select u.source_table,');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon, u.distinct_platform_count\n  from (', ''))) / length(E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon, u.distinct_platform_count\n  from (');
  if occ <> 1 then raise exception 'final outer select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl, E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon, u.distinct_platform_count\n  from (', E'u.total_count, u.effective_price, u.area_m2, u.bedrooms, u.af_canon\n  from (');

  occ := (length(new_tmpl) - length(replace(new_tmpl, 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.distinct_platform_count, a.div_rank, a.photo_rank, a.rot_key', ''))) / length('a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.distinct_platform_count, a.div_rank, a.photo_rank, a.rot_key');
  if occ <> 1 then raise exception 'branch a outer select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl, 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.distinct_platform_count, a.div_rank, a.photo_rank, a.rot_key', 'a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.af_canon, a.div_rank, a.photo_rank, a.rot_key');

  occ := (length(new_tmpl) - length(replace(new_tmpl, 'count(*) over() as total_count, (select n from platform_count) as distinct_platform_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,', ''))) / length('count(*) over() as total_count, (select n from platform_count) as distinct_platform_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,');
  if occ <> 1 then raise exception 'branch a inner select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    'count(*) over() as total_count, (select n from platform_count) as distinct_platform_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,',
    'count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms, m.af_canon,');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon, t.distinct_platform_count,\n             case when coalesce(p_sort_by', ''))) / length(E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon, t.distinct_platform_count,\n             case when coalesce(p_sort_by');
  if occ <> 1 then raise exception 'branch t outer select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon, t.distinct_platform_count,\n             case when coalesce(p_sort_by',
    E't.total_count, t.effective_price, t.area_m2, t.bedrooms, t.af_canon,\n             case when coalesce(p_sort_by');

  occ := (length(new_tmpl) - length(replace(new_tmpl, E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count, (select n from platform_count) as distinct_platform_count,', ''))) / length(E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count, (select n from platform_count) as distinct_platform_count,');
  if occ <> 1 then raise exception 'branch t inner select anchor: expected 1, found %', occ; end if;
  new_tmpl := replace(new_tmpl,
    E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count, (select n from platform_count) as distinct_platform_count,',
    E'm.effective_price, m.area_m2, m.bedrooms, m.has_photo, m.af_canon,\n               count(*) over () as total_count,');

  occ := (length(new_tmpl) - length(replace(new_tmpl, '__AF_ELIGIBILITY_WHERE__', ''))) / length('__AF_ELIGIBILITY_WHERE__');
  if occ <> 1 then raise exception 'placeholder integrity check failed: found % occurrences', occ; end if;

  occ := (length(new_tmpl) - length(replace(new_tmpl, 'distinct_platform_count', ''))) / greatest(length('distinct_platform_count'), 1);
  if occ <> 0 then raise exception 'revert incomplete: % residual distinct_platform_count occurrence(s)', occ; end if;

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
