-- 🔧 Quality & Repair 2026-11-07 — SPEED (owner 2026-11-04 «we need to make sure it's never ever slow»; backlog 1468 / 1469;
-- alert cron_timeout_headroom 13564). The hourly search-index sync (cron jobid 28, sync_search_listings_ar) grew from
-- ~700 s (11-06 morning) to 811 s (11-07 12:22) and was KILLED by its own 600 s statement_timeout at 06:22 UTC, so nothing
-- scraped that hour reached customers.
--
-- Measured on production 2026-11-07 13:1x UTC (EXPLAIN ANALYZE on the abeea slice of the sync's SELECT, 172 rows):
--   · the v2 view itself costs 0.05 ms per row; the per-row change test (EXISTS on search_listings_ar s3) costs 0.775 ms
--     per row — and it runs for every row outside the 2 h window (~420,000 of 450,703) ≈ 325 s of the sync;
--   · of that 0.775 ms, ONE call is 0.72 ms: loc_display_district_ar()  (2,231 ms per 3,000 calls, baseline scan 75 ms)
--     against 0.02 ms for loc_display_city_ar and 0.035 ms for rent_pool_ar + rent_price_annual_ar together;
--   · its own pieces are cheap: norm_district_tok 0.017 ms, district_copy_of 0.05 ms, district_place_hidden 0.12 ms.
-- Root cause: the function is LANGUAGE sql with six scalar sub-selects. Such a body cannot be inlined, and PostgreSQL
-- re-PLANS a non-inlined SQL function on EVERY call; plpgsql caches its plans per session. Same logic, same fallback
-- order, same results — proven below over every distinct (city_id, district_ar) pair the sync can hand it — several
-- times cheaper per call. No product behaviour changes; no budget or timeout is touched.

-- 1. Snapshot the OLD function's answers over every pair the sync can see (plus edge cases), inside this transaction.
create temp table _ldd_pairs as
  select distinct city_id, district_ar from (
    select city_id, district_ar from public.listing_native_location_v1
    union all select city_id, district_ar from public.search_listings_ar
    union all select city_id, district_ar from public.listing_pin_district
  ) u;
insert into _ldd_pairs (city_id, district_ar) values
  (null, 'حي النرجس'), (3, null), (null, null), (3, ''), (3, '  حي  النرجس  '), (3, 'النرجس الجديد'), (3, 'حي الملقا 2'),
  (3, 'حي الرياض'), (2332, 'حي النخيل الغربي');
create temp table _ldd_old as
  select city_id, district_ar, public.loc_display_district_ar(city_id, district_ar) as shown from _ldd_pairs;

-- 2. The same function, same signature, same STABLE contract, as plpgsql (plans cached).
create or replace function public.loc_display_district_ar(p_city_id integer, p_raw text)
 returns text
 language plpgsql
 stable
as $function$
declare own text; key text; shown text;
begin
  -- 🔧 2026-11-07: this body is the former LANGUAGE sql body (six scalar sub-selects, coalesce chains) written as
  -- plpgsql so its plans are cached: 0.72 ms → a fraction of that per call; the hourly sync calls it ~420,000 times.
  -- Fallback ORDER is the former coalesce order; a sub-select that finds no row (or a NULL) falls through exactly as before.
  if p_raw is null then return null; end if;
  own := public.norm_district_tok(p_raw);

  select a.to_norm into key from public.loc_district_alias a
   where a.city_id = p_city_id and a.from_norm = own;
  if key is null and own ~ '\s+(ال)?جديد[ه]?$' then
    select b.district_norm into key from public.loc_catalog_district b
     where b.city_id = p_city_id
       and b.district_norm = regexp_replace(own, '\s+(ال)?جديد[ه]?$', '')
       and not exists (select 1 from public.loc_catalog_district f
                        where f.city_id = p_city_id and f.district_norm = own)
     limit 1;
  end if;
  if key is null then key := public.district_copy_of(p_city_id, p_raw); end if;
  if key is null then key := own; end if;

  select k.display_ar into shown from public.loc_display_district_canon k
   where k.city_id = p_city_id and k.district_norm = key;
  if shown is null and key <> own then
    select c.district_ar into shown from public.loc_catalog_district c
     where c.city_id = p_city_id and c.district_norm = key
     limit 1;
  end if;
  if shown is null then shown := p_raw; end if;

  if public.district_place_hidden(p_city_id, shown) then return null; end if;
  return shown;
end $function$;

-- 3. PROOF of identical answers: the new body against the snapshot, every pair.
do $$
declare n int; bad int; ex text;
begin
  select count(*),
         count(*) filter (where o.shown is distinct from public.loc_display_district_ar(o.city_id, o.district_ar))
    into n, bad
    from _ldd_old o;
  if bad > 0 then
    select string_agg(format('(%s, %L): old %L new %L', o.city_id, o.district_ar, o.shown,
                             public.loc_display_district_ar(o.city_id, o.district_ar)), ' | ')
      into ex
      from (select * from _ldd_old o2
             where o2.shown is distinct from public.loc_display_district_ar(o2.city_id, o2.district_ar) limit 5) o;
    raise exception 'PROOF: the plpgsql loc_display_district_ar differs from the SQL body on % of % pairs: %', bad, n, ex;
  end if;
  raise notice 'PROOF: loc_display_district_ar identical on % distinct (city, district) pairs', n;
end $$;

-- 4. The guard: a detector that TIMES the function on a fixed sample every sweep and raises before the sync is at risk
--    again (0.40 ms per call = the alarm; today's 0.72 ms would have fired it; the sync's own kill is the late signal).
create or replace function public.mon_detect_loc_display_district_speed()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare t0 timestamptz; ms1 numeric; ms2 numeric; per_call numeric; n int := 0;
        k constant text := 'loc_display_district_ar_slow'; lim constant numeric := 0.40;
begin
  -- a deterministic, tiny sample: the first 1,000 canon rows (display names are real raw inputs); timed twice, best of two,
  -- so a busy moment does not read as a regression.
  t0 := clock_timestamp();
  select count(public.loc_display_district_ar(s.city_id, s.display_ar)) into n
    from (select city_id, display_ar from public.loc_display_district_canon order by city_id, district_norm limit 1000) s;
  ms1 := extract(epoch from (clock_timestamp() - t0)) * 1000;
  t0 := clock_timestamp();
  perform count(public.loc_display_district_ar(s.city_id, s.display_ar))
    from (select city_id, display_ar from public.loc_display_district_canon order by city_id, district_norm limit 1000) s;
  ms2 := extract(epoch from (clock_timestamp() - t0)) * 1000;
  per_call := round(least(ms1, ms2) / greatest(n, 1), 3);
  if n < 100 then
    return 0;  -- nothing to time (an empty canon table is another detector's business)
  end if;
  if per_call > lim then
    return public.mon_raise('P1', k, 'search_index', k, jsonb_build_object(
      'per_call_ms', per_call, 'limit_ms', lim, 'calls', n,
      'why', 'loc_display_district_ar() is the single most expensive call of the hourly search-index sync (jobid 28): the sync evaluates it once per row outside its 2 h window (~420k calls). At 0.72 ms per call (2026-11-07) the sync took 700–811 s and was killed by its 600 s statement_timeout at 06:22 UTC.',
      'action', 'Time it (explain analyze over 3,000 search_listings_ar rows). Keep it plpgsql (plans cached); check that loc_district_alias(city_id,from_norm), loc_display_district_canon(city_id,district_norm) and loc_catalog_district(city_id,district_norm) still have their unique indexes, and that district_copy_of / district_place_hidden did not grow a table scan. Never raise this limit or the job timeout to go green.'));
  end if;
  perform public.mon_resolve_key(k, k);
  return 0;
end $function$;
revoke all on function public.mon_detect_loc_display_district_speed() from public, anon, authenticated;
grant execute on function public.mon_detect_loc_display_district_speed() to service_role;

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_loc_display_district_speed' in src) > 0 then
    raise notice 'mon_detect_loc_display_district_speed already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_cron_timeout_headroom'',',
    E'    ''mon_detect_cron_timeout_headroom'',\n    ''mon_detect_loc_display_district_speed'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- 5. PROOF: the guard runs clean on the fixed function and is on the roster; the measured per-call time is printed.
do $$
declare r int; t0 timestamptz; ms numeric;
begin
  t0 := clock_timestamp();
  perform count(public.loc_display_district_ar(city_id, district_ar)) from _ldd_pairs;
  ms := extract(epoch from (clock_timestamp() - t0)) * 1000;
  raise notice 'PROOF: new loc_display_district_ar over % pairs: % ms total, % ms per call',
    (select count(*) from _ldd_pairs), round(ms), round(ms / greatest((select count(*) from _ldd_pairs), 1), 3);
  r := public.mon_detect_loc_display_district_speed();
  if r <> 0 then
    raise exception 'PROOF: the speed detector still reads loc_display_district_ar as slow (alert raised) — the fix did not land';
  end if;
  if exists (select 1 from public.alert_event where dedup_key = 'loc_display_district_ar_slow' and resolved_at is null) then
    raise exception 'PROOF: a slow alert stayed open after a clean read';
  end if;
  if position('mon_detect_loc_display_district_speed' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
end $$;
