--
-- "NOBODY IS COMING" — stale user-reachable listings on a platform with NO deactivation path.
--
-- WHY THIS EXISTS (investigation 2026-08-25, owner-reported: dead DealApp ads still open from Ezhalah)
--
-- The lifecycle is deliberately conservative and CORRECT: mark_stale_listings_inactive() is
-- detect-only, because "we have not seen it in N days" can never prove a listing is dead. It says so
-- itself: «reported only — this path never deactivates … Deactivation belongs to aqar/wasalt
-- liveness, prune_unseen, or cleanup.py, all of which re-fetch the source first.»
--
-- The gap is that the delegation target does not exist for most platforms. Measured 2026-08-25 over
-- platforms with >300 user-reachable listings:
--     HAVE a path : aqar(100,126) wasalt(51,710) gathern(29,107) aqarcity(2,074)
--     HAVE NONE   : dealapp(15,008) aqarmonthly(1,720) mustqr(1,190) sanadak(1,152)
--                   eaqartabuk(553) raghdan(385)          -> 19,908 listings nothing will re-check
--
-- mon_detect_stale_active_fraction() already measures stale/active, but ONLY that ratio — so it
-- raises an IDENTICAL P1 for two opposite situations:
--   * wasalt  — stale because a safety guard is deliberately holding hard-delete
--               («ABORT: platform health degraded … freezing hard-delete until resolved»). BENIGN:
--               the system is protecting itself and WILL resume. Its weekly cleanup deleted 2,189
--               rows on 2026-08-23.
--   * dealapp — stale because no cleanup/liveness path was ever built. MALIGNANT: nothing will ever
--               resolve it, at any future time, without a human building the path.
-- Four indistinguishable P1s sat open for 14 days (since 2026-08-11) because the benign reading is
-- the reasonable one. THIS detector is the missing discriminator: it fires only for the second case.
--
-- It deliberately does NOT deactivate anything. Per docs/ops/DATA_INTEGRITY_ENGINEER.md §147, only
-- source-confirmed evidence justifies inactivation *under that platform's approved liveness policy*,
-- and these platforms have no approved policy — which is itself the thing to fix.
create or replace function public.mon_detect_stale_no_remediation_path() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare
  rec record; n int := 0;
  active_n bigint; stale_n bigint; has_path boolean; plat text;
  stale_days    constant int      := 7;
  path_window   constant interval := interval '30 days';
  min_active    constant int      := 100;   -- below this, D1/coverage detectors own the platform
begin
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema='public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status='active' and pr.kind='source'
      and exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name=t.table_name
                    and c.column_name='last_seen_at')
  loop
    plat := rec.platform;
    begin
      execute format(
        'select count(*) filter (where active),
                count(*) filter (where active and last_seen_at < now() - interval ''%s days'')
           from public.%I', stale_days, rec.tn)
        into active_n, stale_n;
    exception when others then continue; end;

    if coalesce(active_n,0) < min_active or coalesce(stale_n,0) = 0 then
      perform public.mon_resolve_key('stale_no_remediation_path', 'stale_no_remediation_path:'||rec.tn);
      continue;
    end if;

    -- Does ANY deactivation path exist for this platform and has it run recently?
    -- Both shapes count: cleanup.py (`cleanup:<plat>`), the table-scoped sweep
    -- (`aqar_cleanup:<table>`), and any platform-scoped liveness run. A path that ran and ABORTED
    -- still proves a path EXISTS — that is the wasalt guard-is-holding case, deliberately treated as
    -- benign here so this detector stays specific to "nothing was ever built".
    has_path := exists (
      select 1 from public.scrape_runs r
      where r.started_at > now() - path_window
        and ( r.platform = 'cleanup:'||plat
           or r.platform like 'aqar\_cleanup:'||plat||'\_%'
           or (r.platform ~* 'liveness' and r.platform ~ ('^'||plat||'([_:]|$)')) ));

    if has_path then
      perform public.mon_resolve_key('stale_no_remediation_path', 'stale_no_remediation_path:'||rec.tn);
      continue;
    end if;

    n := n + public.mon_raise(
      'P1', 'stale_no_remediation_path', plat, 'stale_no_remediation_path:'||rec.tn,
      jsonb_build_object(
        'table', rec.tn, 'active', active_n, 'stale_7d', stale_n,
        'frac', round(stale_n::numeric/active_n, 3),
        'note', 'These listings are user-reachable, have not been seen at the source for '
             || stale_days || '+ days, and this platform has NO cleanup/liveness run in the last 30 '
             || 'days - so nothing will ever re-check them. Distinct from stale_active, which also '
             || 'fires when a guard is deliberately holding a path that DOES exist. Fix = build an '
             || 'approved liveness policy + cleanup path for this platform; do NOT time-kill rows.'));
  end loop;
  return n;
end $function$;

comment on function public.mon_detect_stale_no_remediation_path() is
  'P1 when user-reachable stale listings sit on a platform with no cleanup/liveness path in 30d. The discriminator stale_active lacks: guard-is-holding (benign) vs nobody-is-coming (malignant). Detection only — never deactivates.';
