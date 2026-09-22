-- Self-correction on the migration applied 12 minutes earlier
-- (incident_queue_resolves_either_routine_slug_and_refuses_an_unknown_one).
--
-- Its PROOF 4 planted a LIMB 3 mutant, asserted the mutant had LANDED, rolled it back, and
-- asserted it did not persist. It never CALLED mon_detect_routine_slug_divergence() while the
-- mutant was present. So it proved the plant and the rollback — and nothing whatsoever about
-- whether the detector can see a mutant. A detector with all four limbs deleted would have passed
-- that proof unchanged, because the only detector call in it ran against the CLEAN world and was
-- asserted to return 0.
--
-- That is this repo's standing failure shape (AGENTS.md, ops_incident #391) in its purest form:
-- a proof that confirms the predicate's existence rather than its coverage. It is recorded here
-- rather than quietly amended, because the original migration is byte-exact with what production
-- executed and drift condition #5 compares the mirror against it — history stays as it ran.
--
-- MEASURED by execution before writing this, in a rolled-back sub-transaction:
--     clean = 0, mutant = 1, persisted = false
-- so the detector does genuinely catch the unmapped heartbeat slug. The defect was in the PROOF,
-- not in the detector. This migration makes a REPLAY prove that too.
--
-- routine #7 (systems-seam), 2026-09-22.

do $p$
declare
  v_clean     int;
  v_mutant    int := -1;
  v_persisted boolean;
begin
  -- The world must be clean first, or "the mutant raised" proves nothing about the mutant.
  v_clean := public.mon_detect_routine_slug_divergence();
  if v_clean <> 0 then
    raise exception 'coverage proof: detector raised % before the mutant — cannot attribute a raise', v_clean;
  end if;

  begin
    insert into public.ops_routine_sentry_heartbeat
      (routine, ran_at, issues_seen, issues_claimed, issues_resolved, note)
    values ('__mutant_unmapped_slug__', now(), 0, 0, 0,
            'ROLLED BACK: coverage proof for ops_incident #252');

    -- THE STEP THE ORIGINAL PROOF OMITTED: show the mutant to the detector.
    v_mutant := public.mon_detect_routine_slug_divergence();

    raise exception 'ROLLBACK_MUTANT';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_MUTANT' then raise; end if;
  end;

  if v_mutant < 1 then
    raise exception
      'coverage proof FAILED: detector returned % with an unmapped heartbeat slug present — LIMB 3 is blind',
      v_mutant;
  end if;

  v_persisted := exists (
    select 1 from public.ops_routine_sentry_heartbeat where routine = '__mutant_unmapped_slug__');
  if v_persisted then
    raise exception 'coverage proof: the mutant PERSISTED — refusing to install';
  end if;

  raise notice 'coverage proof ok: clean=0, mutant=%, rolled back', v_mutant;
end $p$;
