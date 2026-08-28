-- Senior Production Engineer, 2026-08-26. Owner-approved investigation (Dealapp, "Option A only").
--
-- WHAT THIS GUARDS. dealapp.sa serves a data-bearing detail page to ordinary networks and a
-- PERMANENTLY listing-less page to GitHub Actions egress, for the SAME ids at the SAME moment:
-- 78-83% of sitemap-published ids shell from a runner vs ~11% off-runner, identical across all
-- five client variants including the system curl binary, flat across all ten deciles, and 0 of 49
-- shells recovered when re-requested at 5s/15s/45s/120s (control 10/10). Full evidence and the
-- Actions run ids: docs/ops/DEALAPP_FETCH_EGRESS_FINDING.md.
--
-- The consequence is the dangerous part: `last_seen_at` for dealapp is ~75% FALSE NEGATIVE. It
-- looks exactly like "this listing is gone at the source" and it is not. Every one of the 14,733
-- active rows carries missing_count = 0 and prune_unseen has reported pruned=0 on every shard on
-- every day for 14 days -- so nothing has acted on the bad signal yet. The ONLY reason is
-- prune_unseen's 0.80 coverage floor (PRUNE_MIN_COVERAGE), which trips nightly because real
-- coverage is ~25%. One environment variable stands between a 75% false-negative signal and the
-- mass deactivation of live listings, and nothing watches it.
--
-- So this detector does not watch the fetch (other detectors already own coverage and staleness).
-- It watches the ONE thing that must never happen while the fetch is unreliable: a dealapp
-- listing actually being deactivated. If the coverage floor is ever lowered, removed, bypassed,
-- or simply outrun by a run that scrapes enough to clear 0.80 while still shelling most ids, this
-- fires on the FIRST deactivated row rather than after thousands.
--
-- Deliberately NOT a fix. The fix is to change the egress dealapp is fetched from, which is an
-- owner provider/compliance decision (docs/ops/AGENT_AUTHORITY.md RED list) and is explicitly not
-- to be folded into the separate, frozen Wasalt proxy question.
--
-- Self-clearing via mon_resolve_key on its own dedup key, so it cannot ratchet
-- (mon_detect_unresolvable_alert_kinds stays green for this kind).
--
-- ---------------------------------------------------------------------------------------------
-- RECOVERED INTO GIT 2026-08-28 by the Data Integrity routine. This migration was applied to
-- production on 2026-08-26 via MCP apply_migration but never committed, which is what kept the
-- P1 `migration_drift` alert (raised 2026-08-26 19:19) standing with missing_in_git_count=1.
-- The SQL below is recovered verbatim from supabase_migrations.schema_migrations.statements for
-- version 20260826185215; nothing here was re-derived or re-authored. Per AGENTS.md the session
-- that applies a migration owns mirroring it in the same change -- this is a late repair of that,
-- not a new change, and it is not re-applied (the objects are already live).
-- ---------------------------------------------------------------------------------------------

create or replace function public.mon_detect_dealapp_deactivation_on_unreliable_fetch()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Above this share of attempted fetches failing, the "not seen at source" signal is not
  -- trustworthy enough for ANY removal decision. Measured rate is ~0.75; 0.30 leaves wide room
  -- for a genuinely-recovered fetch to stop arming this without needing a code change.
  c_shell_rate_floor numeric := 0.30;
  c_window           interval := interval '26 hours';   -- one daily cycle plus slack

  v_attempted bigint; v_failed bigint; v_rate numeric;
  v_deact bigint; v_sample jsonb;
  n int := 0;
begin
  select coalesce(sum((substring(notes from 'attempted=([0-9]+)'))::bigint), 0),
         coalesce(sum((substring(notes from 'fetch_fail_total=([0-9]+)'))::bigint), 0)
    into v_attempted, v_failed
    from public.scrape_runs
   where platform like 'dealapp%'
     and started_at > now() - c_window;

  -- No dealapp run in the window at all: mon_detect_silent_scraper_death and the coverage
  -- detectors own that case. Saying nothing here is correct -- but do not leave a stale alert lit.
  if v_attempted = 0 then
    perform public.mon_resolve_key('dealapp_unsafe_deactivation',
                                   'dealapp_deactivation_on_unreliable_fetch');
    return 0;
  end if;

  v_rate := round(v_failed::numeric / v_attempted, 4);

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'ad_number', ad_number, 'deactivated_at', deactivated_at,
           'missing_count', missing_count, 'last_seen_at', last_seen_at) order by deactivated_at desc), '[]'::jsonb)
    into v_deact, v_sample
    from (
      select ad_number, deactivated_at, missing_count, last_seen_at
        from public.dealapp_residential_listings
       where deactivated_at > now() - interval '24 hours'
      union all
      select ad_number, deactivated_at, missing_count, last_seen_at
        from public.dealapp_commercial_listings
       where deactivated_at > now() - interval '24 hours'
       limit 20) d;

  if v_rate > c_shell_rate_floor and v_deact > 0 then
    n := n + public.mon_raise('P1', 'dealapp_unsafe_deactivation', 'dealapp',
      'dealapp_deactivation_on_unreliable_fetch',
      jsonb_build_object(
        'deactivated_last_24h', v_deact,
        'fetch_fail_rate', v_rate,
        'attempted', v_attempted,
        'failed', v_failed,
        'threshold', c_shell_rate_floor,
        'sample', v_sample,
        'why', 'dealapp listings were DEACTIVATED while the dealapp fetch is known-unreliable. '
               'Measured 2026-08-26: dealapp serves a permanently listing-less page to GitHub '
               'Actions egress for 78-83% of its own sitemap ids, while an ordinary network gets '
               'the full schema for ~89% of the same ids at the same moment. So "not seen at '
               'source" is ~75% FALSE NEGATIVE and is NOT evidence a listing is gone.',
        'action', 'Do NOT confirm these removals from last_seen_at, age, or a shell response. '
               'Re-fetch each ad_number from an ordinary network and keep only the ones that '
               'genuinely carry no real-estate-listing key. Then find what deactivated them: the '
               'expected guard is prune_unseen''s 0.80 coverage floor (PRUNE_MIN_COVERAGE), which '
               'should trip nightly at ~25% real coverage. If it was lowered or bypassed, restore '
               'it before reactivating.',
        'evidence', 'docs/ops/DEALAPP_FETCH_EGRESS_FINDING.md'));
  else
    perform public.mon_resolve_key('dealapp_unsafe_deactivation',
                                   'dealapp_deactivation_on_unreliable_fetch');
  end if;

  return n;
end $function$;

-- ROSTER, in the SAME migration (AGENTS.md: a detector outside the roster is decoration, and
-- mon_detect_orphaned_detectors fires on any detector nothing reaches). Needle-edit the LIVE
-- definition rather than restating it, so a concurrent session's roster additions are preserved
-- instead of being clobbered by a stale create-or-replace -- the exact way
-- mon_detect_unverified_inactivation went dark 8h after it was wired.
do $mig$
declare
  v_def    text;
  v_anchor text := E'    ''mon_detect_enumeration_incomplete'',\n';
  v_new    text := E'    ''mon_detect_dealapp_deactivation_on_unreliable_fetch'',\n';
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'mon_run_all_detectors';
  if v_def is null then
    raise exception 'mon_run_all_detectors not found -- refusing to guess at the roster';
  end if;

  -- Idempotent: re-running this migration must not add a second entry.
  if position('mon_detect_dealapp_deactivation_on_unreliable_fetch' in v_def) > 0 then
    raise notice 'roster already carries the detector -- nothing to do';
    return;
  end if;

  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'roster anchor matched % times, expected exactly 1 -- refusing to edit blindly',
      (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  end if;

  execute replace(v_def, v_anchor, v_anchor || v_new);

  -- Prove the edit took, in the same transaction, or roll the whole thing back.
  select pg_get_functiondef(oid) into v_def
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'mon_run_all_detectors';
  if position('mon_detect_dealapp_deactivation_on_unreliable_fetch' in v_def) = 0 then
    raise exception 'roster edit did not take -- refusing to leave an unreachable detector';
  end if;
end $mig$;
