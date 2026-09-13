-- THE NEW BRIDGE KIND FOR ROUTINE #10 MUST NOT READ AS UNRESOLVABLE THE FIRST TIME IT FIRES.
--
-- .github/workflows/incident-citation-guard.yml (routine #10, ops_incident #209, 2026-09-13) is a
-- scheduled live guard, so it bridges its own result to alert_event — an unattended workflow that
-- fails silently notifies nobody, which is the dark-detector shape this repo has been burned by.
-- Its kind is `barrier_check_failed`, which routes to routine #10 through the `^barrier_` pattern
-- already in scripts/lib/alertRouting.ts.
--
-- mon_detect_unresolvable_alert_kinds() looks for a public function calling mon_resolve_key/
-- mon_resolve/mon_resolve_stale_keys with the kind as a literal, an inline alert_event update, or a
-- row here. For the *_check_failed family none of the first three exist, because the resolver is a
-- NODE SCRIPT: scripts/ops/raise-workflow-alert.mjs, whose buildRpcCall() reads
--
--     if (status === 'success') return { fn: 'mon_resolve_key', body: {p_kind: kind, p_dedup: dedup} };
--
-- so a green run clears the SAME dedup key the red run raised. The citation guard invokes that
-- bridge with `if: always()` and `--status ${{ job.status }}`, exactly as the six kinds registered
-- by migration 20260905110220 do — ONE shared code path, now seven kinds.
--
-- EVIDENCE, STATED HONESTLY. This kind has NEVER FIRED: the workflow ships today. So there is no
-- production self-heal to point at for `barrier_check_failed` itself, and this registration does not
-- claim one. What is production-proven is the code path it shares: on 2026-09-05, of the kinds using
-- this identical bridge, journey_live_check_failed had 4 raised / 2 already auto-resolved and
-- search_live_check_failed 3 raised / 2 already auto-resolved, by exactly this branch. Registering
-- with the family is what stops a brand-new kind reading as unresolvable the first time it fires —
-- the same reason ingestion_check_failed was registered in that migration before it had ever raised.
--
-- THIS IS NOT SILENCING THE DETECTOR. Registering here is the remedy the detector's own payload
-- prescribes, and it removes only the FALSE positive: a kind whose bridge is removed, renamed or
-- never wired still raises, because the detector re-evaluates every sweep. No threshold moves and
-- nothing is hand-resolved.

insert into public.ops_alert_kind_external_resolver (kind, resolved_by, evidence) values
  ('barrier_check_failed',
   'scripts/ops/raise-workflow-alert.mjs (via .github/workflows/incident-citation-guard.yml)',
   'Same shared bridge as the six kinds registered by migration 20260905110220: buildRpcCall() calls mon_resolve_key on the same dedup key when --status is success, and the step runs with if: always(). Not yet observed raising - the workflow ships 2026-09-13 - so this registration rests on the shared code path, which is production-proven to self-heal (2026-09-05: journey_live_check_failed 4 raised / 2 auto-resolved; search_live_check_failed 3 raised / 2 auto-resolved). Registered with the family so the kind does not read as unresolvable the first time it fires, exactly as ingestion_check_failed was.')
on conflict (kind) do nothing;

-- Prove the registration took AND that the detector agrees, rather than assuming it.
do $$
declare v_still_open int;
begin
  if not exists (select 1 from public.ops_alert_kind_external_resolver
                  where kind = 'barrier_check_failed') then
    raise exception 'REFUSING: barrier_check_failed did not register';
  end if;

  perform public.mon_detect_unresolvable_alert_kinds();

  select count(*) into v_still_open from public.alert_event
   where resolved_at is null and kind = 'unresolvable_alert_kind'
     and detail->>'kind' = 'barrier_check_failed';
  if v_still_open <> 0 then
    raise exception 'REFUSING: % unresolvable_alert_kind finding(s) for barrier_check_failed are still open after re-running the detector - the registry and the detector disagree', v_still_open;
  end if;
  raise notice 'barrier_check_failed registered; detector agrees';
end $$;
