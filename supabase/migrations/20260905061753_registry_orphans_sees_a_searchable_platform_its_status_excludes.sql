-- A REGISTRY ROW THAT EXISTS BUT EXCLUDES ITSELF FROM MONITORING WAS A BLIND SPOT BY CONSTRUCTION.
--
-- mon_detect_registry_orphans had exactly two limbs, and a platform could sit between them:
--   limb 1 (registry_orphan_dead)  : status='active' + kind='source', but nothing is running.
--   limb 2 (registry_orphan_label) : a scrape_runs label with NO platform_registry row AT ALL.
-- muktamel has a row, so limb 2's `not exists (... where pr.platform = r.platform)` is false; and
-- its status is 'dormant', so limb 1 never looks at it. Measured 2026-09-05 06:17Z: muktamel had
-- 523 production_ready rows in search_listings_ar, 28 scrape_runs in 7 days (latest 06:00:30Z), and
-- was ABSENT from mon_detect_silent_scraper_death's own cohort (37 platforms, muktamel not among
-- them). If its capture had died, 523 user-searchable listings would have gone stale with no P0.
--
-- This is the SECOND half of a repair that only landed its first half. Migration
-- 20260904151723_muktamel_liveness_policy_paused_is_not_unsearchable established the ruling that
-- "paused" is a CADENCE fact and does not make a platform unsearchable — and corrected
-- ops_liveness_registry accordingly. platform_registry.status was left saying 'dormant', with a note
-- claiming "0 rows ever active" that production had already contradicted.
--
-- Limb 3 states the invariant the other two only imply: IF A PLATFORM PUTS PRODUCTION_READY ROWS IN
-- FRONT OF USERS, ITS REGISTRY ROW MUST BE THE KIND THE PER-PLATFORM DETECTORS ACTUALLY READ
-- (status='active' AND kind='source'). It is derived from production's own searchable set, never
-- from a hand-kept list, so a platform onboarded tomorrow is covered without anyone remembering.
--
-- DETECT-ONLY in this migration, deliberately: it is applied BEFORE the muktamel repair so that it
-- must first RAISE on the live defect. The repair then lands separately and the alert must
-- self-resolve on the same predicate — proving both directions against production rather than
-- asserting the fix from source text.
CREATE OR REPLACE FUNCTION public.mon_detect_registry_orphans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec record;
  n int := 0;
  v_dead_keys text[] := '{}';
  v_label_keys text[] := '{}';
  v_unmon_keys text[] := '{}';
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

  -- LIMB 3: searchable in production, but the registry row excludes it from every per-platform
  -- detector. Driven from search_listings_ar (production's own truth) rather than any curated list.
  for rec in
    select split_part(s.source_table, '_', 1) as platform,
           count(*) as searchable_rows,
           coalesce(max(pr.status), '<no row>') as reg_status,
           coalesce(max(pr.kind), '<no row>')   as reg_kind
    from public.search_listings_ar s
    left join public.platform_registry pr on pr.platform = split_part(s.source_table, '_', 1)
    where s.production_ready
    group by 1
    having bool_and(coalesce(pr.status,'') is distinct from 'active'
                 or coalesce(pr.kind,'')   is distinct from 'source')
  loop
    v_unmon_keys := v_unmon_keys || ('registry_orphan_unmonitored:'||rec.platform);
    n := n + public.mon_raise('P1','registry_orphans', rec.platform,
      'registry_orphan_unmonitored:'||rec.platform,
      jsonb_build_object('platform', rec.platform,
        'searchable_rows', rec.searchable_rows,
        'registry_status', rec.reg_status, 'registry_kind', rec.reg_kind,
        'why','this platform serves production_ready rows to users, but its platform_registry row is not (status=active AND kind=source) — so mon_detect_silent_scraper_death, mon_detect_zero_new_stall, mon_detect_stale_active_fraction and every other per-platform detector skip it entirely. A dead capture here would strand searchable listings with no alert.',
        'fix','correct the registry row (status=active, kind=source) if the platform is genuinely serving users, or stop it serving production_ready rows — never leave it searchable and unwatched'));
  end loop;
  update public.alert_event set resolved_at = now()
  where kind='registry_orphans' and resolved_at is null
    and dedup_key like 'registry_orphan_unmonitored:%'
    and dedup_key <> all(v_unmon_keys);

  return n;
end $function$;
