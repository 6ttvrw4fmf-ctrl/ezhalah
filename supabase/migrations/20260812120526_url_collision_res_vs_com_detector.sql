-- Barrier for a new bug CLASS found by the 2026-08-12 Search & Matching QA run:
-- The SAME source ad URL is persisted as BOTH a production_ready residential row AND a
-- production_ready commercial row on the same platform. Both rows key on distinct
-- (source_table, listing_id), so the search RPC and client — which key on that pair —
-- correctly return the two rows as two independent search cards. The user sees one
-- physical property as two cards, sometimes with disagreeing type_ar (e.g. sadin
-- «عمارة»/res vs «مبنى تجاري»/com for the SAME https://www.sadin.com.sa/property/…).
--
-- CONFIRMED live under `set local role anon` on 2026-08-12: 20 production_ready rows,
-- 10 URL pairs, on dealapp (5, mostly محطة وقود) and sadin (5, mostly عمارة↔مبنى تجاري
-- and أرض سكنية↔أرض تجارية).
--
-- The ROOT CAUSE is at ingestion — a scraper writing the same source ad into both
-- <platform>_residential_listings and <platform>_commercial_listings. Fixing that (and
-- repairing the 20 existing rows to keep the source-truth side) belongs to Data
-- Integrity — an evidence-backed repair requires refetching the source page to learn
-- which side the source actually declares.
--
-- THIS migration adds the BARRIER: a per-platform detector that raises whenever any
-- listing_url appears in both res and com production_ready rows on the same platform,
-- and self-heals per-platform via mon_resolve_key.
--
-- Wired in the SAME migration per AGENTS.md §11a: mon_detect_orphaned_detectors()
-- otherwise raises within seconds. The roster edit reads the live body via
-- pg_get_functiondef and splices the new name in — never a pasted body.

create or replace function public.mon_detect_url_collisions_res_vs_com()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  platform_rec record;
  v_res_table text;
  v_com_table text;
  v_res_exists boolean;
  v_com_exists boolean;
  v_collisions int;
  v_sample jsonb;
  v_row_pairs int;
begin
  for platform_rec in
    select distinct platform
      from public.search_listings_ar
     where platform is not null and production_ready
     order by 1
  loop
    v_res_table := platform_rec.platform || '_residential_listings';
    v_com_table := platform_rec.platform || '_commercial_listings';
    select exists(select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = v_res_table)
      into v_res_exists;
    select exists(select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = v_com_table)
      into v_com_exists;

    if not (v_res_exists and v_com_exists) then continue; end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_res_table
                      and column_name='listing_url')
       or not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_com_table
                      and column_name='listing_url')
    then continue; end if;

    execute format($sql$
      with res as (
        select lower(r.listing_url) u
          from public.%I r
          join public.search_listings_ar sl on sl.platform = %L
             and sl.listing_id::text = r.id::text
             and sl.source_table = %L
             and sl.production_ready
         where r.listing_url is not null and btrim(r.listing_url) <> ''
      ), com as (
        select lower(c.listing_url) u
          from public.%I c
          join public.search_listings_ar sl on sl.platform = %L
             and sl.listing_id::text = c.id::text
             and sl.source_table = %L
             and sl.production_ready
         where c.listing_url is not null and btrim(c.listing_url) <> ''
      ), inter as (
        select u from res intersect select u from com
      )
      select count(*),
             coalesce((select jsonb_agg(u) from (select u from inter order by u limit 5) x),
                      '[]'::jsonb),
             count(*) * 2
        from inter
    $sql$,
      v_res_table, platform_rec.platform, v_res_table,
      v_com_table, platform_rec.platform, v_com_table)
      into v_collisions, v_sample, v_row_pairs;

    if v_collisions > 0 then
      n := n + public.mon_raise(
        'P2', 'url_collision_res_vs_com', platform_rec.platform,
        'url_collision_res_vs_com:' || platform_rec.platform,
        jsonb_build_object(
          'platform', platform_rec.platform,
          'colliding_urls', v_collisions,
          'affected_prod_ready_rows_lower_bound', v_row_pairs,
          'sample_urls', v_sample,
          'why', 'Same source ad URL persisted as BOTH a production_ready residential row and a production_ready commercial row on this platform. The Normal Filter surfaces both rows as independent cards, so the user sees the SAME physical property twice (sometimes with disagreeing type_ar). Root cause is upstream ingestion. Repair belongs to Data Integrity: establish source truth before dropping either side.'
        ));
    else
      perform public.mon_resolve_key('url_collision_res_vs_com',
                                     'url_collision_res_vs_com:' || platform_rec.platform);
    end if;
  end loop;
  return n;
end $function$;

comment on function public.mon_detect_url_collisions_res_vs_com() is
  'Added 2026-08-12 by Search & Matching QA run #2. Guards a bug class discovered in production: same source ad URL persisted as BOTH production_ready residential AND production_ready commercial row on the same platform (dealapp 5, sadin 5 confirmed at introduction). Users see one property twice. Raises P2 per offending platform; self-heals via mon_resolve_key. Data repair belongs to Data Integrity.';

-- ── Roster wiring in the SAME migration (needle-edit off live body) ─────────────
do $$
declare
  v_def text;
  v_before text;
  fn constant text := 'mon_detect_url_collisions_res_vs_com';
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'roster already carries %', fn;
    return;
  end if;
  execute v_def;
end $$;

-- ── Selftests: prove the barrier is reachable AND detects the known collisions ──
do $$
declare
  v_def text;
  v_raised int;
  v_open_dealapp int;
  v_open_sadin int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_url_collisions_res_vs_com' in v_def) = 0 then
    raise exception 'SELFTEST FAILED: detector is not in the roster — it would be orphaned';
  end if;

  v_raised := public.mon_detect_url_collisions_res_vs_com();

  select count(*) into v_open_dealapp from public.alert_event
   where kind = 'url_collision_res_vs_com'
     and dedup_key = 'url_collision_res_vs_com:dealapp'
     and resolved_at is null;
  select count(*) into v_open_sadin from public.alert_event
   where kind = 'url_collision_res_vs_com'
     and dedup_key = 'url_collision_res_vs_com:sadin'
     and resolved_at is null;

  if v_open_dealapp = 0 and v_open_sadin = 0 then
    raise exception 'SELFTEST FAILED: expected at least one of dealapp/sadin to carry an open url_collision_res_vs_com alert — confirmed live at introduction. Barrier is silent about the class it was built to catch.';
  end if;

  raise notice 'SELFTESTS PASSED: roster-wired, executed (raised=%), dealapp open=%, sadin open=%',
    v_raised, v_open_dealapp, v_open_sadin;
end $$;
