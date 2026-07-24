-- Route every source-gated read of platform_registry through kind='source'.
-- Built from the live pg_get_functiondef of each function; the ONLY change is adding
-- "and pr.kind='source'" to the active-source predicate. Internal arms (enrich/recover/
-- sub-sweep) are thereby excluded from all source-oriented detectors. The parent sources
-- (aqar/wasalt/dealapp) remain fully covered via freshness (platform_cadence), zero_new_stall
-- (crawl_stats), and stale_active_fraction (their real *_listings tables).

CREATE OR REPLACE FUNCTION public.mon_detect_silent_scraper_death()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare rec record; n int := 0;
begin
  for rec in
    with runs as (
      select platform, ok, coalesce(rows_seen,0) rows_seen, started_at,
             row_number() over (partition by platform order by started_at desc) rn
      from public.scrape_runs
      where started_at > now() - interval '6 days' and platform !~ ':'
    ), last3 as (
      select r.platform, count(*) n_runs,
             count(*) filter (where r.ok and r.rows_seen>0) n_healthy,
             max(r.started_at) last_run
      from runs r join public.platform_registry pr on pr.platform=r.platform and pr.status='active' and pr.kind='source'
      where r.rn <= 3
      group by r.platform
    )
    select platform, n_runs, last_run from last3
    where n_runs >= 2 and n_healthy = 0     -- every recent run empty/failed
  loop
    n := n + public.mon_raise('P0','silent_scraper_death', rec.platform,
      'silent_scraper_death:'||rec.platform,
      jsonb_build_object('recent_runs', rec.n_runs, 'last_run', rec.last_run,
        'why','last '||rec.n_runs||' runs all ok=false or 0-row (fail-blind finalize)'));
  end loop;
  -- self-heal: platforms with a healthy recent run
  update public.alert_event a set resolved_at=now()
  where a.kind='silent_scraper_death' and a.resolved_at is null
    and exists (select 1 from public.scrape_runs s where s.platform=a.platform and s.ok and coalesce(s.rows_seen,0)>0 and s.started_at>now()-interval '2 days');
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.mon_detect_zero_new_stall()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare rec record; n int := 0;
begin
  for rec in
    select d.platform,
           sum(d.new_listings) filter (where d.day >  current_date - 4) new_recent,
           sum(d.new_listings) filter (where d.day between current_date - 18 and current_date - 4) new_prior
    from public.crawl_stats_platform_daily d
    join public.platform_registry pr on pr.platform=d.platform and pr.status='active' and pr.kind='source'
    group by d.platform
  loop
    if coalesce(rec.new_prior,0) >= 10 and coalesce(rec.new_recent,0) = 0 then
      n := n + public.mon_raise('P1','zero_new_stall', rec.platform,
        'zero_new_stall:'||rec.platform,
        jsonb_build_object('new_prior_14d', rec.new_prior, 'new_recent_4d', 0,
          'why','produced new listings before but 0 in the last 4 days — discovery stalled'));
    elsif coalesce(rec.new_recent,0) > 0 then
      perform public.mon_resolve('zero_new_stall', rec.platform);
    end if;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.mon_detect_stale_active_fraction()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare rec record; n int := 0; warn numeric; crit numeric; frac numeric; active_n bigint; stale_n bigint;
begin
  select value::numeric into warn from public.mon_config where key='stale_active_warn_frac';
  select value::numeric into crit from public.mon_config where key='stale_active_crit_frac';
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema='public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status='active' and pr.kind='source'
      and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name='last_seen_at')
  loop
    begin
      execute format('select count(*) filter (where active), count(*) filter (where active and last_seen_at < now()-interval ''7 days'') from public.%I', rec.tn)
        into active_n, stale_n;
    exception when others then continue; end;
    if coalesce(active_n,0) < 20 then continue; end if;   -- tiny tables handled by D1/coverage, not fraction
    frac := stale_n::numeric / active_n;
    if frac >= crit then
      n := n + public.mon_raise('P1','stale_active', rec.platform, 'stale_active:'||rec.tn,
        jsonb_build_object('table',rec.tn,'active',active_n,'stale_7d',stale_n,'frac',round(frac,3),'level','critical'));
    elsif frac >= warn then
      n := n + public.mon_raise('P2','stale_active', rec.platform, 'stale_active:'||rec.tn,
        jsonb_build_object('table',rec.tn,'active',active_n,'stale_7d',stale_n,'frac',round(frac,3),'level','warning'));
    else
      perform public.mon_resolve_key('stale_active', 'stale_active:'||rec.tn);
    end if;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.mon_detect_registry_orphans()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  rec record;
  n int := 0;
  v_dead_keys text[] := '{}';
  v_label_keys text[] := '{}';
begin
  for rec in
    select pr.platform, coalesce(pr.window_days, 14) as wd
    from public.platform_registry pr
    where pr.status = 'active' and pr.kind = 'source'
      and not exists (select 1 from public.scrape_runs r
                      where r.platform = pr.platform
                        and r.started_at > now() - make_interval(days => coalesce(pr.window_days, 14)))
      and not exists (select 1 from information_schema.tables t
                      where t.table_schema = 'public'
                        and t.table_name like pr.platform||'\_%\_listings')
  loop
    v_dead_keys := v_dead_keys || ('registry_orphan_dead:'||rec.platform);
    n := n + public.mon_raise('P2','registry_orphans', rec.platform,
      'registry_orphan_dead:'||rec.platform,
      jsonb_build_object('platform', rec.platform, 'window_days', rec.wd,
        'why','active platform_registry row with zero scrape_runs in its window and no <platform>_%_listings table — dead registry entry (retire it or fix the scraper identity)'));
  end loop;
  update public.alert_event set resolved_at = now()
  where kind='registry_orphans' and resolved_at is null
    and dedup_key like 'registry_orphan_dead:%'
    and dedup_key <> all(v_dead_keys);

  for rec in
    select r.platform as label, count(*) as runs, max(r.started_at) as last_run
    from public.scrape_runs r
    where r.started_at > now() - interval '14 days'
      and position(':' in r.platform) = 0
      and not exists (select 1 from public.platform_registry pr where pr.platform = r.platform)
    group by r.platform
  loop
    v_label_keys := v_label_keys || ('registry_orphan_label:'||rec.label);
    n := n + public.mon_raise('P2','registry_orphans', rec.label,
      'registry_orphan_label:'||rec.label,
      jsonb_build_object('label', rec.label, 'runs_14d', rec.runs, 'last_run', rec.last_run,
        'why','scrape_runs label absent from platform_registry — an unregistered scraper is invisible to every per-platform detector (register it or fix its label)'));
  end loop;
  update public.alert_event set resolved_at = now()
  where kind='registry_orphans' and resolved_at is null
    and dedup_key like 'registry_orphan_label:%'
    and dedup_key <> all(v_label_keys);

  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.mon_detect_field_integrity()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  rec record;
  n int := 0;
  ph constant text[] := array['other','unknown','n/a','none','null','undefined','',
                              'غير محدد','اخرى','أخرى'];
  unit_types constant text[] := array['Building','Hotel','Office','Commercial Building'];
  loc_ph bigint; beds_odd bigint; rent_active bigint; rent_tiny bigint; zero_price bigint;
begin
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema = 'public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status = 'active' and pr.kind = 'source'
  loop
    begin
      execute format($f$
        select
          count(*) filter (where active and ((city   is not null and lower(trim(city))   = any(%L::text[]))
                                          or (region is not null and lower(trim(region)) = any(%L::text[])))),
          count(*) filter (where active and (bedrooms > 1000
                                          or (bedrooms > 50 and coalesce(property_type,'') <> all(%L::text[])))),
          count(*) filter (where active and transaction_type = 'Rent'),
          count(*) filter (where active and transaction_type = 'Rent' and price_annual < 500),
          count(*) filter (where active and (price_total = 0 or price_annual = 0))
        from public.%I
      $f$, ph, ph, unit_types, rec.tn)
      into loc_ph, beds_odd, rent_active, rent_tiny, zero_price;
    exception when others then continue;  -- shape mismatch → skip table, never block
    end;

    if loc_ph > 0 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_placeholder_loc:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'active_placeholder_location_rows', loc_ph,
          'why','placeholder city/region literal on active rows — pre-guard legacy or a new guard bypass'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_placeholder_loc:'||rec.tn;
    end if;

    if beds_odd > 0 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_bedrooms:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'suspect_bedroom_rows', beds_odd,
          'why','bedrooms>1000, or >50 outside unit-count types (Building/Hotel/Office/Commercial Building) — parse-artifact repair candidates'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_bedrooms:'||rec.tn;
    end if;

    if rent_active >= 20 and rent_tiny::numeric / nullif(rent_active, 0) > 0.20 then
      n := n + public.mon_raise('P1','field_integrity', rec.platform,
        'field_integrity_tiny_rent:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'tiny_rent_rows', rent_tiny, 'active_rent', rent_active,
          'frac', round(rent_tiny::numeric / rent_active, 3),
          'why','>=20% of active Rent under 500 SAR — monthly-as-annual-shaped regression'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_tiny_rent:'||rec.tn;
    end if;

    if zero_price > 20 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_zero_price:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'zero_price_active_rows', zero_price,
          'why','active zero-price rows grew past 20 (faithful-placeholder baseline is 7, all aqar_res) — check for a new ingestion bug'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_zero_price:'||rec.tn;
    end if;
  end loop;
  return n;
end $function$;
