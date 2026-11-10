-- SOUQ24'S OWN TICKED AMENITIES REACH SEARCH, AND AN INDEX ARM CAN NO LONGER HIDE A FILLED COLUMN (🔬 2026-11-09).
--
-- The af-score customer path asked souq24_residential_listings:15739427 for «مدخل خاص» (its page ticks it) and the
-- Advanced Filter did not return it: the scraper stores private_entrance = true from the site's ticked spec row
-- (scrapers/souq24/run.py SPEC_CHECK_COLS, since 2026-11-05), but both souq24 arms of listing_native_location_v2 were
-- written before those columns existed and hard-code `NULL::boolean AS <amenity>`. sync_search_listings_ar() serves
-- af_rule_b(v.<col>, text facts), so only ads whose PROSE also said it were findable: 648153 and 15739427 (ticked
-- private entrance) served NULL, 648168 served true only through its sentence. Measured: souq24 is the only arm in the
-- view that hard-codes NULL over a column its table fills (private_entrance 3, air_conditioner 2 active rows).
--
-- 1. Both souq24 arms read their own boolean amenity columns (all true-only ticks; silence stays NULL, never false).
-- 2. mon_detect_index_arm_drops_filled_amenity(): any arm of the view that hard-codes NULL for an amenity its own table
--    fills raises P2, per table × column, and resolves when the arm reads it. Rostered in this migration.
set local lock_timeout = '15s';

do $mig$
declare
  d text := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  t text; head text; arm_start int; arm_end int; arm text; patched text; c text; n int;
  cols constant text[] := array['elevator','parking','kitchen','air_conditioner','maid_room','driver_room','private_entrance'];
begin
  foreach t in array array['souq24_residential_listings', 'souq24_commercial_listings'] loop
    head := format($f$'%s'::text AS source_table$f$, t);
    arm_start := position(head in d);
    if arm_start = 0 or position(head in substr(d, arm_start + 1)) > 0 then
      raise exception 'listing_native_location_v2: % arm not found exactly once', t;
    end if;
    arm_end := arm_start + position(format('FROM (((%s s', t) in substr(d, arm_start)) - 1;
    if arm_end < arm_start then raise exception 'listing_native_location_v2: % arm FROM not found', t; end if;
    arm := substr(d, arm_start, arm_end - arm_start);
    patched := arm;
    foreach c in array cols loop
      n := (length(patched) - length(replace(patched, format('NULL::boolean AS %s', c), ''))) / length(format('NULL::boolean AS %s', c));
      if n <> 1 then raise exception '% arm: «NULL::boolean AS %» found % times, expected 1', t, c, n; end if;
      if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = c) then
        raise exception '% has no column %', t, c;
      end if;
      patched := replace(patched, format('NULL::boolean AS %s', c), format('s.%s', c));
    end loop;
    d := substr(d, 1, arm_start - 1) || patched || substr(d, arm_end);
  end loop;
  execute 'create or replace view public.listing_native_location_v2 as ' || d;
end
$mig$;

create or replace function public.index_arm_drops_filled_amenity()
 returns table (source_table text, col text, filled bigint)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare r record; v bigint;
begin
  for r in
    with arms as (select a from regexp_split_to_table(pg_get_viewdef('public.listing_native_location_v2'::regclass), 'UNION ALL') a),
         arm_t as (select (regexp_match(a, $$'([a-z0-9_]+_listings)'::text AS source_table$$))[1] tbl, a from arms),
         nulls as (select distinct tbl, (m)[1] c from arm_t,
                     regexp_matches(a, 'NULL::boolean AS (elevator|parking|kitchen|air_conditioner|maid_room|driver_room|private_entrance|furnished)', 'g') m
                    where tbl is not null)
    select n.tbl, n.c from nulls n
      join information_schema.columns ic on ic.table_schema = 'public' and ic.table_name = n.tbl and ic.column_name = n.c
      join information_schema.columns ia on ia.table_schema = 'public' and ia.table_name = n.tbl and ia.column_name = 'active'
  loop
    execute format('select count(*) from public.%I where active and %I is not null', r.tbl, r.c) into v;
    if v > 0 then
      source_table := r.tbl; col := r.c; filled := v; return next;
    end if;
  end loop;
end
$function$;
revoke execute on function public.index_arm_drops_filled_amenity() from public, anon, authenticated;

create or replace function public.mon_detect_index_arm_drops_filled_amenity()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; r record; live text[] := '{}';
begin
  if exists (select 1 from public.ops_detector_last_full_run
              where detector = 'index_arm_drops_filled_amenity' and last_run_at > now() - interval '20 hours') then
    return 0;
  end if;
  for r in select * from public.index_arm_drops_filled_amenity() loop
    live := live || ('index_arm_drops_filled_amenity:' || r.source_table || ':' || r.col);
    n := n + public.mon_raise('P2', 'index_arm_drops_filled_amenity', split_part(r.source_table, '_', 1),
      'index_arm_drops_filled_amenity:' || r.source_table || ':' || r.col,
      jsonb_build_object('table', r.source_table, 'column', r.col, 'active_rows_filled', r.filled,
        'why', 'The scraper fills this Advanced Filter column but the table''s arm of listing_native_location_v2 '
            || 'hard-codes NULL::boolean for it, so search serves only what the prose reader says and a customer '
            || 'filtering for it misses the ads whose site ticks it (souq24 private_entrance, 2026-11-09).',
        'action', 'Point the arm at s.<column> with the exactly-once replace pattern of the 2026-11-09 souq24 migration.'));
  end loop;
  perform public.mon_resolve_stale_keys('index_arm_drops_filled_amenity', live);
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
    select 'index_arm_drops_filled_amenity', now(), n
     where not exists (select 1 from public.ops_detector_last_full_run where detector = 'index_arm_drops_filled_amenity');
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n
   where detector = 'index_arm_drops_filled_amenity';
  return n;
end
$function$;
revoke execute on function public.mon_detect_index_arm_drops_filled_amenity() from public, anon, authenticated;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_index_arm_drops_filled_amenity' in src) > 0 then
    raise notice 'already on the roster'; return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_licence_not_on_card'',',
    E'    ''mon_detect_licence_not_on_card'',\n    ''mon_detect_index_arm_drops_filled_amenity'',');
  if out_def = src then raise exception 'roster anchor not found — refusing to guess where the entry belongs'; end if;
  execute out_def;
end $$;

-- PROOF: the arms read the columns, the view returns the stored ticks, nothing is left for the detector, and a
-- planted NULL arm is caught (rolled back).
do $$
declare v_pe boolean; v_left int; v_hit int; d text;
begin
  select private_entrance into v_pe from public.listing_native_location_v2
   where source_table = 'souq24_residential_listings' and listing_id = 15739427;
  if v_pe is distinct from (select private_entrance from public.souq24_residential_listings where id = 15739427 and active) then
    raise exception 'PROOF: the view does not carry souq24 15739427''s stored private_entrance';
  end if;
  select count(*) into v_left from public.index_arm_drops_filled_amenity();
  if v_left <> 0 then raise exception 'PROOF: % arm/column pair(s) still hard-code NULL over a filled column', v_left; end if;
  delete from public.ops_detector_last_full_run where detector = 'index_arm_drops_filled_amenity';
  perform public.mon_detect_index_arm_drops_filled_amenity();
  begin
    d := pg_get_viewdef('public.listing_native_location_v2'::regclass);
    execute 'create or replace view public.listing_native_location_v2 as '
         || replace(d, $q$s.private_entrance
           FROM (((souq24_residential_listings s$q$, $q$NULL::boolean AS private_entrance
           FROM (((souq24_residential_listings s$q$);
    delete from public.ops_detector_last_full_run where detector = 'index_arm_drops_filled_amenity';
    perform public.mon_detect_index_arm_drops_filled_amenity();
    select count(*) into v_hit from public.alert_event
     where dedup_key = 'index_arm_drops_filled_amenity:souq24_residential_listings:private_entrance' and resolved_at is null;
    if v_hit = 0 then raise exception 'PROOF: a planted NULL arm over a filled column was not caught'; end if;
    raise exception '__arm_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__arm_selftest_rollback__' then raise; end if;
  end;
  if position('mon_detect_index_arm_drops_filled_amenity' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
end $$;
