-- legacy_scraper_freshness stayed RED for ~24h after a platform had demonstrably recovered, and it
-- PAGED a human while doing it. Fixed 2026-08-23 (Data Integrity run #39).
--
-- Applied to production under the deploy lock as version 20260823151946
-- (legacy_freshness_resolves_on_current_health_not_row_age); mirrored here per the drift rule.
--
-- THE DEFECT. Branch (b) of mon_detect_legacy_alert_tables mirrors rows out of the append-only
-- legacy table scraper_freshness_alerts. Its raise clause AND its resolve clause both keyed on the
-- same thing: `f.checked_at > now() - interval '24 hours'` — the AGE OF THE LEGACY OBSERVATION ROW,
-- never on whether the platform is currently fresh. So the alert could only clear when the legacy
-- row aged out, exactly 24h after it was written, no matter what the platform did in between.
--
-- That is §24b in one sentence: a barrier must measure the thing it protects, never a downstream
-- clock. The legacy table has NO `resolved` column (7 columns: id, checked_at, platform,
-- last_scraped_at, hours_stale, expected_hours, severity), so the mirror's documented self-heal —
-- "resolving the legacy row auto-resolves the mirror on the next run" — was structurally impossible
-- for this arm from the day it was written. The 24h age window was only ever a proxy for it.
--
-- MEASURED, not inferred. raghdan on 2026-08-23:
--   04:23:48Z  scheduled run fails, 0 rows (second consecutive day)
--   06:10:00Z  check_scraper_freshness inserts the legacy row (hours_stale 49.8, expected 24)
--   06:29:00Z  this branch raises legacy_scraper_freshness:raghdan (alert 859)
--   06:44:47Z  recovery run starts
--   06:46:31Z  it succeeds: 376 rows seen, 376 upserted; both listing tables refreshed 06:46:2xZ
--   06:50:23Z  the AUTHORITATIVE detector, mon_detect_silent_scraper_death, resolves its own P0
--   06:55:05Z  alert 859 is DISPATCHED — paged 9 minutes after recovery, 5 after the P0 cleared
--   …and it could not clear before 2026-08-24 06:29Z. ~23.4h of false-open, after full recovery.
-- The souq24 precedent is identical and gives the exact figure: legacy arm open 24.0h against the
-- authoritative detector's 0.1h on the SAME incident. jazwtn's was 30.0h.
--
-- THE FIX, and what it deliberately does NOT do. The RAISE is untouched — a fresh legacy row still
-- mirrors, at the same severity, for the same platforms. Only the RESOLVE changes: it now asks
-- whether the platform is stale RIGHT NOW, computed the same way check_scraper_freshness computes
-- it (greatest(max(scraped_at), max(last_seen_at)) across that platform's listing tables) against
-- the SAME >2x expected_hours bar the legacy writer uses to insert. Raise and resolve therefore
-- share one definition of "stale" (§25a) instead of two clauses that disagree.
--
-- This does not weaken the gate: a platform that is genuinely still stale keeps its alert open,
-- because the recomputed condition still holds. It only stops the alert outliving the condition.
--
-- BOTH DIRECTIONS PROVEN on live data at apply time:
--   shipped bar (2 x 24h = 48h), raghdan 8.56h since last seen  -> still_stale FALSE -> resolved on
--     the very next sweep (alert 859 closed at 15:19:54Z, 8.85h open instead of ~24h)
--   mutated bar (1h), same row                                   -> still_stale TRUE  -> would raise
-- so the comparison is live rather than vacuously false.
--
-- Cost is bounded by construction: the recompute runs ONLY for platforms that currently have a
-- fresh legacy row — historically at most 4 platforms ever (jazwtn, awal, raghdan, souq24), today 1.
-- It is not a scan of the registry.

create or replace function public.mon_detect_legacy_alert_tables()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; n int := 0; v_tbl text; v_active bigint; v_synced bigint;
  v_seen timestamptz; v_hours numeric; v_live_keys text[] := '{}';
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
          v_active := 0;
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
    exception when others then null;
    end;
  end if;

  -- (a) unresolved novel_type_alerts → one open alert_event per raw_type  [UNCHANGED]
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
    exception when others then null;
    end;
  end if;

  -- (b) scraper_freshness_alerts mirror. RAISE unchanged; RESOLVE now recomputes current staleness.
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
        -- Recompute freshness from the platform's OWN listing tables, the same metric
        -- check_scraper_freshness uses. A table that does not exist contributes nothing.
        v_seen := null;
        begin
          execute format(
            'select greatest(max(scraped_at), max(last_seen_at)) from public.%I',
            rec.platform || '_residential_listings') into v_seen;
        exception when others then null; end;
        begin
          execute format(
            'select greatest(%L::timestamptz, greatest(max(scraped_at), max(last_seen_at))) from public.%I',
            v_seen, rec.platform || '_commercial_listings') into v_seen;
        exception when others then null; end;

        v_hours := case when v_seen is null then null
                        else extract(epoch from (now() - v_seen)) / 3600.0 end;

        -- STILL STALE only if we can measure it AND it exceeds the same >2x bar the legacy writer
        -- inserts at. Unmeasurable (no tables / no rows) is treated as still-stale: a barrier must
        -- not clear itself on an absent measurement (§23b).
        if v_hours is null or v_hours > 2 * coalesce(rec.expected_hours, 24) then
          v_live_keys := v_live_keys || ('legacy_scraper_freshness:' || rec.platform);
          n := n + public.mon_raise(
            case when rec.severity = 'critical' then 'P1' else 'P2' end,
            'legacy_scraper_freshness', rec.platform,
            'legacy_scraper_freshness:' || rec.platform,
            jsonb_build_object('checked_at', rec.checked_at, 'last_scraped_at', rec.last_scraped_at,
                               'hours_stale', rec.hours_stale, 'expected_hours', rec.expected_hours,
                               'legacy_severity', rec.severity,
                               'recomputed_hours_since_seen', round(coalesce(v_hours, -1), 1),
                               'source', 'scraper_freshness_alerts (legacy table, mirrored)'));
        end if;
        -- else: the legacy row is still inside its 24h window, but the platform has RECOVERED.
        -- Deliberately raise nothing and leave the key out of v_live_keys so the resolve below
        -- clears any standing alert on the next sweep rather than 24h later.
      end loop;

      -- Resolve on the SAME predicate that raises (§25a): anything not in the live key set is,
      -- by that predicate, no longer stale.
      perform public.mon_resolve_stale_keys('legacy_scraper_freshness', v_live_keys);
    exception when others then null;
    end;
  end if;

  return n;
end $function$;

comment on function public.mon_detect_legacy_alert_tables() is
$c$Mirrors two legacy alert tables into alert_event. Branch (b) fixed 2026-08-23 (Data Integrity
run #39).

Branch (b) previously raised AND resolved on `scraper_freshness_alerts.checked_at > now() - 24h` —
the age of the legacy observation row, not the platform's health. scraper_freshness_alerts has no
`resolved` column, so the mirror's documented self-heal was structurally impossible for this arm and
the 24h window was the only proxy available. Consequence: an alert could not clear for ~24h after
full recovery, and it PAGED — raghdan's alert 859 was dispatched 06:55:05Z on 2026-08-23, nine
minutes after the platform recovered (376/376 rows at 06:46:31Z) and five minutes after the
authoritative mon_detect_silent_scraper_death had already resolved its own P0. The souq24 precedent
measures the same gap exactly: legacy arm open 24.0h vs the authoritative detector's 0.1h on one
incident.

The RAISE is unchanged. The RESOLVE now recomputes staleness from the platform's own listing tables
— greatest(max(scraped_at), max(last_seen_at)) against the same >2x expected_hours bar
check_scraper_freshness inserts at — so raise and resolve share ONE definition of stale (§25a,
§24b). An unmeasurable platform is treated as still-stale rather than cleared (§23b).

Cost is bounded: the recompute runs only for platforms with a legacy row inside 24h — at most 4
platforms have ever produced one. This arm remains a non-authoritative MIRROR;
mon_detect_silent_scraper_death (P0, reads scrape_runs directly) is the authority on scraper death.$c$;
