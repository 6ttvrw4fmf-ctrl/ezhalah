-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FIX — two monitoring-spine resolve bugs (follow-on to Batch 0/1 conventions; read
-- 20260713_batch0_detection_spine.sql first — every convention here extends it).
--
--   §1  mon_resolve_key(): a DEDUP-KEY-scoped resolve primitive. Batch 0's mon_resolve()
--       resolves by (kind, platform) — correct for detectors whose dedup key IS per-platform,
--       but WRONG for any detector that raises finer-grained keys.
--
--   §2  D3 raise/resolve asymmetry (observed live 2026-07-16): mon_detect_stale_active_fraction
--       raises per-TABLE (dedup 'stale_active:<table>') but resolved per-PLATFORM via
--       mon_resolve('stale_active', platform). A platform with one bad + one healthy table had
--       its genuine alert re-resolved by the healthy sibling on the very next loop iteration —
--       alert_event shows aqar_residential_listings' P1 churning open→resolved every detector
--       run (raised and resolved at the SAME timestamp, ids 1/3/7/9/18/26/28/30 on 2026-07-16).
--       Fixed by resolving with §1's key-scoped primitive: a table's alert now clears only when
--       THAT table's stale fraction recovers.
--
--   §3  legacy-alert auto-resolve (observed live 2026-07-16): mon_detect_legacy_alert_tables
--       mirrors unresolved novel_type_alerts into alert_event, and its self-heal only fires
--       once the SOURCE row is marked resolved — but nothing ever re-evaluates the source. The
--       'INVARIANT:unsynced_table:toor_residential_listings' alert was still open although toor
--       has 0 active rows and 0 search_listings_ar rows (condition genuinely cleared; toor was
--       retired + archived 2026-07-15). §3 teaches the detector to re-evaluate the ONE
--       machine-checkable invariant class (unsynced_table, exact semantics mirrored from
--       detect_novel_property_types) and, when the condition is FALSE, resolve the mirror AND
--       mark the source row resolved. Genuine unmapped-type alerts (e.g. raw_type 'Compound')
--       are NEVER auto-resolved — mapping a new type is a human decision.
--
-- NEUTRALITY: alert-bookkeeping only. Never modifies a listing, never classifies, never hides
-- a source. NEVER BLOCKS: the new §3 pass is exception-wrapped like every other block in this
-- detector, so a probe error can never take down the orchestrator.
-- ─────────────────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════ §1 · KEY-SCOPED RESOLVE PRIMITIVE ══════════════════════════════
-- Companion to mon_raise()/mon_resolve() (Batch 0). Resolves exactly ONE open alert stream —
-- the (kind, dedup_key) pair — instead of every open alert of that kind on the platform.
-- p_kind is kept (and checked) even though dedup keys are unique per stream today, so a
-- malformed/colliding key from one detector can never resolve another detector's alert.
create or replace function public.mon_resolve_key(p_kind text, p_dedup text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.alert_event set resolved_at = now()
  where kind = p_kind and dedup_key = p_dedup and resolved_at is null;
$$;

revoke all on function public.mon_resolve_key(text, text) from public, anon, authenticated;


-- ═══════════════════════ §2 · D3: RESOLVE PER TABLE, NOT PER PLATFORM ═══════════════════
-- Identical to the live definition except the else-branch: mon_resolve(kind, platform) →
-- mon_resolve_key(kind, 'stale_active:<table>'), matching the dedup key the raise paths use.
create or replace function public.mon_detect_stale_active_fraction()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; n int := 0; warn numeric; crit numeric; frac numeric; active_n bigint; stale_n bigint;
begin
  select value::numeric into warn from public.mon_config where key='stale_active_warn_frac';
  select value::numeric into crit from public.mon_config where key='stale_active_crit_frac';
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema='public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status='active'
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
      -- D3 FIX (2026-07-16): resolve ONLY this table's stream. The old per-platform resolve let a
      -- healthy sibling table (e.g. aqar_commercial) immediately re-resolve aqar_residential's
      -- genuine P1 — the alert churned open→resolved on every run instead of staying visible.
      perform public.mon_resolve_key('stale_active', 'stale_active:'||rec.tn);
    end if;
  end loop;
  return n;
end $function$;


-- ═══════════════════════ §3 · LEGACY MIRROR: RE-EVALUABLE INVARIANTS SELF-RESOLVE ════════
-- Adds pass (a0) in front of the existing (a): for every UNRESOLVED novel_type_alerts row of the
-- 'INVARIANT:unsynced_table:<table>' class, re-check the exact condition that raised it
-- (mirrored from detect_novel_property_types' third loop):
--     RAISED when <table> has active rows with a non-empty property_type
--             AND search_listings_ar has NO row with source_table = <table>.
--     CLEARED when the table is gone, has 0 such active rows, or its rows now reach
--             search_listings_ar (sync no longer lagging).
-- On CLEARED: mark the SOURCE row resolved (novel_type_alerts.resolved = true) and resolve the
-- MIRROR via mon_resolve_key. Plain raw-type rows (unmapped types like 'Compound') and every
-- other INVARIANT class are untouched — those need a human decision.
create or replace function public.mon_detect_legacy_alert_tables()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
            -- EXACT _seen predicate from detect_novel_property_types (active + non-empty type)
            execute format('select count(*) from public.%I where active and property_type is not null and btrim(property_type::text) <> ''''', v_tbl)
              into v_active;
          exception when others then continue; end;  -- probe failed → leave the alert alone
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
      -- self-heal: legacy row resolved → resolve the mirror
      update public.alert_event e set resolved_at = now()
      where e.kind = 'legacy_novel_type' and e.resolved_at is null
        and not exists (select 1 from public.novel_type_alerts a
                        where not a.resolved
                          and e.dedup_key = 'legacy_novel_type:' || a.raw_type);
    exception when others then null;  -- never blocks the orchestrator
    end;
  end if;

  -- (b) scraper_freshness_alerts rows newer than 24h for ACTIVE-registry platforms →
  -- one open alert_event per platform (latest legacy row wins)
  if to_regclass('public.scraper_freshness_alerts') is not null then
    begin
      for rec in
        select distinct on (f.platform)
               f.platform, f.checked_at, f.last_scraped_at, f.hours_stale, f.expected_hours, f.severity
        from public.scraper_freshness_alerts f
        join public.platform_registry pr on pr.platform = f.platform and pr.status = 'active'
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
      -- self-heal: no fresh (<24h) legacy row for an active platform → condition cleared
      update public.alert_event e set resolved_at = now()
      where e.kind = 'legacy_scraper_freshness' and e.resolved_at is null
        and not exists (select 1 from public.scraper_freshness_alerts f
                        join public.platform_registry pr on pr.platform = f.platform and pr.status = 'active'
                        where f.checked_at > now() - interval '24 hours'
                          and e.dedup_key = 'legacy_scraper_freshness:' || f.platform);
    exception when others then null;
    end;
  end if;

  return n;
end $function$;
