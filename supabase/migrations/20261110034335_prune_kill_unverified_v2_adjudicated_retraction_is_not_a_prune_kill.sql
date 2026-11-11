-- prune_kill_unverified v2 — AN ADJUDICATED RETRACTION IS NOT A PRUNE KILL
-- (lane: alarms dead-ads-served, 2026-11-10; alert_event 13864 + 13865, aqarcity).
--
-- WHAT WAS MEASURED. Both alerts counted the same four rows (AC29100, AC29102, AC31546, AC31547).
-- prune_unseen() never touched them: missing_count was 2 of 3. They were hidden in one transaction
-- at 2026-11-08 11:14:50 by a lifecycle retraction that read each ad's own page GONE with two
-- readers and wrote one ops_adjudicated_retraction row per listing in the same transaction. The
-- detector looks only in ops_stale_inactivation_probe, where prune_unseen writes, so it read a
-- recorded decision as an absence kill, and its own remedy («RESTORE any that are live») points at
-- rows mon_detect_adjudicated_reactivation() exists to keep hidden.
--
-- THE RULE. Same discriminator as 20260913144532: an AFFIRMATIVE record, never an inference. A
-- row is set aside only when ops_adjudicated_retraction names THIS table and THIS id within one
-- hour of the deactivation. Nothing is hidden: deactivated_48h still counts every row and the
-- rows set aside are reported as adjudicated_retraction. A deactivation with neither a GONE
-- verdict nor such a record raises exactly as before.

create or replace function public.mon_detect_prune_kill_without_source_verdict()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; n int := 0; live_keys text[] := '{}'; bad int; adj int; tot int;
begin
  for r in select source_table from public.ops_oracle_required_platform loop
    -- Rows deactivated in the last 48h with NO recorded GONE verdict at/after the deactivation
    -- and NO adjudicated retraction recorded with it (v2).
    execute format($q$
      select
        count(*) filter (where not x.has_gone and not x.is_adjudicated),
        count(*) filter (where x.is_adjudicated and not x.has_gone),
        count(*)
      from (
        select
          exists (
            select 1 from public.ops_stale_inactivation_probe p
             where p.source_table = %1$L and p.ad_number = t.ad_number
               and p.verdict = 'GONE' and p.probed_at >= t.deactivated_at - interval '1 hour') as has_gone,
          exists (
            select 1 from public.ops_adjudicated_retraction a
             where a.source_table = %1$L and a.listing_id = t.id
               and a.retracted_at >= t.deactivated_at - interval '1 hour'
               and a.retracted_at <= t.deactivated_at + interval '1 hour') as is_adjudicated
        from public.%1$I t
        where t.active = false and t.deactivated_at >= now() - interval '48 hours'
      ) x
    $q$, r.source_table) into bad, adj, tot;

    if bad > 0 then
      live_keys := live_keys || ('prune_kill_unverified:' || r.source_table);
      n := n + public.mon_raise(
        'P1', 'prune_kill_unverified',
        regexp_replace(r.source_table, '_(residential|commercial)_listings$', ''),
        'prune_kill_unverified:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'deactivated_48h', tot,
          'without_gone_verdict', bad,
          'adjudicated_retraction', adj,
          'why', 'This platform''s discovery index does NOT enumerate its full live catalogue '
              || '(see ops_oracle_required_platform.reason), so absence from the crawl is not '
              || 'evidence of death. On 2026-08-24, 261 of 261 rows deactivated this way were '
              || 'still served by their source. A deactivation here is only legitimate when '
              || 'prune_unseen''s verify_gone oracle recorded a GONE verdict for that ad_number.',
          'adjudicate', 'Do NOT resolve this by widening the crawl or relaxing the grace count. '
              || 'Either the verify_gone wiring was dropped from the scraper (check '
              || 'scrapers/<platform>/run.py passes verify_gone=, pinned by '
              || 'scrapers/common/tests/test_prune_requires_source_verdict_to_kill.py), or the '
              || 'oracle stopped writing evidence. Re-probe the affected rows and RESTORE any that '
              || 'are live (DATA_INTEGRITY_ENGINEER.md §15). Rows counted in adjudicated_retraction '
              || 'are NOT part of this alert: each has its own ops_adjudicated_retraction record '
              || 'written with the deactivation; do not restore those.'));
    end if;
  end loop;

  -- Resolve on the EVALUATED path only, from the cohort that raises (§23a/§25a: one predicate for
  -- both directions — never a second, independently-worded self-heal clause).
  perform public.mon_resolve_stale_keys('prune_kill_unverified', live_keys);
  return n;
end
$function$;

-- Re-evaluate now.
select public.mon_detect_prune_kill_without_source_verdict();
