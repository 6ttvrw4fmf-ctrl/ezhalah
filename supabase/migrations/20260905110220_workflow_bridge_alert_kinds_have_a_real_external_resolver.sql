-- SIX ALERT KINDS READ AS UNRESOLVABLE WHILE A RESOLVER WAS RUNNING FOR ALL OF THEM.
--
-- mon_detect_unresolvable_alert_kinds() is right to raise: it looks for a public function that
-- calls mon_resolve_key/mon_resolve/mon_resolve_stale_keys with the kind as a literal, or an inline
-- alert_event update, or a row in ops_alert_kind_external_resolver. For the *_check_failed family
-- none of those existed, because the resolver is a NODE SCRIPT, not a database function.
--
-- THE RESOLVER, PROVEN IN CODE. scripts/ops/raise-workflow-alert.mjs is invoked by 22 workflows
-- with `if: always()` and `--status ${{ job.status }}`, and buildRpcCall() reads:
--
--     if (status === 'success') return { fn: 'mon_resolve_key', body: {p_kind: kind, p_dedup: dedup} };
--     if (status !== 'failure') return null;
--
-- so a green run clears the SAME dedup key the red run raised. One shared code path, six kinds.
--
-- PROVEN IN PRODUCTION, not just in source (the distinction AGENTS.md insists on — a source-TEXT
-- reading is exactly the barrier shape that passes while a defect is live). Measured 2026-09-05
-- over every workflow_failed:% alert ever raised:
--     journey_live_check_failed   4 raised, 2 ALREADY AUTO-RESOLVED by this path
--     search_live_check_failed    3 raised, 2 ALREADY AUTO-RESOLVED by this path
--     af_live_check_failed        1 raised, 0 resolved - first raised 2026-09-04 and STILL FAILING
--     data_live_check_failed      1 raised, 0 resolved - first raised 2026-09-05 and STILL FAILING
--     seam_check_failed           1 raised, 0 resolved - first raised 2026-09-04 and STILL FAILING
--     ingestion_check_failed      0 raised
-- The three zeros are "has not gone green yet", NOT "has no resolver": they share the one code path
-- above with the two that demonstrably self-heal, and each is still red right now.
--
-- THIS IS NOT SILENCING THE DETECTOR, and the difference matters. Registering a kind here is the
-- remedy the detector's OWN payload prescribes ("If the resolver genuinely lives outside the
-- database, register it in ops_alert_kind_external_resolver with evidence naming the exact workflow
-- or script"), and it is the same mechanism migration_drift has used since 2026-08-21. Nothing is
-- hand-resolved, no threshold moves, and the detector keeps full force: a kind whose bridge is
-- removed, renamed, or never wired still raises, because half 1 re-evaluates every sweep. What the
-- registry removes is only the FALSE positive.
--
-- The open unresolvable_alert_kind:* findings are NOT touched here. Half 2 of the detector clears
-- its own findings once a kind becomes resolvable, reading the same v_resolvable the raise half
-- computes - so the clear must come from the detector re-running, which is the only evidence that
-- the two halves actually agree.

insert into public.ops_alert_kind_external_resolver (kind, resolved_by, evidence) values
  ('journey_live_check_failed', 'scripts/ops/raise-workflow-alert.mjs (via guardian-journeys.yml, journey-sweep.yml and the other journey live checks)',
   'buildRpcCall() calls mon_resolve_key on the same dedup key when --status is success; the step runs with if: always(). Verified in production 2026-09-05: 4 alerts raised on this kind, 2 already auto-resolved by exactly this path.'),
  ('search_live_check_failed', 'scripts/ops/raise-workflow-alert.mjs (via live-search-sweep.yml, count-rpc-parity-live-check.yml and the other search live checks)',
   'Same shared bridge. Verified in production 2026-09-05: 3 alerts raised on this kind, 2 already auto-resolved by exactly this path.'),
  ('af_live_check_failed', 'scripts/ops/raise-workflow-alert.mjs (via af-live-truth-check.yml)',
   'Same shared bridge and the same buildRpcCall success branch as the two kinds above, which are proven to self-heal in production. 1 alert raised 2026-09-04 and still failing, so it has had no green run to clear it yet - absence of a resolution is not absence of a resolver.'),
  ('data_live_check_failed', 'scripts/ops/raise-workflow-alert.mjs (via audit-invariants.yml)',
   'Same shared bridge. 1 alert raised 2026-09-05 and still failing, so no green run has occurred yet.'),
  ('seam_check_failed', 'scripts/ops/raise-workflow-alert.mjs (via frontend-bundle-source-parity-live-check.yml)',
   'Same shared bridge. 1 alert raised 2026-09-04 and still failing, so no green run has occurred yet.'),
  ('ingestion_check_failed', 'scripts/ops/raise-workflow-alert.mjs (via the ingestion live checks)',
   'Same shared bridge, wired in the workflow set but not yet observed raising. Registered with the family so the kind does not read as unresolvable the first time it ever fires.')
on conflict (kind) do nothing;

-- Prove the registration took, and that the detector now agrees. Half 2 clears its own findings for
-- any kind that became resolvable, so a run here must leave zero open unresolvable_alert_kind rows
-- for these six.
do $$
declare v_missing text; v_still_open int;
begin
  select string_agg(k, ', ') into v_missing
    from unnest(array['journey_live_check_failed','search_live_check_failed','af_live_check_failed',
                      'data_live_check_failed','seam_check_failed','ingestion_check_failed']) k
   where not exists (select 1 from public.ops_alert_kind_external_resolver x where x.kind = k);
  if v_missing is not null then
    raise exception 'REFUSING: these kinds did not register: %', v_missing;
  end if;

  perform public.mon_detect_unresolvable_alert_kinds();

  select count(*) into v_still_open from public.alert_event
   where resolved_at is null and kind = 'unresolvable_alert_kind'
     and detail->>'kind' in ('journey_live_check_failed','search_live_check_failed',
                             'af_live_check_failed','data_live_check_failed',
                             'seam_check_failed','ingestion_check_failed');
  if v_still_open <> 0 then
    raise exception 'REFUSING: % unresolvable_alert_kind finding(s) for the bridge kinds are still open after re-running the detector - the registry and the detector disagree', v_still_open;
  end if;
  raise notice 'workflow-bridge kinds registered and the detector cleared its own findings';
end $$;
