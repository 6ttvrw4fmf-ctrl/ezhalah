-- mon_detect_price_drift_predicate_is_blind() was wired into mon_detect_price_fidelity() (hourly,
-- cron jobid 42) and that felt like enough. It is not: mon_orphaned_detectors() reported it as an
-- ORPHAN the moment it existed, because reachability is measured from the ROSTER and from cron
-- commands, not from one function calling another. AGENTS.md says it plainly -- "a detector outside
-- the roster is decoration" -- and mon_detect_orphaned_detectors() raised on it immediately, which is
-- the barrier working exactly as designed.
--
-- So it joins the roster, where mon_run_all_detectors() reaches it twice an hour (:29/:59) -- strictly
-- more often than the hourly detector it guards. The inline call in mon_detect_price_fidelity() is
-- KEPT deliberately: the guard on a guard should run whenever the guard runs, and re-running seven
-- IMMUTABLE predicate calls costs microseconds while mon_raise() dedups the alert, so the second path
-- can neither double-report nor drift out of step with the first.
--
-- Appended by needle edit, not a full-body replace: every routine that adds a barrier edits this one
-- array, so two sessions in the same window would otherwise clobber each other (the reason
-- package.json's 201-command chain was replaced by discovery in the first place).

do $mig$
declare def text; anchor constant text := '    ''mon_detect_oracle_chain_never_observed'','; a int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to register the detector blind';
  end if;
  if position('mon_detect_price_drift_predicate_is_blind' in def) > 0 then
    return;   -- already registered; idempotent re-apply
  end if;
  a := position(anchor in def);
  if a = 0 then
    raise exception 'needle anchor not found in the LIVE mon_run_all_detectors() roster -- refusing to full-body-replace it';
  end if;
  def := substr(def, 1, a - 1)
      || '    ''mon_detect_price_drift_predicate_is_blind'',' || chr(10)
      || anchor
      || substr(def, a + length(anchor));
  execute def;
end $mig$;
