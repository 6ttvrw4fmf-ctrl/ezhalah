-- APPLIED 2026-10-18 (owner session), second step after 20261018081657 (dealapp + abralosol carry, live in the index 08:25 UTC:
-- 16177208 «حي قريه ديراب», 17021430 «حي الجامعة», 8722796 «حي الفرحانية»).
--
-- OWNER 2026-10-18, after seeing the per-platform table (~7,700 dropped source districts over 36 platforms):
--   1. the repair is FLEET-WIDE in the same run — the carry list is retired, every platform carries;
--   2. a NULL district is a BUG until a rendered page proves the site shows none anywhere (haraj carries it in the deed
--      box, نفوذ on the parent project page). A blank source field is RED unless the platform has a proven-silent row.
--
-- WHAT CHANGES
--   • district_recovery_value(platform, city_id, neighborhood, url): catalog (canonical spelling) first; for aqar, whose field is
--     often a plan («حي مخطط الدخل المحدود») while the ad's own address slug names the district («…حي-إشبيلية-مدينة-الجبيل»),
--     the address district is used ONLY when it is an exact catalog district of the ad's city AND the field itself does not
--     resolve (measured on a 15k sample: field and slug both resolve but DISAGREE on 15% of ads — address-first would silently
--     move ~24k aqar districts; owner's call, reported); otherwise the source's own Arabic word, as written. Never a word with a
--     digit: plot/plan codes («33ج», «1029 مخطط رقم») are not districts and the catalog's never-numbered rule refuses them —
--     the first carry leaked «حي 33ج» into the live canonical refresh at 08:27 UTC and its own assertion stopped the refresh.
--     Never an English field («An-Narjis»): that is the English bridge's job (wasalt, its own fix).
--   • refresh_loc_canonical_district(): a live label that would still carry a digit after the number fold is skipped, not
--     asserted on — the assertion stays for catalog rows; the pipeline never again stops on one bad source word.
--   • district_silent_proven: the owner's allowlist (platform, checked_at, checked_by, proof, note). No seed rows: nothing is
--     proven silent today; the auditing agent adds rows as it reads pages.
--   • source_district_dropped_rows(): every production_ready row with district_ar NULL, per platform/table, split into
--     dropped (source field has an Arabic district → the bridge lost it; must be 0), blank (field empty/placeholder),
--     numbered (field is a plot/plan code), english (field needs the bridge), with silent_proven from the allowlist.
--   • mon_detect_source_district_dropped(): P1 'source_district_dropped' when dropped > 0 (3 h pipeline grace);
--     P2 'district_null_unproven' when any platform without a proven-silent row has blank rows; both carry the per-platform
--     table biggest first, for the 🔧 engineer. Rostered by 20261018081657.
--   • PROOF at apply: full refresh_district_recovery(); the top dropped tables read 0 eligible drops in v2 (rows v1 holds);
--     the resolver-only helper restored in a rolled-back sub-transaction re-drops ≥ 300 aqar rows; the canonical refresh runs.

-- 1) The helper: four arguments now (the address slug); the three-argument form and the carry list are retired.
drop function if exists public.district_recovery_value(text, integer, text);
drop function if exists public.source_district_carry_platforms();

create or replace function public.aqar_address_district(p_url text)
returns text
language sql immutable
as $$
  -- last path segment «شارع-…-حي-إشبيلية-مدينة-الجبيل-المنطقة-الشرقية-6769756» → «حي إشبيلية»; the LAST «حي-» before «-مدينة-»
  select nullif(btrim(replace((regexp_match(regexp_replace(coalesce(p_url, ''), '^.*/', ''), '^.*(حي-.+?)-مدينة-'))[1], '-', ' ')), '')
$$;

create or replace function public.district_recovery_value(p_platform text, p_city_id integer, p_neighborhood text, p_url text default null)
returns text
language sql stable
as $$
  select coalesce(
    public.resolve_district_ar(p_city_id, p_neighborhood),
    case when p_platform = 'aqar' then public.resolve_district_ar(p_city_id, public.aqar_address_district(p_url)) end,
    case when p_neighborhood ~ '[ء-ي]'          -- the source's Arabic word; an English field goes through the bridge or stays NULL
          and p_neighborhood !~ '[0-9٠-٩]'      -- a plot/plan code is not a district (catalog rule: never numbered)
          and public.norm_district_tok(p_neighborhood) not in
              ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))
         then btrim(p_neighborhood)
    end)
$$;

-- 2) Per-table recovery passes the ad's URL when the table has one (aqar's address slug).
create or replace function public.refresh_district_recovery_table(p_table text)
returns bigint
language plpgsql
as $function$
declare m bigint; n bigint := 0; has_url boolean;
begin
  select exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'listing_url') into has_url;
  delete from public.district_recovery where source_table = p_table;
  execute format($f$
    insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim)
    select %1$L, v1.listing_id, d.val, now(),
           public.norm_district_tok(d.val) = public.norm_district_tok(x.neighborhood)
    from public.listing_native_location_v1 v1
    join (select distinct on (id) id, neighborhood, %3$s as listing_url from public.%2$I order by id, neighborhood) x
      on x.id = v1.listing_id
    cross join lateral (select public.district_recovery_value(v1.platform, v1.city_id, x.neighborhood, x.listing_url) as val) d
    where v1.source_table = %1$L
      and (v1.district_ar is null or btrim(v1.district_ar) = '')
      and d.val is not null
      and not exists (
            select 1 from public.listing_source_district_ar sd
            where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)
    on conflict (source_table, listing_id)
      do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at,
                    verbatim = excluded.verbatim
  $f$, p_table, p_table, case when has_url then 'listing_url' else 'null::text' end);
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

-- 3) The canonical refresher skips a live label it could never publish instead of stopping the pipeline on it.
do $canon$
declare d text; anchor text := $a$and not public.district_ar_looks_bogus(s.district_ar)$a$; guard text; k int;
begin
  guard := anchor || E'\n      -- 2026-10-18: a live label still carrying a digit after the fold (plot/plan code «33ج») is skipped, never asserted on\n'
        || $g$      and not (s.district_ar ~ '[0-9٠-٩]' and s.district_ar !~ '^[^0-9٠-٩]+\s[0-9٠-٩]+$')$g$;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refresh_loc_canonical_district';
  if d is null then raise exception 'refresh_loc_canonical_district not found'; end if;
  if position('plot/plan code «33ج»' in d) > 0 then
    raise notice 'canonical guard already present';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'canonical anchor found % times, want 1', k; end if;
    execute replace(d, anchor, guard);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refresh_loc_canonical_district';
  if position('plot/plan code «33ج»' in d) = 0 then raise exception 'canonical guard did not land'; end if;
end
$canon$;

-- 4) The owner's proven-silent allowlist. Empty on purpose.
create table if not exists public.district_silent_proven (
  platform    text primary key,
  checked_at  timestamptz not null default now(),
  checked_by  text not null,
  proof       text not null,   -- what was rendered and where the district would have been (URL / screenshot ref)
  note        text
);
alter table public.district_silent_proven enable row level security;
comment on table public.district_silent_proven is
  'Owner 2026-10-18: a NULL district is a bug until a rendered page proves the site shows none anywhere. One row per platform so proven; read by mon_detect_source_district_dropped().';

-- 5) Measurement: every production_ready row with no district, per platform/table, split by what the source field holds.
drop function if exists public.source_district_dropped_rows(interval);
create or replace function public.source_district_dropped_rows(p_grace interval default interval '0')
returns table (platform text, source_table text, null_rows bigint, dropped bigint, blank bigint, numbered bigint,
               english bigint, silent_proven boolean)
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
      with r as (
        select nullif(btrim(r.neighborhood), '') as nb, s.last_updated,
               exists (select 1 from public.listings_arabic_locations l
                        where l.source_table = s.source_table and l.listing_id = s.listing_id
                          and l.review_reason like 'city_only_match%%') as city_only
        from public.search_listings_ar s
        join public.%I r on r.id = s.listing_id
        where s.source_table = %L and s.production_ready and s.district_ar is null
      )
      select %L::text, %L::text, count(*)::bigint,
             count(*) filter (where nb ~ '[ء-ي]' and nb !~ '[0-9٠-٩]'
                                and public.norm_district_tok(nb) not in
                                    ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))
                                and not city_only and (last_updated is null or last_updated < now() - $1))::bigint,
             count(*) filter (where not city_only and (nb is null or public.norm_district_tok(nb) in
                                    ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))))::bigint,
             count(*) filter (where nb ~ '[ء-ي]' and nb ~ '[0-9٠-٩]')::bigint,
             count(*) filter (where nb is not null and nb !~ '[ء-ي]')::bigint,
             exists (select 1 from public.district_silent_proven p where p.platform = %L)
      from r
      having count(*) > 0 $q$,
      t, t, regexp_replace(t, '_(residential|commercial)_listings$', ''), t,
      regexp_replace(t, '_(residential|commercial)_listings$', '')) using p_grace;
  end loop;
end $function$;

create or replace function public.mon_detect_source_district_dropped()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_dropped bigint; v_unproven bigint; v_table jsonb; v_open text; r int := 0;
begin
  with t as (
    select d.platform, sum(d.null_rows) null_rows, sum(d.dropped) dropped, sum(d.blank) blank, sum(d.numbered) numbered,
           sum(d.english) english, bool_or(d.silent_proven) silent_proven
    from public.source_district_dropped_rows(interval '3 hours') d group by d.platform
  )
  select coalesce(sum(dropped), 0), coalesce(sum(blank) filter (where not silent_proven), 0),
         coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'null_rows', null_rows, 'dropped', dropped, 'blank', blank,
                    'numbered', numbered, 'english', english, 'silent_proven', silent_proven) order by null_rows desc), '[]'::jsonb)
    into v_dropped, v_unproven, v_table
  from t;

  -- (a) the bridge lost a district the source states: a bug in OUR pipeline, P1
  select severity into v_open from public.alert_event
   where dedup_key = 'source_district_dropped' and resolved_at is null order by created_at desc limit 1;
  if v_dropped = 0 then
    if v_open is not null then perform public.mon_resolve('source_district_dropped', 'location_pipeline'); end if;
  elsif v_open is null then
    r := r + public.mon_raise('P1', 'source_district_dropped', 'location_pipeline', 'source_district_dropped',
      jsonb_build_object('dropped', v_dropped, 'per_platform', v_table, 'for', '🔧',
        'why', 'The source field names an Arabic district for these live ads and OUR index serves none (older than the 3 h pipeline grace). SOURCE IS TRUTH: district_recovery_value() carries the source word when the catalog has no match (20261018081657, 20261018 fleet-wide). Check refresh_district_recovery() ran (cron 45/17) and the sync wrote; never fix by hand-NULLing the source.'));
  end if;

  -- (b) the field is blank and nobody has proven the site silent: red until a rendered page proves it (owner 2026-10-18), P2
  select severity into v_open from public.alert_event
   where dedup_key = 'district_null_unproven' and resolved_at is null order by created_at desc limit 1;
  if v_unproven = 0 then
    if v_open is not null then perform public.mon_resolve('district_null_unproven', 'location_pipeline'); end if;
  elsif v_open is null then
    r := r + public.mon_raise('P2', 'district_null_unproven', 'location_pipeline', 'district_null_unproven',
      jsonb_build_object('blank_unproven', v_unproven, 'per_platform', v_table, 'for', '🔧',
        'why', 'Live ads with no district whose source field is blank. Owner 2026-10-18: a NULL district is a bug until a rendered page proves the site shows none anywhere (haraj: deed box/breadcrumb; نفوذ: parent project page). Fix the scraper, or insert the platform into district_silent_proven (checked_by, proof) once a page proves it.'));
  end if;
  return r;
end $function$;

-- 6) REPAIR fleet-wide + PROOF. Full refresh; the top dropped tables must read 0 eligible drops among rows v1 holds; the
--    resolver-only helper restored in a rolled-back sub-transaction must re-drop ≥ 300 aqar rows; the canonical refresh runs.
create or replace function pg_temp.dropped_in_v2(p_table text) returns bigint language plpgsql as $t$
declare n bigint;
begin
  execute format($q$
    select count(*) from public.listing_native_location_v2 v
    join public.%I r on r.id = v.listing_id
    where v.source_table = %L and v.district_ar is null
      and exists (select 1 from public.listing_native_location_v1 v1
                   where v1.source_table = v.source_table and v1.listing_id = v.listing_id)
      and r.neighborhood ~ '[ء-ي]' and r.neighborhood !~ '[0-9٠-٩]'
      and public.norm_district_tok(r.neighborhood) not in
          ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى'))$q$,
    p_table, p_table) into n;
  return n;
end $t$;

do $proof$
declare t text; n bigint; r bigint; total bigint; before_aqar bigint;
begin
  before_aqar := pg_temp.dropped_in_v2('aqar_residential_listings');
  total := public.refresh_district_recovery();
  if total < 20000 then raise exception 'PROOF: refresh_district_recovery() produced only % rows (expected ≥ 20k)', total; end if;
  foreach t in array array['dealapp_residential_listings','abralosol_residential_listings','aqar_residential_listings',
                           'wasalt_residential_listings','bossbih_residential_listings','alshawaf_residential_listings',
                           'sokok_residential_listings','arkaan_residential_listings','rightcompound_residential_listings',
                           'sadiqeltajer_residential_listings','dealapp_commercial_listings','abralosol_commercial_listings'] loop
    n := pg_temp.dropped_in_v2(t);
    if n <> 0 then raise exception 'PROOF: % rows of % still drop their source district after the fleet-wide carry', n, t; end if;
  end loop;
  if before_aqar < 300 then raise exception 'PROOF: expected ≥ 300 dropped aqar rows before the carry, saw %', before_aqar; end if;

  begin
    execute $m$create or replace function public.district_recovery_value(p_platform text, p_city_id integer, p_neighborhood text, p_url text default null)
               returns text language sql stable as $b$ select public.resolve_district_ar(p_city_id, p_neighborhood) $b$$m$;
    perform public.refresh_district_recovery_table('aqar_residential_listings');
    r := pg_temp.dropped_in_v2('aqar_residential_listings');
    if r < 300 then raise exception 'PROOF: with the resolver-only helper restored only % aqar rows dropped, want ≥ 300', r; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  r := pg_temp.dropped_in_v2('aqar_residential_listings');
  if r <> 0 then raise exception 'PROOF: the revert survived the rollback (% rows)', r; end if;

  r := public.refresh_loc_canonical_district();
  if r < 3000 then raise exception 'PROOF: refresh_loc_canonical_district() produced only % rows', r; end if;
  if not exists (select 1 from public.loc_canonical_district c where c.city_id = 990 and c.district_norm = 'قريه ديراب') then
    raise exception 'PROOF: «قرية ديراب» (المزاحمية) did not reach the canonical list';
  end if;
  r := (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_source_district_dropped');
  if r <> 0 then raise exception 'PROOF: the detector reads as orphaned'; end if;
  raise notice 'PROOF OK: fleet carry (% recovery rows); aqar before=%; resolver-only → caught; canonical refreshed', total, before_aqar;
end $proof$;
