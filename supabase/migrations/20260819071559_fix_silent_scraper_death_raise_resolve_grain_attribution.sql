-- Data Integrity Engineer run #31 (2026-08-19).
--
-- mon_detect_silent_scraper_death carried THREE independent defects. It is a P0 detector; in the
-- 34 days since 2026-07-16 it raised 49 alerts, resolved 45 of them in the SAME microsecond they
-- were created, and DISPATCHED ZERO. It has never once notified anyone.
--
-- A. It could not stay open. The raise window was POSITIONAL ("the last 3 scrape_runs rows are all
--    ok=false or 0-row"); the self-heal window was TEMPORAL ("any ok run with rows in the last 2
--    days"). A platform whose death is younger than 48h satisfies BOTH, so the same function call
--    raised the alert and resolved it in one transaction. The detector was structurally blind for
--    exactly the first 48 hours of a scraper death -- the only window in which a P0 is useful.
--    This is the §23a wound from a third angle: run #24 found detectors that could never go GREEN;
--    this one could never stay RED. Cure: raise and resolve now share ONE predicate, via
--    mon_resolve_stale_keys() on the evaluated path (§23a), so the alert stays open exactly as long
--    as the condition holds and clears exactly when it stops.
--
-- B. It measured the wrong grain. Sharded platforms write many scrape_runs rows per crawl (wasalt
--    102 rows / 53 distinct seconds per 24h; aqar_residential 285). "The last 3 runs" was therefore
--    three arbitrary sibling shard rows from inside ONE crawl, ordered non-deterministically among
--    rows sharing a second. On 2026-08-19 that produced a false P0 for wasalt: its three most recent
--    rows were "FETCHED 0 ROWS -- proxy/network block" guard rows, while the SAME batch two seconds
--    earlier held ok=true rows_seen=96. Cure: ask a grain-independent question instead -- "has any
--    attributable run succeeded within this platform's own cadence?"
--
-- C. It was blind to the two largest platforms. The cohort joined scrape_runs.platform to
--    platform_registry.platform, but aqar writes its runs as aqar_residential / aqar_commercial and
--    dealapp writes dealapp_recover. Neither ever matched, so n_runs >= 2 was never satisfied and
--    NEITHER COULD EVER RAISE. Measured before this migration: aqar read 1478.1h since its last
--    healthy run (i.e. never), dealapp 194.8h; after correct attribution they read 7.0h and 3.9h.
--    Cure: attribute a run row to platform P when s.platform = P or s.platform LIKE P || '\_%'
--    (the ':'-suffixed liveness/cleanup rows stay excluded, as before). Verified non-overlapping:
--    no registered platform name is a '<other>_' prefix of another (aqarmonthly / aqargate /
--    aqarcity / aqaratikom all lack the underscore).
--
-- Defects B and C had been masking each other: the detector fired on a healthy platform, could not
-- fire on the biggest ones, and then destroyed the evidence of both by self-resolving.
--
-- Threshold provenance is now logged with the alert (§23b): a value alone is ambiguous, a value plus
-- how it was derived is not.
--
-- Cohort behaviour measured on live data immediately before applying (all 29 active source
-- platforms now in scope, versus 27 before): exactly ONE raise -- souq24, 50.8h with no healthy run
-- while still attempting every 2.6h (last healthy 2026-08-17 04:23, last attempt 2026-08-19 04:38
-- "killed by SIGINT before end_run() -- the CI job hit its timeout-minutes budget"). Independently
-- corroborated by the open legacy_scraper_freshness:souq24 P2 (49.4h stale) raised by a different
-- mechanism. wasalt correctly does NOT raise (6.5h since healthy against a 96h bar).

create or replace function public.mon_detect_silent_scraper_death()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  live text[] := '{}';
begin
  for rec in
    with ap as (
      select pr.platform, coalesce(pc.expected_hours, 24) as expected_hours
      from public.platform_registry pr
      left join public.platform_cadence pc on pc.platform = pr.platform
      where pr.status = 'active' and pr.kind = 'source'
    ), runs as (
      -- Attribute a run row to its registry platform. A scraper that splits itself into
      -- '<platform>_<something>' runs (aqar_residential, dealapp_recover) must NOT thereby leave
      -- monitoring; ':'-suffixed liveness/cleanup rows are not capture runs and stay excluded.
      select ap.platform, ap.expected_hours, s.ok, s.rows_seen, s.started_at
      from ap
      join public.scrape_runs s
        on (s.platform = ap.platform or s.platform like ap.platform || '\_%')
      where s.platform !~ ':'
        and s.started_at > now() - interval '30 days'
    ), h as (
      select platform, expected_hours,
             max(started_at) filter (where ok and coalesce(rows_seen, 0) > 0) as last_healthy,
             max(started_at) as last_attempt
      from runs
      group by platform, expected_hours
    )
    select platform, expected_hours, last_healthy, last_attempt,
           greatest(expected_hours * 2, 24) as bar_hours
    from h
    where last_attempt > now() - interval '7 days'   -- still being scheduled; a platform that
                                                     -- stopped being scheduled at all is a
                                                     -- different class (registry/cron detectors)
      and (last_healthy is null
           or last_healthy < now() - (greatest(expected_hours * 2, 24) || ' hours')::interval)
  loop
    live := live || ('silent_scraper_death:' || rec.platform);
    n := n + public.mon_raise('P0', 'silent_scraper_death', rec.platform,
      'silent_scraper_death:' || rec.platform,
      jsonb_build_object(
        'why', 'no attributable scrape run has succeeded with rows within this platform''s own cadence, while runs are still being attempted -- capture is dead, not merely slow',
        'last_healthy', rec.last_healthy,
        'last_attempt', rec.last_attempt,
        'hours_since_healthy',
          case when rec.last_healthy is null then null
               else round((extract(epoch from (now() - rec.last_healthy)) / 3600.0)::numeric, 1) end,
        'bar_hours', rec.bar_hours,
        'bar_provenance', 'max(2 x expected_hours=' || rec.expected_hours || ', 24)'));
  end loop;

  -- Resolve on the SAME predicate that raises (§23a). Reached unconditionally: this detector has no
  -- claim-slot early return, so it can never resolve a cohort it did not evaluate.
  perform public.mon_resolve_stale_keys('silent_scraper_death', live);
  return n;
end
$function$;

comment on function public.mon_detect_silent_scraper_death() is
$c$P0: a registered active source platform is still being scheduled but no attributable scrape run
has succeeded with rows within max(2 x its cadence, 24h). Raise and resolve share one predicate --
do NOT reintroduce a separate time-windowed self-heal clause: from 2026-07-16 to 2026-08-19 a
divergent 48h self-heal resolved 45 of 49 raises inside the raising transaction and the detector
dispatched exactly zero alerts in 34 days (run #31). Run attribution deliberately includes
'<platform>_%' run names (aqar_residential, dealapp_recover) -- before run #31 aqar and dealapp
could never raise at all. Measured cost ~150 ms.$c$;

-- ---------------------------------------------------------------------------------------------
-- New barrier for defect C's CLASS: a scraper that renames itself out of monitoring.
--
-- Defect C was invisible because nothing ever asked whether a registered platform's runs could be
-- found at all. This is the §11a lesson in a new shape -- not "a barrier nothing calls", but a
-- barrier whose COHORT can never contain its most important subject. With the attribution fix in
-- place this detector reads 0, and a standing 0 is the healthy reading (§24c): it is a regression
-- guard on the run-naming contract between the scrapers and platform_registry, and must not be
-- tidied away for being quiet.
create or replace function public.mon_detect_unattributable_platform_runs()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  live text[] := '{}';
begin
  for rec in
    select pr.platform,
           (select max(s.started_at) from public.scrape_runs s
             where (s.platform = pr.platform or s.platform like pr.platform || '\_%')
               and s.platform !~ ':') as last_any_attributable
    from public.platform_registry pr
    where pr.status = 'active' and pr.kind = 'source'
      and not exists (
        select 1 from public.scrape_runs s
        where (s.platform = pr.platform or s.platform like pr.platform || '\_%')
          and s.platform !~ ':'
          and s.started_at > now() - interval '7 days')
  loop
    live := live || ('unattributable_platform_runs:' || rec.platform);
    n := n + public.mon_raise('P1', 'unattributable_platform_runs', rec.platform,
      'unattributable_platform_runs:' || rec.platform,
      jsonb_build_object(
        'why', 'this platform is registered active+source but NO scrape_runs row in 7 days can be attributed to it, so every run-log-based detector (silent_scraper_death, dangling_scrape_run, volume_drop) silently excludes it. Either the scraper stopped running entirely, or it writes run rows under a name that does not match platform_registry.',
        'last_any_attributable', rec.last_any_attributable,
        'attribution_rule', 'scrape_runs.platform = <platform> OR LIKE <platform>_%, excluding '':'' rows'));
  end loop;
  perform public.mon_resolve_stale_keys('unattributable_platform_runs', live);
  return n;
end
$function$;

comment on function public.mon_detect_unattributable_platform_runs() is
$c$P1: a registered active source platform whose runs cannot be found in scrape_runs under any
attributable name for 7 days -- it is therefore absent from every run-log-based detector's cohort.
Added run #31 after aqar and dealapp were found structurally unable to raise silent_scraper_death
for their entire history (they log as aqar_residential / aqar_commercial / dealapp_recover). A
STANDING 0 IS THE HEALTHY READING (§24c): this is a regression guard on the run-naming contract, not
a detector expected to fire.$c$;

-- Roster entry in the SAME migration (§11a): a detector nothing calls is decoration, and
-- mon_detect_orphaned_detectors() fires on any detector nothing reaches. Applied by rewriting the
-- roster's own definition rather than restating its 70-entry array, so the migration cannot drift
-- from whatever the roster currently holds.
do $roster$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then
    raise exception 'mon_run_all_detectors() not found';
  end if;

  if position('mon_detect_unattributable_platform_runs' in def) > 0 then
    return;  -- idempotent
  end if;

  if position('''mon_detect_silent_scraper_death'',' in def) = 0 then
    raise exception 'roster anchor ''mon_detect_silent_scraper_death'' not found -- refusing to guess';
  end if;

  def := replace(def,
    '''mon_detect_silent_scraper_death'',',
    '''mon_detect_silent_scraper_death'',' || chr(10) ||
    '    ''mon_detect_unattributable_platform_runs'',');

  execute def;
end
$roster$;
