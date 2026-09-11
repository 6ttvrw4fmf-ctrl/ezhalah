-- ROUTINE #9 🔬 PRODUCTION RED TEAM (2026-09-11) — ops_incident #186.
-- THE PRODUCTION-VERIFICATION GATE WAS SATISFIED BY THE FUNCTION'S OWN DEFAULT ARGUMENT.
--
-- incident_resolve() read:
--     p_production_verified_at timestamptz DEFAULT now()
--     ...
--     if p_production_verified_at is null then raise exception ... end if;
--
-- The only check was `is null`, and the DEFAULT made that branch unreachable. So the two-argument
-- call incident_resolve(id, 'some-barrier.ts') ALWAYS passed the gate, stamping now() — the time of
-- the CLAIM, never the time of an OBSERVATION.
--
-- MEASURED on production before this migration:
--   58 of 84 all-time resolutions (69%) carry production_verified_at EXACTLY equal to resolved_at
--   17 of 17 resolutions on 2026-09-11 alone.
-- i.e. in 69% of every incident this system has ever closed, nothing anywhere established that a
-- human or an agent had looked at production.
--
-- WHY IT MATTERS, with today's worked example. ops_incident #143 was resolved at 14:20:45Z carrying
-- a production verification. The schedule change it fixed did not first EXECUTE until 14:36Z, and
-- the declared contract it broke on the way was not raised until 14:29Z (alert_event 2387, which
-- then stood open for 57 minutes). Nothing in the spine required the observation to exist, so
-- nothing objected. AUTONOMOUS_INCIDENT_LOOP.md §3.1 says "resolution is EARNED"; what was actually
-- enforced is that a COLUMN IS NOT NULL.
--
-- THE FIX IS ONE TOKEN: drop the DEFAULT, so the guard that was already written actually fires and
-- the caller must supply a timestamp it is prepared to stand behind. There is no code blast radius —
-- the callers are agent sessions issuing SQL, and the repo contains no programmatic call site.
--
-- Also added: an observation cannot be in the FUTURE. A caller reaching for a value to get past the
-- new requirement will most often reach for something like now() + interval, and a verification
-- dated after the moment of resolution is not a verification of anything.
--
-- This does NOT try to prove the timestamp is honest — no schema can. It removes the case where the
-- system supplies the evidence on the caller's behalf and then accepts it as the caller's.
--
-- DROP-THEN-CREATE is required, not stylistic: PostgreSQL refuses to remove a parameter default via
-- CREATE OR REPLACE ("cannot remove parameter defaults from existing function", 42P13). Dropping the
-- 3-arg signature also guarantees no stale overload survives to let existing callers walk past the
-- repair — the duplicate-overload shape (PGRST203) the migration drift guard already watches for.
--
-- PROVEN BY EXECUTION ON PRODUCTION immediately after apply (all four directions):
--   incident_resolve(-1,'x')                          -> 42883 function does not exist  (2-arg GONE)
--   incident_resolve(-1,'x',null)                     -> P0001 refused, guard now reachable
--   incident_resolve(-1,'x',now()+interval '1 hour')  -> P0001 refused, FUTURE is not evidence
--   incident_resolve(-1,'x',now()-interval '1 minute')-> true   (NOT vacuously red)
drop function if exists public.incident_resolve(bigint, text, timestamptz);
drop function if exists public.incident_resolve(bigint, text);

create function public.incident_resolve(
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
      'e.g. incident_resolve(%, ''scripts/verify-x.ts'', timestamptz ''2026-09-11 15:50:00+00''). '
      'This parameter no longer defaults to now(): a timestamp the system supplies on your behalf is '
      'a record of the claim, not of the observation (ops_incident #186).', p_id, p_id;
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
