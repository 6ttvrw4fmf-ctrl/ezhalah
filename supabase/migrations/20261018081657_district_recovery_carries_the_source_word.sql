-- APPLIED 2026-10-18 (owner session). Owner 2026-10-18: «Deal App ads DO carry a district, yet 1,922 live rows show none».
--
-- ROOT CAUSE. dealapp and abralosol have no native arm in listing_native_location_v1; their district reaches the served
-- index only through public.district_recovery (listing_native_location_v2: COALESCE(v1.district_ar, dr.district_ar)).
-- refresh_district_recovery() kept a row only when resolve_district_ar() found the ad's neighborhood in the catalog
-- («where d.val is not null»), so a district the SOURCE states but the catalog lacks — «حي قريه ديراب» (المزاحمية, 30 ads),
-- «حي الجامعة» (الدمام), «ضاحية هجر» (الهفوف, 146 abralosol ads) — became NULL in the index: 2,036 dealapp + 714 abralosol
-- live rows measured 2026-10-18 08:00 UTC (8,065 fleet-wide; the other platforms are reported, not changed — owner's call).
-- Today's fleet alarm (unknown_named_districts) could not see either platform: it scans only raw tables that have
-- city_id/district_ar columns, which dealapp and abralosol lack.
--
-- FIX (SOURCE IS TRUTH, owner 2026-08-09): when the catalog has no match the index carries the source's own word, exactly as
-- written (canonical spelling still wins when the word is an exact variant of a known district — resolve_district_ar first;
-- placeholders «غير محدد/اخرى» stay NULL; nothing is fuzzy-matched; a city/town name the source prints as its district is
-- kept as the source wrote it, never folded into a city). A carried word is `verbatim`, so refresh_loc_canonical_district()
-- admits it as source='live' and district_options_ar lists it in the Filter typeahead with the same scope as the results.
--
-- ALSO (same bridge, same owner message): 32 dealapp rows with a blank neighborhood have raw `city` NULL yet the index shows a
-- city. That city is NOT a guess — it is the source's own Arabic city (additional_info->>'city_ar') through
-- resolve_dealapp_city(). But that bridge only ever FILLED gaps (s.city_id is null), so a bridge row written from an older
-- value was never corrected when the source said otherwise: ad 539820 source «ساجر», bridge «مكة المكرمة». The gap now also
-- includes rows whose bridge city disagrees with the source's Arabic city (the existing one-catalog-city rule still gates
-- the write), and the bridge rows whose city the source never stated (source city ambiguous, English city NULL) are cleared.
--
-- GUARDS: source_district_dropped_rows() measures "source has a district, index has none" per platform;
-- mon_detect_source_district_dropped() raises P1 for the carry platforms (3 h grace for the hourly pipeline) and carries the
-- fleet table in its detail; it is rostered in mon_run_all_detectors. Apply-time PROOF below (carry → 0 dropped; the
-- resolver-only helper restored in a rolled-back sub-transaction → ≥ 500 dropped). Offline barrier:
-- scripts/verify-source-district-never-dropped.ts pins this file's shape with mutants.

-- 1) The owner-decided scope. Extending it to another platform is one array edit (after the per-platform report).
create or replace function public.source_district_carry_platforms()
returns text[]
language sql immutable
as $$ select array['dealapp', 'abralosol'] $$;

-- 2) The recovered district: catalog (canonical spelling) first; otherwise the source's own word, as written.
create or replace function public.district_recovery_value(p_platform text, p_city_id integer, p_neighborhood text)
returns text
language sql stable
as $$
  select coalesce(
    public.resolve_district_ar(p_city_id, p_neighborhood),
    case when p_platform = any (public.source_district_carry_platforms())
          and p_neighborhood ~ '[ء-ي]'   -- only the source's Arabic word; an English field goes through the bridge or stays NULL
          and public.norm_district_tok(p_neighborhood) not in
              ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))
         then btrim(p_neighborhood)
    end)
$$;

-- 3) One table at a time (the proof and the repair call this for the carry tables; the hourly job calls it for all).
--    v1.city_id is no longer required: resolve_district_ar() answers NULL without a city, and the source word still stands.
create or replace function public.refresh_district_recovery_table(p_table text)
returns bigint
language plpgsql
as $function$
declare m bigint; n bigint := 0;
begin
  delete from public.district_recovery where source_table = p_table;
  execute format($f$
    insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
    select %1$L, v1.listing_id, d.val, now(),
           public.norm_district_tok(d.val) = public.norm_district_tok(x.neighborhood)
    from public.listing_native_location_v1 v1
    join (select distinct on (id) id, neighborhood from public.%2$I order by id, neighborhood) x
      on x.id = v1.listing_id
    cross join lateral (select public.district_recovery_value(v1.platform, v1.city_id, x.neighborhood) as val) d
    where v1.source_table = %1$L
      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and d.val is not null
      and not exists (
            select 1 from public.listing_source_district_ar sd
            where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)
    on conflict (source_table, listing_id)
      do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                    verbatim = excluded.verbatim
  $f$, p_table, p_table);
  get diagnostics m = row_count;
  n := n + m;

  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
  select v1.source_table, v1.listing_id, d.val, now(),
         public.norm_district_tok(d.val) = public.norm_district_tok(sd.source_district_ar)
  from public.listing_native_location_v1 v1
  join public.listing_source_district_ar sd
    on sd.source_table = v1.source_table and sd.listing_id = v1.listing_id
  cross join lateral (select public.district_recovery_value(v1.platform, v1.city_id, sd.source_district_ar) as val) d
  where v1.source_table = p_table
    and (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
  on conflict (source_table, listing_id)
    do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                  verbatim = excluded.verbatim;
  get diagnostics m = row_count;
  return n + m;
end $function$;

create or replace function public.refresh_district_recovery()
returns bigint
language plpgsql
as $function$
declare r record; n bigint := 0; m bigint;
begin
  truncate public.district_recovery;

  for r in
    select c.table_name as t
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    n := n + public.refresh_district_recovery_table(r.t);
  end loop;

  -- source-district rows for tables that have no neighborhood column (the loop above did not visit them)
  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
  select v1.source_table, v1.listing_id, d.val, now(),
         public.norm_district_tok(d.val) = public.norm_district_tok(sd.source_district_ar)
  from public.listing_native_location_v1 v1
  join public.listing_source_district_ar sd
    on sd.source_table = v1.source_table and sd.listing_id = v1.listing_id
  cross join lateral (select public.district_recovery_value(v1.platform, v1.city_id, sd.source_district_ar) as val) d
  where (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
  on conflict (source_table, listing_id)
    do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                  verbatim = excluded.verbatim;
  get diagnostics m = row_count;
  n := n + m;

  return n;
end;
$function$;

-- 4) The dealapp city bridge follows the source when the source says otherwise (not only when the index has no city).
create or replace function public.resolve_dealapp_city()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare tbl text; total int := 0; n int;
begin
  foreach tbl in array array['dealapp_residential_listings','dealapp_commercial_listings']
  loop
    execute format($q$
      with gap as (
        select r.id, s.platform, s.deal_ar, r.city as raw_city_en,
               r.additional_info->>'city_ar' as city_ar
        from public.search_listings_ar s
        join public.%1$I r on r.id = s.listing_id
        where s.source_table = %2$L
          and r.additional_info->>'city_ar' is not null
          and btrim(r.additional_info->>'city_ar') <> ''
          and (s.city_id is null
               -- 2026-10-18: a bridge city the source no longer states (ad 539820: source «ساجر», bridge «مكة المكرمة»)
               or not exists (select 1 from public.listings_arabic_locations l
                               where l.index_id = %2$L||':'||r.id::text
                                 and normalize_ar(l.city_ar) = normalize_ar(r.additional_info->>'city_ar')))
      ),
      cand as (
        -- exact normalised name first; the spacing/diacritic-insensitive key only when exact is empty
        select g.*, lc.city_id
        from gap g
        join public.loc_catalog_city lc on lc.city_norm = normalize_ar(g.city_ar)
        union all
        select g.*, lc.city_id
        from gap g
        join public.loc_catalog_city lc
          on replace(regexp_replace(lc.city_norm, '[ًٌٍَُِّْـ]', '', 'g'), ' ', '')
           = replace(regexp_replace(normalize_ar(g.city_ar), '[ًٌٍَُِّْـ]', '', 'g'), ' ', '')
        where not exists (select 1 from public.loc_catalog_city e where e.city_norm = normalize_ar(g.city_ar))
      ),
      resolved as (
        -- one row per listing, ONLY where city_ar maps to exactly ONE catalogued city
        select c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar,
               min(c.city_id) as city_id, count(distinct c.city_id) as n_cat
        from cand c
        group by c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar
        having count(distinct c.city_id) = 1
      ),
      ins as (
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, matched, review_reason)
        select %2$L||':'||x.id::text, x.platform, %2$L, x.id,
               case when x.deal_ar='بيع' then 'buy' else 'rent' end,
               nullif(btrim(x.raw_city_en), ''), cc.city_ar, cr.region_ar, true, 'dealapp_arabic_city_bridge'
        from resolved x
        join public.loc_catalog_city cc on cc.city_id = x.city_id
        join public.loc_catalog_region cr on cr.region_id = cc.region_id
        on conflict (index_id) do update
          set city_ar       = excluded.city_ar,
              region_ar     = excluded.region_ar,
              raw_city_en   = excluded.raw_city_en,
              matched       = true,
              review_reason = 'dealapp_arabic_city_bridge'
          where public.listings_arabic_locations.city_ar is distinct from excluded.city_ar
        returning 1
      )
      select count(*) from ins
    $q$, tbl, tbl) into n;
    total := total + coalesce(n,0);
  end loop;
  return total;
end $function$;

-- 4b) Bridge rows whose city the source never stated: English city NULL, the Arabic city names ≥ 2 catalog cities, and the
--     bridge holds a third name. A city we cannot read is NULL, never a guess (owner). Measured 2026-10-18: 6 rows.
do $clear$
declare tbl text; n int; total int := 0;
begin
  foreach tbl in array array['dealapp_residential_listings','dealapp_commercial_listings'] loop
    execute format($q$
      with bad as (
        select l.index_id, l.city_ar as bridge_city, r.additional_info->>'city_ar' as src_city
        from public.listings_arabic_locations l
        join public.%1$I r on r.id = l.listing_id
        where l.platform = 'dealapp' and l.source_table = %1$L and l.city_ar is not null
          and r.city is null and nullif(btrim(r.additional_info->>'city_ar'), '') is not null
          and normalize_ar(l.city_ar) <> normalize_ar(r.additional_info->>'city_ar')
          and (select count(distinct c.city_id) from public.loc_catalog_city c
                where c.city_norm = normalize_ar(r.additional_info->>'city_ar')) >= 2
      )
      update public.listings_arabic_locations l
         set city_ar = null, region_ar = null, matched = false,
             review_reason = format('dealapp: bridge city «%%s» never stated by the source (source city «%%s» names ≥2 catalog cities) — cleared 2026-10-18', b.bridge_city, b.src_city)
        from bad b where b.index_id = l.index_id $q$, tbl);
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  if total > 25 then raise exception 'dealapp unstated-city clear touched % rows, expected ≤ 25 — stop and look', total; end if;
  raise notice 'dealapp unstated-city bridge rows cleared: %', total;
end $clear$;

-- 4c) Owner decision 2026-10-18: 13 abralosol ads give NO district anywhere (field blank; title ends in «في», carries only
--     a plot number, a plan name «مخطط الرياض» (5249) or a compass direction «شمال المبرز» (6997)). They are CITY-LEVEL matches — district intentionally empty, never to be filled by a guess — recorded with
--     the bridge's existing city-only shape (city_ar set, district_ar NULL, matched = true), keyed by the source's own nid.
insert into public.listings_arabic_locations
  (index_id, platform, source_table, listing_id, purpose, city_ar, region_ar, matched, review_reason)
select 'abralosol_residential_listings:' || r.id, 'abralosol', 'abralosol_residential_listings', r.id,
       case when s.deal_ar = 'بيع' then 'buy' else 'rent' end, s.city_ar, s.region_ar, true,
       'city_only_match: source gives no district (owner 2026-10-18, nid ' || n.nid || ')'
from unnest(array['4784','5023','5341','5342','5956','6009','6033','6606','6893','7085','7676','5249','6997']) as n(nid)
join public.abralosol_residential_listings r on r.listing_url ~ ('/' || n.nid || '$')
join public.search_listings_ar s on s.platform = 'abralosol' and s.listing_id = r.id
where nullif(btrim(r.neighborhood), '') is null and s.city_ar is not null
on conflict (index_id) do update
  set matched = true, review_reason = excluded.review_reason
  where public.listings_arabic_locations.district_ar is null;

-- 5) Measurement: source has a district, index has none — per platform and table, fleet-wide. Flags OUR claim.
--    A row the owner marked city-only (review_reason 'city_only_match…') is a match, not a drop, whatever its field holds.
create or replace function public.source_district_dropped_rows(p_grace interval default interval '0')
returns table (platform text, source_table text, rows_dropped bigint, oldest_last_updated timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name ~ '_(residential|commercial)_listings$'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    return query execute format($q$
      select %L::text, %L::text, count(*)::bigint, min(s.last_updated)
      from public.search_listings_ar s
      join public.%I r on r.id = s.listing_id
      where s.source_table = %L
        and s.district_ar is null
        and nullif(btrim(r.neighborhood), '') is not null
        and public.norm_district_tok(r.neighborhood) not in
            ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))
        and (s.last_updated is null or s.last_updated < now() - $1)
        and not exists (select 1 from public.listings_arabic_locations l
                         where l.source_table = s.source_table and l.listing_id = s.listing_id
                           and l.review_reason like 'city_only_match%%')
      having count(*) > 0 $q$,
      regexp_replace(t, '_(residential|commercial)_listings$', ''), t, t, t) using p_grace;
  end loop;
end $function$;

create or replace function public.mon_detect_source_district_dropped()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; v_fleet jsonb; v_open text; r int := 0;
begin
  select coalesce(sum(d.rows_dropped), 0),
         coalesce(jsonb_agg(jsonb_build_object('platform', d.platform, 'source_table', d.source_table, 'rows', d.rows_dropped)
                            order by d.rows_dropped desc), '[]'::jsonb)
    into v_rows, v_by
    from public.source_district_dropped_rows(interval '3 hours') d
   where d.platform = any (public.source_district_carry_platforms());
  select jsonb_agg(jsonb_build_object('platform', f.platform, 'rows', f.rows) order by f.rows desc) into v_fleet
    from (select d.platform, sum(d.rows_dropped) as rows
            from public.source_district_dropped_rows(interval '3 hours') d
           where not (d.platform = any (public.source_district_carry_platforms()))
           group by d.platform order by 2 desc limit 15) f;
  select severity into v_open from public.alert_event
   where dedup_key = 'source_district_dropped' and resolved_at is null order by created_at desc limit 1;
  if v_rows = 0 then
    if v_open is not null then perform public.mon_resolve('source_district_dropped', 'location_pipeline'); end if;
  elsif v_open is null then
    r := public.mon_raise('P1', 'source_district_dropped', 'location_pipeline', 'source_district_dropped',
      jsonb_build_object('rows', v_rows, 'by_table', v_by, 'fleet_not_carrying_top15', coalesce(v_fleet, '[]'::jsonb),
        'why', 'The source states a district for these live ads and OUR index serves none (older than the 3 h pipeline grace). SOURCE IS TRUTH: district_recovery_value() must carry the source word when the catalog has no match (migration 20261018 district_recovery_carries_the_source_word). Check refresh_district_recovery() ran (cron 45/17) and the sync wrote; never fix by hand-NULLing the source.'));
  end if;
  return r;
end $function$;

-- 6) Roster (an unrostered detector is decoration).
do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_source_district_dropped''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_source_district_dropped'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_source_district_dropped''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- 7) REPAIR of district_recovery for the carry tables + PROOF in both directions. The resolver-only helper is restored in a
--    sub-transaction that is always rolled back (function AND table contents). The index itself changes at the next
--    sync_search_listings_ar() (run right after this apply; job 28 hourly), which the detector then measures.
create or replace function pg_temp.dropped_in_v2(p_table text) returns bigint language plpgsql as $t$
declare n bigint;
begin
  execute format($q$
    select count(*) from public.listing_native_location_v2 v
    join public.%I r on r.id = v.listing_id
    where v.source_table = %L and v.district_ar is null
      -- v2 also serves active rows newer than v1's hourly refresh (its no-v1 arm has no recovery); they are the
      -- hourly pipeline's, not this carry's — the detector gives them a 3 h grace
      and exists (select 1 from public.listing_native_location_v1 v1
                   where v1.source_table = v.source_table and v1.listing_id = v.listing_id)
      and nullif(btrim(r.neighborhood), '') is not null
      and public.norm_district_tok(r.neighborhood) not in
          ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))$q$,
    p_table, p_table) into n;
  return n;
end $t$;

do $proof$
declare t text; n bigint; r bigint; before_total bigint := 0;
begin
  foreach t in array array['dealapp_residential_listings','dealapp_commercial_listings',
                           'abralosol_residential_listings','abralosol_commercial_listings'] loop
    before_total := before_total + pg_temp.dropped_in_v2(t);
  end loop;
  foreach t in array array['dealapp_residential_listings','dealapp_commercial_listings',
                           'abralosol_residential_listings','abralosol_commercial_listings'] loop
    perform public.refresh_district_recovery_table(t);
    n := pg_temp.dropped_in_v2(t);
    if n <> 0 then raise exception 'PROOF: % rows of % still drop their source district after the carry', n, t; end if;
  end loop;
  if before_total < 1000 then raise exception 'PROOF: expected ≥ 1000 dropped rows before the carry, saw % — wrong target?', before_total; end if;

  begin
    execute $m$create or replace function public.district_recovery_value(p_platform text, p_city_id integer, p_neighborhood text)
               returns text language sql stable as $b$ select public.resolve_district_ar(p_city_id, p_neighborhood) $b$$m$;
    perform public.refresh_district_recovery_table('dealapp_residential_listings');
    r := pg_temp.dropped_in_v2('dealapp_residential_listings');
    if r < 500 then raise exception 'PROOF: with the resolver-only helper restored only % dealapp rows dropped, want ≥ 500', r; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  r := pg_temp.dropped_in_v2('dealapp_residential_listings');
  if r <> 0 then raise exception 'PROOF: the revert survived the rollback (% rows)', r; end if;

  r := (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_source_district_dropped');
  if r <> 0 then raise exception 'PROOF: the new detector reads as orphaned'; end if;
  raise notice 'PROOF OK: % rows carried for dealapp+abralosol; resolver-only helper → caught; rostered', before_total;
end $proof$;
