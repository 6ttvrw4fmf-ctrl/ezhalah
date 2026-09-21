-- EXACT MEASUREMENTS (owner 2026-09-21: «we should never ever get this ever ever again»).
--
-- area_m2, price_per_meter, street_width_m, interior_space_m2 and outdoor_area_m2 were integer /
-- smallint columns, so a source's 407.56 m² was stored as 407 or 408: ~3,700 live cards showed the
-- wrong size and the labelled ≈ ppm × area total was off by up to 4,834 SAR. This migration makes
-- every live copy of those columns numeric, end to end, in ONE transaction (any failure = no change):
--   1. drop the 14 views / matview that depend on them (captured from their LIVE definitions first),
--   2. convert the columns on every live listing table and on search_listings_ar,
--   3. rebuild price_total_effective so the ≈ total rounds ONLY the final figure:
--        when price_total is not null then price_total
--        when deal_ar = 'بيع' and price_annual is null and price_per_meter is not null
--             and area_m2 > 0 and round(price_per_meter * area_m2) <= 500000000
--        then round(price_per_meter * area_m2)
--   4. recreate the views exactly (grants, options, comments, matview indexes); the one view that
--      cast street width back to smallint (listing_extra_attrs_v0) now keeps numeric,
--   5. fix the three functions that would have re-truncated: price_size_impossible(…, area integer),
--      trg_aqar_parse (safe_int on area_m2), aqar_parse (int area, digits-only regex),
--   6. make the abralosol area detector compare EXACT values (it judged truncation as correct),
--   7. add mon_detect_integer_measurement_columns: P1 if any live listing table ever holds these
--      columns as an integer type again (a platform table cloned from old DDL).
-- scripts/verify-exact-measurements.ts fails any later migration that re-declares them integer.
-- The WHOLE migration is ONE do-block (one statement): atomic whether or not the runner wraps a
-- transaction. lock_timeout 10s: never queue behind a long lock and stall search — fail and retry.
do $exact$
declare
  cols   text[] := array['area_m2','price_per_meter','street_width_m','interior_space_m2','outdoor_area_m2'];
  d      record;
  t      record;
  alters text;
  src    text;
  n      int;
begin
  perform set_config('lock_timeout', '10s', true);
  -- ── 1. capture every dependent view/matview (recursive), in creation order ─────────────────────
  create temp table _exact_deps on commit drop as
  with recursive base as (
    select c.oid relid, a.attnum from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace s on s.oid=c.relnamespace
     where s.nspname='public' and c.relkind='r' and a.attname = any(cols) and c.relname !~ '(backup|_bak)'),
  tree(oid, lvl) as (
    select distinct r.ev_class, 1 from pg_depend dp join pg_rewrite r on r.oid=dp.objid
      join base b on b.relid=dp.refobjid and b.attnum=dp.refobjsubid where dp.classid='pg_rewrite'::regclass
    union
    select r.ev_class, t.lvl+1 from tree t join pg_depend dp on dp.refobjid=t.oid and dp.classid='pg_rewrite'::regclass
      join pg_rewrite r on r.oid=dp.objid where r.ev_class<>t.oid)
  select c.relname::text as name, c.relkind as kind, max(t.lvl) as lvl,
         pg_get_viewdef(c.oid) as def, c.reloptions as opts, obj_description(c.oid, 'pg_class') as cmt,
         array(select pg_get_indexdef(i.indexrelid) from pg_index i where i.indrelid=c.oid) as idx,
         array(select format('grant %s on %I to %s', a.privilege_type, c.relname,
                             case when a.grantee=0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end)
                 from aclexplode(c.relacl) a where a.grantee <> c.relowner) as grants
    from tree t join pg_class c on c.oid=t.oid group by c.oid;

  select count(*) into n from _exact_deps;
  if n <> 14 then raise exception 'expected 14 dependent views/matviews, found %', n; end if;

  for d in select * from _exact_deps order by lvl desc, name loop
    execute format('drop %s %I', case d.kind when 'm' then 'materialized view' else 'view' end, d.name);
  end loop;

  -- ── 2. price_total_effective depends on area/ppm: drop it (and its indexes) before the retype ──
  create temp table _exact_eff_idx on commit drop as
    select pg_get_indexdef(i.indexrelid) as def from pg_index i
     where i.indrelid='public.search_listings_ar'::regclass and pg_get_indexdef(i.indexrelid) ~ 'price_total_effective';
  alter table public.search_listings_ar drop column price_total_effective;

  -- ── 3. retype every live copy of the measurement columns ──────────────────────────────────────
  for t in
    select c.relname, string_agg(format('alter column %I type numeric using %I::numeric', a.attname, a.attname), ', ') as parts
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace
     where s.nspname='public' and c.relkind='r' and a.attname = any(cols) and not a.attisdropped
       and format_type(a.atttypid, a.atttypmod) in ('integer','smallint','bigint')
       and c.relname !~ '(backup|_bak)'
     group by c.relname
  loop
    execute format('alter table public.%I %s', t.relname, t.parts);
  end loop;

  alter table public.search_listings_ar add column price_total_effective bigint generated always as (
    case
      when price_total is not null then price_total
      when deal_ar = 'بيع' and price_annual is null and price_per_meter is not null
           and area_m2 is not null and area_m2 > 0
           and round(price_per_meter * area_m2) <= 500000000
      then round(price_per_meter * area_m2)
      else null
    end) stored;
  for d in select def from _exact_eff_idx loop execute d.def; end loop;

  -- ── 4. price_size_impossible takes a numeric area (mon_filter_barrier_leaks calls it; the old
  --      integer signature cannot bind a numeric area_m2), then recreate the views, lowest level first
  create or replace function public.price_size_impossible(pt numeric, pa numeric, area numeric)
    returns boolean language sql immutable as $f$
    select coalesce(pt,0) > 50000000000
        or coalesce(pa,0) > 50000000000
        or coalesce(area,0) > 50000000
        or (area is not null and area > 0
            and greatest(coalesce(pt,0), coalesce(pa,0)) / area > 5000000);
  $f$;

  for d in select * from _exact_deps order by lvl, name loop
    src := d.def;
    if d.name = 'listing_extra_attrs_v0' then
      if src !~ '::numeric\)::smallint' then raise exception 'listing_extra_attrs_v0: smallint cast not found'; end if;
      src := replace(src, '::numeric)::smallint', '::numeric)');   -- street width keeps its decimals
    end if;
    execute format('create %s public.%I as %s', case d.kind when 'm' then 'materialized view' else 'view' end, d.name, src);
    if d.opts is not null then
      execute format('alter %s public.%I set (%s)', case d.kind when 'm' then 'materialized view' else 'view' end,
                     d.name, array_to_string(d.opts, ', '));
    end if;
    foreach src in array d.idx loop execute src; end loop;
    foreach src in array d.grants loop execute src; end loop;
    if d.cmt is not null then
      execute format('comment on %s public.%I is %L', case d.kind when 'm' then 'materialized view' else 'view' end, d.name, d.cmt);
    end if;
  end loop;

  -- ── 5. the three functions that would re-truncate ──────────────────────────────────────────────
  src := pg_get_functiondef('public.trg_aqar_parse'::regproc);
  if position($s$public.safe_int(p->>'area_m2')$s$ in src) = 0 then raise exception 'trg_aqar_parse: area safe_int not found'; end if;
  execute replace(src, $s$public.safe_int(p->>'area_m2')$s$, $s$public.safe_numeric(p->>'area_m2')$s$);

  src := pg_get_functiondef('public.aqar_parse'::regproc);
  if position('v_area int;' in src) = 0
     or position($s$'المساحة(?!\s*حسب)'), '\d[\d,]*')$s$ in src) = 0
     or position('v_price = v_area::bigint' in src) = 0 then
    raise exception 'aqar_parse: expected area code not found';
  end if;
  src := replace(src, 'v_area int;', 'v_area numeric;');
  -- keep a 1-2 digit fraction ("457.5", "183.72"); a 3-digit group ("120.475") still stops at the dot, as before
  src := replace(src, $s$'المساحة(?!\s*حسب)'), '\d[\d,]*')$s$, $s$'المساحة(?!\s*حسب)'), '\d[\d,]*(?:\.\d{1,2}(?!\d))?')$s$);
  src := replace(src, 'v_price = v_area::bigint', 'v_price = v_area');
  execute src;


  -- ── 6. the abralosol area detector judged the TRUNCATED figure as "published" ────────────────
  src := pg_get_functiondef('public.mon_detect_area_contradicts_capture'::regproc);
  if position($s$nullif(regexp_replace(split_part(replace(raw, ',', ''), '.', 1), '[^0-9]', '', 'g'), '')::bigint$s$ in src) = 0 then
    raise exception 'mon_detect_area_contradicts_capture: published-area expression not found';
  end if;
  execute replace(src,
    $s$nullif(regexp_replace(split_part(replace(raw, ',', ''), '.', 1), '[^0-9]', '', 'g'), '')::bigint$s$,
    $s$(regexp_match(replace(raw, ',', ''), '\d+(?:\.\d+)?'))[1]::numeric$s$);
  drop function public.price_size_impossible(numeric, numeric, integer);   -- nothing binds it any more

  -- ── 7. production tripwire: a listing table must never hold a measurement as an integer again
  create or replace function public.mon_detect_integer_measurement_columns()
  returns integer language plpgsql security definer set search_path to 'public' as $f$
declare
  bad  text[];
  live text[] := '{}';
  n    int := 0;
begin
  select array_agg(c.relname || '.' || a.attname order by c.relname, a.attname) into bad
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace
   where s.nspname='public' and c.relkind in ('r','m')
     and (c.relname ~ '_(residential|commercial)_listings$' or c.relname in ('search_listings_ar','active_listing_ids_v2'))
     and c.relname !~ '(backup|_bak)'
     and a.attname in ('area_m2','price_per_meter','street_width_m','interior_space_m2','outdoor_area_m2')
     and not a.attisdropped and format_type(a.atttypid, a.atttypmod) in ('integer','smallint','bigint');
  if bad is not null then
    live := array['integer_measurement_columns'];
    n := public.mon_raise('P1', 'integer_measurement_columns', 'fleet', 'integer_measurement_columns',
      jsonb_build_object('columns', to_jsonb(bad),
        'why', 'A measurement column is an integer type again, so every decimal the source publishes '
            || '(407.56 m², 32.5 m street) is cut off on write. Owner rule 2026-09-21: never again.',
        'action', 'alter column … type numeric (see *_exact_measurements.sql). A new platform table was '
            || 'probably cloned from pre-2026-09-21 DDL.'));
  end if;
  perform public.mon_resolve_stale_keys('integer_measurement_columns', live);
  return n;
end $f$;

  perform cron.schedule('mon-integer-measurement-columns', '17 6 * * *',
                     'select public.mon_detect_integer_measurement_columns()');

  -- in-migration self-test
  if exists (select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace
              where s.nspname='public' and c.relkind in ('r','m','v') and c.relname !~ '(backup|_bak)'
                and (c.relname ~ '_(residential|commercial)_listings$' or c.relname in ('search_listings_ar','active_listing_ids_v2'))
                and a.attname in ('area_m2','price_per_meter','street_width_m','interior_space_m2','outdoor_area_m2')
                and format_type(a.atttypid, a.atttypmod) in ('integer','smallint','bigint')) then
    raise exception 'self-test: a live measurement column is still an integer type';
  end if;
  if not public.price_size_impossible(1, 1, 60000000.5) or public.price_size_impossible(500000, null, 407.56) then
    raise exception 'self-test: price_size_impossible(numeric area) misbehaves';
  end if;
  perform pg_notify('pgrst', 'reload schema');
end
$exact$;
