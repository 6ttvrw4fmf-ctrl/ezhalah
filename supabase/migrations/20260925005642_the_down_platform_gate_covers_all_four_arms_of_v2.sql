-- FIX for a_down_platform_hides_its_listings_and_keeps_its_logo, caught by that change's OWN
-- verification before anything user-visible shipped.
--
-- `listing_native_location_v2` is a UNION of FOUR arms and each computes its own
-- `AS production_ready` from its own aliases:
--   arm 1  ((COALESCE(v1.region_id, uac.region_id, …) IS NOT NULL) AND (COALESCE(v1.city_id, …) …))
--   arm 2  ((cc.region_id IS NOT NULL) AND (cc.city_id IS NOT NULL))            -- 'inline_lookup'
--   plus two more.
-- The previous migration string-replaced arm 1's expression, so it gated ONE arm. Marking the three
-- down platforms then left souq24's 42 residential rows visible because they arrive through another
-- arm; that migration's own check raised, the transaction rolled back, and no half-hidden platform
-- ever reached production.
--
-- Gating each arm separately would leave the identical trap for whoever adds arm 5. So the gate is
-- lifted OUT of the arms: the view is wrapped once and `production_ready` is ANDed with the dormant
-- test at the top level, where there is exactly one of it and every present and future arm inherits
-- it. The column list is rebuilt from information_schema in ordinal order, so CREATE OR REPLACE
-- keeps the identical column shape.
--
-- Arm 1 KEEPS its now-redundant copy of the same predicate. Unwinding it would mean regex-editing
-- SQL that Postgres has already reformatted (it stores `AND (NOT (EXISTS ( SELECT 1 FROM
-- platform_registry pr WHERE ((pr.platform = v1.platform) AND (pr.status = 'dormant'::text)))))`,
-- not the text that was submitted) — a fragile edit for a cosmetic gain. Two evaluations of the
-- same condition, ANDed, cannot disagree: the outer one is authoritative and total, the inner one
-- is a no-op on the rows it already covers.
do $mig$
declare v_def text; v_cols text; n_tests int; n_ready_before bigint; n_ready_after bigint;
begin
  select count(*) into n_ready_before from public.listing_native_location_v2 where production_ready;

  v_def := rtrim(btrim(pg_get_viewdef('public.listing_native_location_v2'::regclass)), ';');

  if position('base.production_ready' in v_def) <> 0 then
    raise exception 'listing_native_location_v2 already looks wrapped — refusing to nest a second wrapper';
  end if;

  select string_agg(
           case when column_name = 'production_ready'
                then 'base.production_ready AND NOT EXISTS (SELECT 1 FROM public.platform_registry pr '
                     || 'WHERE pr.platform = base.platform AND pr.status = ''dormant''::text) AS production_ready'
                else 'base.' || quote_ident(column_name) end,
           ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'listing_native_location_v2';

  if v_cols is null or position('AS production_ready' in v_cols) = 0 then
    raise exception 'could not rebuild the column list for listing_native_location_v2';
  end if;

  execute 'create or replace view public.listing_native_location_v2 as select ' || v_cols
          || ' from (' || v_def || ') base';

  -- the wrapper's own test, plus arm 1's surviving copy
  select count(*) into n_tests
    from regexp_matches(pg_get_viewdef('public.listing_native_location_v2'::regclass), 'dormant', 'g');
  if n_tests <> 2 then
    raise exception 'expected the wrapper test plus arm 1 copy (2 dormant tests), found %', n_tests;
  end if;

  -- nothing is dormant yet, so the wrap must not move a single row
  select count(*) into n_ready_after from public.listing_native_location_v2 where production_ready;
  if n_ready_after <> n_ready_before then
    raise exception 'the wrap changed production_ready counts (% -> %) while no platform is dormant',
                    n_ready_before, n_ready_after;
  end if;
end $mig$;

do $check$
begin
  if exists (select 1 from public.platform_registry where status = 'dormant') then
    raise exception 'a platform is already dormant — this rewrite must land as a no-op';
  end if;
end $check$;
