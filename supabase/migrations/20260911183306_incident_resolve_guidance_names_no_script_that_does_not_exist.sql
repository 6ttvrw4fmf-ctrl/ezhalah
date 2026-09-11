-- Follow-up to 20260911181654 (ops_incident #186), same run, ~20 minutes later.
--
-- That migration's RAISE guidance used «scripts/verify-x.ts» as a worked example of what to pass as
-- the barrier argument. It is a placeholder and no such file exists — and
-- scripts/verify-ops-remediation-scripts-exist.ts correctly reads any scripts/verify-*.ts named by a
-- migration as a PROMISED PROTECTION and fails when the file is absent. It caught this on the very
-- next full-suite run. The barrier is right: a migration that names a protection which does not
-- exist is exactly the "five migrations claim a barrier protects them and the named file does not
-- exist" class (ops_incident #50).
--
-- The guidance is kept; only the fake path goes. Nothing else about the function changes — same
-- signature, still no DEFAULT, same three guards — so this is a pure message correction and
-- CREATE OR REPLACE is sufficient (no default is being removed this time).
create or replace function public.incident_resolve(
  p_id bigint,
  p_barrier_script text,
  p_production_verified_at timestamptz          -- NO DEFAULT (ops_incident #186)
) returns boolean
language plpgsql
as $function$
begin
  if p_barrier_script is null or length(btrim(p_barrier_script)) = 0 then
    raise exception 'incident % cannot resolve without naming its permanent regression barrier', p_id;
  end if;
  if p_production_verified_at is null then
    raise exception
      'incident % cannot resolve without a production verification timestamp. Pass the moment you '
      'ACTUALLY OBSERVED production behaving correctly through the real path a user hits (§G.9(6)) — '
      'that is, incident_resolve(%, <the barrier that now covers this>, <the timestamp you observed '
      'it at>). This parameter no longer defaults to now(): a timestamp the system supplies on your '
      'behalf is a record of the claim, not of the observation (ops_incident #186).', p_id, p_id;
  end if;
  if p_production_verified_at > now() then
    raise exception
      'incident % cannot resolve with a production verification dated in the FUTURE (% > %). An '
      'observation that has not happened yet is not evidence.', p_id, p_production_verified_at, now();
  end if;
  update public.ops_incident
     set state = 'resolved', barrier_script = p_barrier_script,
         production_verified_at = p_production_verified_at,
         resolved_at = now(), last_progress_at = now(), updated_at = now()
   where id = p_id;
  return true;
end $function$;
