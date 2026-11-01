-- APPLIED 2026-10-18 (owner session). Coordinator decisions 10-18, after 20261018112657:
--
-- 1) NO TRUNCATE IN THE HOURLY REFILL. refresh_district_recovery() (job 17 at :20, cron 45 at :10) emptied the table with
--    TRUNCATE and refilled it. TRUNCATE is not MVCC-safe: a sync whose snapshot predates the commit sees an EMPTY table and
--    serves every recovered district (dealapp, abralosol, aqar … ~112k rows) as NULL — the «stale v1 read reverts repairs»
--    class. Now each table is refilled by DELETE-by-key + INSERT, and a table whose new rows would LOSE more than 1% of
--    the districts it recovered for listings still eligible in v1 keeps its previous rows and raises a pipeline alert
--    ('district_recovery_shrank') instead — never a fleet-wide drop, and never a failed job 17 (which would also stop
--    the hourly matview refresh). Deactivated listings do not count as losses.
--
-- 2) THE المبرز HOLD (decision: keep the 137 carried districts) + A DETERMINISTIC CITY CORRECTION. For rows whose city is
--    the office default الاحساء (3677) / الهفوف (12) and whose district is one of the 10-08 hold names (the 🔧's list of
--    المبرز-only names), the city moves when — and only when — that name is a catalog district (loc_catalog_district) of
--    exactly ONE city of the الأحساء governorate other than الهفوف/الاحساء. Exists in الهفوف too, or in no catalog city
--    (الغسانية، جوهرة النزهة … today) → the city stays and the district stays carried. No fuzzy matching; provenance
--    city_source = 'unique_district_in_governorate'. Served through listing_native_location_v2 (a correction joined
--    ahead of v1's city), refreshed hourly inside refresh_district_recovery().
--    NOT generalised to every name: «unique in the governorate catalog» is only deterministic where the 🔧 already ruled
--    the name المبرز-only — for common names («اليمامة»، «المروج»، «النور») the الهفوف catalog is incomplete, so
--    uniqueness there would be a guess (measured: ~800 more rows would move, incl. «المدينة المنورة» → الجفر).
--    ponytail: the governorate is a literal list of 33 catalog city ids — use a governorate column when the catalog has one.

-- (2a) the correction table + its refresh
create table if not exists public.listing_city_correction (
  source_table  text        not null,
  listing_id    bigint      not null,
  city_id       integer     not null,
  city_source   text        not null,
  district_norm text        not null,
  corrected_at  timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.listing_city_correction enable row level security;

create or replace function public.ahsa_governorate_city_ids()
returns integer[]
language sql immutable
as $$ select array[3677,2644,2759,2018,2746,2764,2749,2762,2742,2760,2745,2747,2645,2003,2763,2035,2653,2038,2744,2739,2646,2737,2748,2639,2743,2750,2740,2738,12,2647,2752,2756,2643] $$;

create or replace function public.refresh_listing_city_correction()
returns bigint
language plpgsql
as $function$
declare n bigint;
begin
  delete from public.listing_city_correction where city_source = 'unique_district_in_governorate';
  insert into public.listing_city_correction (source_table, listing_id, city_id, city_source, district_norm)
  select v1.source_table, v1.listing_id, u.city_id, 'unique_district_in_governorate', u.district_norm
    from public.listing_native_location_v1 v1
    left join public.district_recovery dr on dr.source_table = v1.source_table and dr.listing_id = v1.listing_id
    join (select d.district_norm, min(d.city_id) as city_id
            from public.loc_catalog_district d
           where d.city_id = any (public.ahsa_governorate_city_ids())
           group by d.district_norm
          having count(distinct d.city_id) = 1) u
      on u.district_norm = public.norm_district_tok(coalesce(nullif(btrim(v1.district_ar), ''), dr.district_ar))
   where v1.city_id in (12, 3677)
     and u.city_id not in (12, 3677)
     -- the 10-08 المبرز hold names (resolve_district_ar), nothing else
     and u.district_norm in ('غسانيه','جوهره الهادي','جابريه','دانه الراشديه','بوسحبل','راجحي','جوهره النزهه','بستان المطيرفي',
                             'فتح','اتصالات','رضا بالمبرز','بو سحبل الثاني','صناعيه','بو سحبل الاول')
  on conflict (source_table, listing_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

-- (1) the per-table refill, loss-guarded, no TRUNCATE
create or replace function public.refresh_district_recovery_table(p_table text)
returns bigint
language plpgsql
as $function$
declare m bigint; n bigint := 0; has_url boolean; v_elig bigint; v_lost bigint;
begin
  select exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'listing_url') into has_url;
  create temp table if not exists _drt (
    source_table text, listing_id bigint, district_ar text, resolved_at timestamptz, verbatim boolean,
    primary key (source_table, listing_id)) on commit drop;
  delete from _drt;

  execute format($f$
    insert into _drt (source_table, listing_id, district_ar, resolved_at, verbatim)
    select %1$L, v1.listing_id, d.val, now(),
           public.norm_district_tok(d.val) = public.norm_district_tok(x.neighborhood)
    from public.listing_native_location_v1 v1
    join (select distinct on (id) id, neighborhood, %3$s as listing_url from public.%2$I order by id, neighborhood) x
      on x.id = v1.listing_id
    left join public.search_listings_ar s on s.source_table = v1.source_table and s.listing_id = v1.listing_id
    cross join lateral (select public.district_recovery_value(v1.platform, coalesce(v1.city_id, s.city_id), x.neighborhood, x.listing_url) as val) d
    where v1.source_table = %1$L
      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and d.val is not null
      and not exists (
            select 1 from public.listing_source_district_ar sd
            where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)
    on conflict (source_table, listing_id) do nothing
  $f$, p_table, p_table, case when has_url then 'listing_url' else 'null::text' end);

  insert into _drt (source_table, listing_id, district_ar, resolved_at, verbatim)
  select v1.source_table, v1.listing_id, d.val, now(),
         public.norm_district_tok(d.val) = public.norm_district_tok(sd.source_district_ar)
  from public.listing_native_location_v1 v1
  join public.listing_source_district_ar sd
    on sd.source_table = v1.source_table and sd.listing_id = v1.listing_id
  left join public.search_listings_ar s on s.source_table = v1.source_table and s.listing_id = v1.listing_id
  cross join lateral (select public.district_recovery_value(v1.platform, coalesce(v1.city_id, s.city_id), sd.source_district_ar) as val) d
  where v1.source_table = p_table
    and (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
  on conflict (source_table, listing_id) do update
    set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at, verbatim = excluded.verbatim;

  -- LOSS GUARD: districts recovered last time for listings STILL eligible in v1, missing from the new set
  select count(*), count(*) filter (where n2.listing_id is null) into v_elig, v_lost
    from public.district_recovery o
    join public.listing_native_location_v1 v1 on v1.source_table = o.source_table and v1.listing_id = o.listing_id
    left join _drt n2 on n2.source_table = o.source_table and n2.listing_id = o.listing_id
   where o.source_table = p_table and (v1.district_ar is null or btrim(v1.district_ar) = '');
  if v_elig >= 50 and v_lost > 0.01 * v_elig then
    insert into public.location_pipeline_alerts (alert_type, metric, detail)
    values ('district_recovery_shrank', v_lost,
            format('%s: the new refill would lose %s of %s recovered districts of still-eligible listings (> 1%%) — kept the previous rows (owner 10-18: never drop a district). Find what changed in resolve_district_ar / district_recovery_value / the catalog.', p_table, v_lost, v_elig));
    return 0;
  end if;

  delete from public.district_recovery where source_table = p_table;
  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
  select source_table, listing_id, district_ar, resolved_at, verbatim from _drt;
  get diagnostics m = row_count;
  return m;
end $function$;

create or replace function public.refresh_district_recovery()
returns bigint
language plpgsql
as $function$
declare r record; n bigint := 0; m bigint;
begin
  for r in
    select c.table_name as t
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    n := n + public.refresh_district_recovery_table(r.t);
  end loop;

  -- source-district rows of tables WITHOUT a neighborhood column: upsert only (MVCC-safe; nothing is emptied)
  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
  select v1.source_table, v1.listing_id, d.val, now(),
         public.norm_district_tok(d.val) = public.norm_district_tok(sd.source_district_ar)
  from public.listing_native_location_v1 v1
  join public.listing_source_district_ar sd
    on sd.source_table = v1.source_table and sd.listing_id = v1.listing_id
  cross join lateral (select public.district_recovery_value(v1.platform, v1.city_id, sd.source_district_ar) as val) d
  where (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
    and not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = v1.source_table and c.column_name = 'neighborhood')
  on conflict (source_table, listing_id)
    do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                  verbatim = excluded.verbatim;
  get diagnostics m = row_count;
  n := n + m;

  perform public.refresh_listing_city_correction();
  return n;
end;
$function$;

-- (2b) serve the corrected city: listing_native_location_v2 takes the correction ahead of v1's city
do $v2$
declare d text; k int;
  a_join text := 'LEFT JOIN district_recovery dr ON dr.source_table = v1.source_table AND dr.listing_id = v1.listing_id';
  a_city text := 'COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id)';
  a_reg  text := 'COALESCE(v1.region_id, uac.region_id, ulgc.region_id, ulg2c.region_id, uc.region_id)';
  a_car  text := 'COALESCE(v1.city_ar, uc.city_ar, ccl.city_ar)';
  a_rar  text := 'COALESCE(v1.region_ar, uar.region_ar, ulgr.region_ar, ulg2r.region_ar, ur.region_ar)';
begin
  d := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);
  if position('xcc.city_id' in d) > 0 then raise notice 'v2 already serves the city correction'; return; end if;
  k := (length(d) - length(replace(d, a_join, ''))) / length(a_join); if k <> 1 then raise exception 'v2 anchor join found % times', k; end if;
  k := (length(d) - length(replace(d, a_city, ''))) / length(a_city); if k <> 3 then raise exception 'v2 anchor city found % times', k; end if;
  k := (length(d) - length(replace(d, a_reg, ''))) / length(a_reg);   if k <> 2 then raise exception 'v2 anchor region found % times', k; end if;
  k := (length(d) - length(replace(d, a_car, ''))) / length(a_car);   if k <> 1 then raise exception 'v2 anchor city_ar found % times', k; end if;
  k := (length(d) - length(replace(d, a_rar, ''))) / length(a_rar);   if k <> 1 then raise exception 'v2 anchor region_ar found % times', k; end if;
  d := replace(d, a_join, a_join
       || ' LEFT JOIN listing_city_correction xcc ON xcc.source_table = v1.source_table AND xcc.listing_id = v1.listing_id'
       || ' LEFT JOIN loc_catalog_city xccc ON xccc.city_id = xcc.city_id'
       || ' LEFT JOIN loc_catalog_region xccr ON xccr.region_id = xccc.region_id');
  d := replace(d, a_city, 'COALESCE(xcc.city_id, v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id)');
  d := replace(d, a_reg,  'COALESCE(xccc.region_id, v1.region_id, uac.region_id, ulgc.region_id, ulg2c.region_id, uc.region_id)');
  d := replace(d, a_car,  'COALESCE(xccc.city_ar, v1.city_ar, uc.city_ar, ccl.city_ar)');
  d := replace(d, a_rar,  'COALESCE(xccr.region_ar, v1.region_ar, uar.region_ar, ulgr.region_ar, ulg2r.region_ar, ur.region_ar)');
  execute 'create or replace view public.listing_native_location_v2 as ' || d;
end $v2$;

-- PROOF + SAFE REFILL, one transaction, the pipeline's locks held.
do $proof$
declare got boolean; before_total bigint; after_total bigint; moved bigint; bad bigint; diff bigint; n_before bigint; n_after bigint;
begin
  perform pg_advisory_xact_lock(hashtext('location_pipeline:v1_refresh'));
  got := pg_try_advisory_xact_lock(hashtext('search_listings_ar:single_writer'));
  if not got then raise exception 'SAFE REFILL: the search-index writer lock is held by another session — not applying'; end if;

  -- no TRUNCATE left anywhere that writes district_recovery
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.prosrc ~* 'truncate\s+(public\.)?district_recovery') then
    raise exception 'PROOF: a function still truncates district_recovery';
  end if;

  create temp table _v2_before on commit drop as
    select source_table, listing_id, city_id, district_ar from public.listing_native_location_v2
     where source_table ~ '^(abralosol|arkaan|aqalemhajer|bossbih|shomou|alshawaf|dealapp)_';
  select count(*) into before_total from public.district_recovery;

  perform public.refresh_district_recovery();

  select count(*) into after_total from public.district_recovery;
  if after_total < 0.99 * before_total then
    raise exception 'SAFE REFILL: district_recovery % → % (< 99%%) — rolled back', before_total, after_total;
  end if;
  select count(*) into moved from public.listing_city_correction where city_source = 'unique_district_in_governorate';
  select count(*) into bad from public.listing_city_correction
   where city_source = 'unique_district_in_governorate'
     and (city_id in (12, 3677) or not (city_id = any (public.ahsa_governorate_city_ids())));
  if bad <> 0 then raise exception 'PROOF: % corrections point outside the governorate or back to الهفوف/الاحساء', bad; end if;

  select count(*) into n_before from _v2_before;
  select count(*) into n_after from public.listing_native_location_v2
   where source_table ~ '^(abralosol|arkaan|aqalemhajer|bossbih|shomou|alshawaf|dealapp)_';
  if n_after <> n_before then raise exception 'PROOF: v2 row count changed % → %', n_before, n_after; end if;
  select count(*) into diff
    from _v2_before b join public.listing_native_location_v2 v using (source_table, listing_id)
   where v.city_id is distinct from b.city_id
     and not exists (select 1 from public.listing_city_correction x where x.source_table = b.source_table and x.listing_id = b.listing_id);
  if diff <> 0 then raise exception 'PROOF: % rows changed city without a correction row', diff; end if;
  select count(*) into diff
    from _v2_before b join public.listing_native_location_v2 v using (source_table, listing_id)
   where v.district_ar is null and b.district_ar is not null;
  if diff <> 0 then raise exception 'PROOF: % rows lost their district in v2', diff; end if;
  raise notice 'PROOF OK: no TRUNCATE; recovery % → %; % ads moved to their unique governorate city; nothing else changed city', before_total, after_total, moved;
end $proof$;
