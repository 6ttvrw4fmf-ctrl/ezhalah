-- 🔧 Quality & Repair 2026-10-16 (class of backlog 521: a dedup key nothing ever closes).
-- mon_detect_stale_no_remediation_path() loops over platform_registry rows with status = 'active' and
-- resolves or raises one key per table INSIDE that loop. A platform that leaves the loop — dwelleo went
-- active → dormant on 10-07 — keeps its key open forever: stale_no_remediation_path:dwelleo_residential_listings
-- was raised 10-05, last affirmed 10-07, and still read as an open P1 on 10-16 while its rows are held out
-- of search on purpose. Fix: collect the keys this run raised or could not evaluate and resolve every other
-- key of this kind at the end (mon_resolve_stale_keys). A table whose read FAILED keeps its key open
-- (a failed read is not an empty answer); only a table that was read, or that left the active loop, closes.
create or replace function public.mon_detect_stale_no_remediation_path()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; n int := 0;
  active_n bigint; stale_n bigint; has_path boolean; plat text; k text;
  live_keys text[] := '{}'::text[];
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
    k := 'stale_no_remediation_path:'||rec.tn;
    begin
      execute format(
        'select count(*) filter (where active),
                count(*) filter (where active and last_seen_at < now() - interval ''%s days'')
           from public.%I', stale_days, rec.tn)
        into active_n, stale_n;
    exception when others then
      -- unreadable tonight: say nothing about it, and do NOT let the sweep below close it
      live_keys := live_keys || k;
      continue;
    end;

    if coalesce(active_n,0) < min_active or coalesce(stale_n,0) = 0 then
      perform public.mon_resolve_key('stale_no_remediation_path', k);
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
      perform public.mon_resolve_key('stale_no_remediation_path', k);
      continue;
    end if;

    n := n + public.mon_raise(
      'P1', 'stale_no_remediation_path', plat, k,
      jsonb_build_object(
        'table', rec.tn, 'active', active_n, 'stale_7d', stale_n,
        'frac', round(stale_n::numeric/active_n, 3),
        'note', 'These listings are user-reachable, have not been seen at the source for '
             || stale_days || '+ days, and this platform has NO cleanup/liveness run in the last 30 '
             || 'days - so nothing will ever re-check them. Distinct from stale_active, which also '
             || 'fires when a guard is deliberately holding a path that DOES exist. Fix = build an '
             || 'approved liveness policy + cleanup path for this platform; do NOT time-kill rows.'));
    live_keys := live_keys || k;
  end loop;

  -- A key this run neither raised nor failed to read belongs to a table that left the active loop
  -- (dormant / retired platform) — its rows are not user-reachable, so the condition is gone.
  perform public.mon_resolve_stale_keys('stale_no_remediation_path', live_keys);
  return n;
end $function$;