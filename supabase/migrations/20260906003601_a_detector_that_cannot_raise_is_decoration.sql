-- THE CLASS FIX for ops_incident #71: a detector that cannot RAISE is decoration.
--
-- AGENTS.md already says "a detector outside the roster is decoration", and
-- mon_detect_orphaned_detectors enforces REACHABILITY — is this function called by the sweep or by
-- a cron job. That is necessary and not sufficient. Two detectors passed it while being unable to
-- tell anyone anything: mon_detect_refresh_coverage wrote 23 findings into a table with zero
-- readers, and mon_detect_price_magnitude_gate returned rows into `select f();`, which discards a
-- RETURNS TABLE result. Both were reachable. Neither could speak.
--
-- Reachability and audibility are different properties, so this is a second, separate check rather
-- than an extension of the first. It is deliberately structural: it reads pg_get_functiondef and
-- asks whether the body can ever call mon_raise. It cannot prove the raise is correct — only that a
-- path to alert_event exists at all. That is the floor, and the floor is what was missing.
--
-- Self-exempting: this function's own body names mon_raise, so it satisfies its own rule.
create or replace function public.mon_detect_detector_cannot_raise()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; mute text[];
begin
  select coalesce(array_agg(p.proname order by p.proname), '{}') into mute
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'mon\_detect\_%'
     and pg_get_functiondef(p.oid) !~ 'mon_raise';

  if cardinality(mute) > 0 then
    n := public.mon_raise('P1', 'detector_cannot_raise', 'all',
      'detector_cannot_raise:' || array_to_string(mute, ','),
      jsonb_build_object('detectors', to_jsonb(mute),
        'why', 'these mon_detect_* functions contain no mon_raise call, so a finding they make can '
            || 'never reach alert_event, the incident spine, or a human. Reachability (see '
            || 'mon_detect_orphaned_detectors) is not audibility: a detector can be correctly '
            || 'rostered or cron-owned and still be structurally unable to speak. Measured cause, '
            || '2026-09-06: mon_detect_refresh_coverage had written 23 findings to a table nothing '
            || 'reads, and mon_detect_price_magnitude_gate returned rows into a bare select that '
            || 'discards them.'));
  else
    perform public.mon_resolve('detector_cannot_raise', 'all');
  end if;

  return n;
end $function$;

-- Roster entry in the SAME migration (AGENTS.md: a detector outside the roster is decoration).
-- Needle-edit off the LIVE body so a concurrent session's additions are not clobbered, with a hard
-- assertion that the needle matched and the roster grew by exactly one.
do $$
declare src text; out_src text; before_n int; after_n int;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  before_n := (select count(*) from regexp_matches(src, '''mon_detect_[a-z0-9_]+''', 'g'));

  if src ~ 'mon_detect_detector_cannot_raise' then
    raise notice 'already rostered; nothing to do';
    return;
  end if;

  if position('''mon_detect_orphaned_detectors''' in src) = 0 then
    raise exception 'needle ''mon_detect_orphaned_detectors'' not found in mon_run_all_detectors — refusing to guess an insertion point';
  end if;

  out_src := replace(src,
    '''mon_detect_orphaned_detectors''',
    '''mon_detect_orphaned_detectors'',' || chr(10) || '    ''mon_detect_detector_cannot_raise''');

  after_n := (select count(*) from regexp_matches(out_src, '''mon_detect_[a-z0-9_]+''', 'g'));
  if after_n <> before_n + 1 then
    raise exception 'roster would change by % entries, expected exactly 1', after_n - before_n;
  end if;

  execute out_src;
end $$;
