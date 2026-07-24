-- Uniform invariant: the (b) block, which mirrors scraper_freshness_alerts for active-source
-- platforms, also filters kind='source'. Built verbatim from the live def; only the two
-- "pr.status='active'" join predicates gain "and pr.kind='source'".
CREATE OR REPLACE FUNCTION public.mon_detect_legacy_alert_tables()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare rec record; n int := 0; v_tbl text; v_active bigint; v_synced bigint;
begin
  -- (a0) self-resolve re-evaluable unsynced_table invariants whose condition has cleared
  if to_regclass('public.novel_type_alerts') is not null then
    begin
      for rec in
        select a.id, a.raw_type,
               substring(a.raw_type from '^INVARIANT:unsynced_table:(.+)$') as tname
        from public.novel_type_alerts a
        where not a.resolved
          and a.raw_type like 'INVARIANT:unsynced\_table:%'
      loop
        v_tbl := rec.tname;
        if v_tbl is null then continue; end if;
        if to_regclass('public.'||v_tbl) is null then
          v_active := 0;   -- table dropped → condition can no longer hold
        else
          begin
            execute format('select count(*) from public.%I where active and property_type is not null and btrim(property_type::text) <> ''''', v_tbl)
              into v_active;
          exception when others then continue; end;
        end if;
        select count(*) into v_synced from public.search_listings_ar l where l.source_table = v_tbl;
        if coalesce(v_active,0) = 0 or v_synced > 0 then
          update public.novel_type_alerts set resolved = true where id = rec.id;
          perform public.mon_resolve_key('legacy_novel_type', 'legacy_novel_type:'||rec.raw_type);
        end if;
      end loop;
    exception when others then null;  -- never blocks the orchestrator
    end;
  end if;

  -- (a) unresolved novel_type_alerts → one open alert_event per raw_type
  if to_regclass('public.novel_type_alerts') is not null then
    begin
      for rec in
        select a.raw_type, a.sample_table, a.n as n_rows, a.detected_at,
               (select pr.platform from public.platform_registry pr
                 where a.sample_table like pr.platform || '\_%' limit 1) as platform
        from public.novel_type_alerts a
        where not a.resolved
      loop
        n := n + public.mon_raise(
          case when rec.raw_type like 'INVARIANT:%' then 'P1' else 'P2' end,
          'legacy_novel_type', rec.platform,
          'legacy_novel_type:' || rec.raw_type,
          jsonb_build_object('raw_type', rec.raw_type, 'sample_table', rec.sample_table,
                             'n', rec.n_rows, 'first_detected_at', rec.detected_at,
                             'source', 'novel_type_alerts (legacy table, mirrored)'));
      end loop;
      update public.alert_event e set resolved_at = now()
      where e.kind = 'legacy_novel_type' and e.resolved_at is null
        and not exists (select 1 from public.novel_type_alerts a
                        where not a.resolved
                          and e.dedup_key = 'legacy_novel_type:' || a.raw_type);
    exception when others then null;  -- never blocks the orchestrator
    end;
  end if;

  -- (b) scraper_freshness_alerts rows newer than 24h for ACTIVE-SOURCE-registry platforms →
  -- one open alert_event per platform (latest legacy row wins)
  if to_regclass('public.scraper_freshness_alerts') is not null then
    begin
      for rec in
        select distinct on (f.platform)
               f.platform, f.checked_at, f.last_scraped_at, f.hours_stale, f.expected_hours, f.severity
        from public.scraper_freshness_alerts f
        join public.platform_registry pr on pr.platform = f.platform and pr.status = 'active' and pr.kind = 'source'
        where f.checked_at > now() - interval '24 hours'
        order by f.platform, f.checked_at desc
      loop
        n := n + public.mon_raise(
          case when rec.severity = 'critical' then 'P1' else 'P2' end,
          'legacy_scraper_freshness', rec.platform,
          'legacy_scraper_freshness:' || rec.platform,
          jsonb_build_object('checked_at', rec.checked_at, 'last_scraped_at', rec.last_scraped_at,
                             'hours_stale', rec.hours_stale, 'expected_hours', rec.expected_hours,
                             'legacy_severity', rec.severity,
                             'source', 'scraper_freshness_alerts (legacy table, mirrored)'));
      end loop;
      update public.alert_event e set resolved_at = now()
      where e.kind = 'legacy_scraper_freshness' and e.resolved_at is null
        and not exists (select 1 from public.scraper_freshness_alerts f
                        join public.platform_registry pr on pr.platform = f.platform and pr.status = 'active' and pr.kind = 'source'
                        where f.checked_at > now() - interval '24 hours'
                          and e.dedup_key = 'legacy_scraper_freshness:' || f.platform);
    exception when others then null;
    end;
  end if;

  return n;
end $function$;
