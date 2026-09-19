-- ════════════════════════════════════════════════════════════════════════════════════════════
-- An orphaned-guarantee rotation may DOWNGRADE a verdict. It may never UPGRADE a violation.
-- routine #7 🧵 systems-seam, 2026-09-18.
--
-- Running a detector answers "is the detector green right now". It does NOT answer "does the
-- invariant still hold" — and the difference is the entire reason this registry exists. The two
-- aqarmonthly entries are the worked example: raw is clean, the index is clean, the detector
-- correctly returns 0 — and 366 rows are still glued in listings_arabic_locations, the shadow
-- layer between them that no limb watches. A bulk rotation that writes `holds` because the
-- detector returned 0 does not merely lose information, it ERASES the evidence that found the
-- breach and makes the guarantee read as healthy.
--
-- This has now happened TWICE to the same four rows:
--   * 2026-09-13 — a reachability-style rotation overwrote all four; corrected by hand, and the
--     correction was written into last_detail as a warning to the next run.
--   * 2026-09-18 — this run did it again, from a rotation that had the guard in its SELECT. The
--     guard was never the problem: an earlier unguarded pass was still executing server-side after
--     its client timed out, and its writes landed after the table had been read as unchanged.
--     A convention that lives in a WHERE clause protects only the queries that remember it.
--
-- So the rule moves out of each rotation's SQL and into the table. Downgrades stay free (a
-- rotation must always be able to say detector_missing or detector_error). Only violated -> holds
-- is blocked, and only until someone does the per-invariant data re-check the verdict is about and
-- says so, by putting `evidence_recheck` in last_detail. That is deliberately not a flag a bulk
-- loop sets by accident.
-- ════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.ops_registry_verdict_is_earned()
returns trigger
language plpgsql
as $fn$
begin
  if old.last_verdict = 'violated'
     and new.last_verdict in ('holds', 'clean', 'ok')
     and not coalesce((new.last_detail ? 'evidence_recheck'), false) then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'ops_repair_guarantee_registry: refusing to upgrade %s from violated to %s without evidence',
        new.repair_version, new.last_verdict),
      detail  = 'A detector returning 0 proves the DETECTOR is green, not that the INVARIANT holds. '
             || 'The standing counter-example is aqarmonthly 20260721104637 / 20260823145919: raw '
             || 'clean, index clean, detector 0, and 366 rows still glued in the shadow layer '
             || 'listings_arabic_locations that no limb watches.',
        hint  = 'Downgrades (detector_missing, detector_error, breached) are always allowed. To '
             || 'clear a violation, do the per-invariant data re-check the verdict is about and '
             || 'record it: last_detail must contain an "evidence_recheck" key describing what was '
             || 're-measured against production.';
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_ops_registry_verdict_is_earned on public.ops_repair_guarantee_registry;
create trigger trg_ops_registry_verdict_is_earned
  before update on public.ops_repair_guarantee_registry
  for each row execute function public.ops_registry_verdict_is_earned();

-- ── Prove BOTH directions at apply time, against the real table, rolled back. A guard that has
--    never been watched to fire is the shape this repo keeps getting burned by.
do $proof$
declare
  v_blocked boolean := false;
  v_allowed boolean := false;
  v_downgrade_ok boolean := false;
begin
  -- 1. violated -> holds with no evidence MUST be refused
  begin
    update public.ops_repair_guarantee_registry
       set last_verdict = 'holds', last_detail = jsonb_build_object('checked_by','proof')
     where repair_version = '20260721104637';
  exception when check_violation then
    v_blocked := true;
  end;

  -- 2. violated -> holds WITH an evidence_recheck key MUST be allowed
  begin
    update public.ops_repair_guarantee_registry
       set last_verdict = 'holds',
           last_detail = jsonb_build_object('evidence_recheck','proof: re-measured the shadow layer')
     where repair_version = '20260721104637';
    v_allowed := true;
  exception when check_violation then
    v_allowed := false;
  end;

  -- 3. a DOWNGRADE must stay free
  begin
    update public.ops_repair_guarantee_registry
       set last_verdict = 'detector_missing', last_detail = jsonb_build_object('checked_by','proof')
     where repair_version = '20260804193711';
    v_downgrade_ok := true;
  exception when check_violation then
    v_downgrade_ok := false;
  end;

  if not v_blocked then
    raise exception 'PROOF FAILED: unevidenced violated->holds was NOT blocked';
  end if;
  if not v_allowed then
    raise exception 'PROOF FAILED: evidenced violated->holds was blocked (guard is too strict)';
  end if;
  if not v_downgrade_ok then
    raise exception 'PROOF FAILED: a downgrade was blocked (guard is too strict)';
  end if;

  raise notice 'PROVEN: unevidenced upgrade blocked, evidenced upgrade allowed, downgrade free';
  -- undo everything this proof touched
  raise exception using errcode = 'P0001', message = 'PROOF_ROLLBACK';
exception when others then
  if sqlerrm = 'PROOF_ROLLBACK' then
    -- re-raise so the enclosing block rolls the proof's writes back, then swallow at the outer level
    raise notice 'proof writes rolled back';
  else
    raise;
  end if;
end
$proof$;