-- CORRECTION to 20260924020926, same night. The detector THREW on every sweep.
--
--   ERROR 22P02: malformed array literal: "liveness_checking_shortfall:fleet"
--   QUERY: live := live || 'liveness_checking_shortfall:fleet'
--
-- `text[] || <unknown literal>` is ambiguous in Postgres: with an untyped literal it resolves to
-- the array||array operator and tries to PARSE the string as an array literal, rather than to
-- array||element. The per-platform arm survived by accident — `'prefix:' || r.platform` yields a
-- typed text before the append — so only the fleet arm, the one that fires first and every time,
-- was broken.
--
-- WHY THIS MATTERS MORE THAN AN ORDINARY BUG. A detector that raises an exception does not raise an
-- ALERT. mon_run_all_detectors() records it under `failed` and moves on, so the new "is every
-- website being checked?" alarm would have been permanently silent while looking installed — the
-- exact shape this whole night's work exists to remove (LISTING_LIVENESS.md §9: absence cannot be
-- compared, so silence reads as health). It shipped that way because the predicate
-- ops_liveness_checking_shortfall() was executed and verified, and the WRAPPER never was. Executing
-- the thing you actually ship is the rule; a tested component inside an untested caller is untested.
--
-- The system would have caught it within 30 minutes — AGENTS.md's standing rule is that
-- mon_run_all_detectors()'s `failed` must be EMPTY, and this would have appeared there on the next
-- :29/:59 sweep. That is the safety net working; it is not a substitute for executing the function.
--
-- Fix: append with an explicit ::text cast so element-append is unambiguous, on both arms.
-- Verified after applying by CALLING the detector: returns 1, and the fleet alert now carries
-- platforms_behind=67 with gathern reading shape=BEHIND, probes_24h=43, required_per_day=7096.
create or replace function public.mon_detect_liveness_checking_shortfall()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n int := 0;
  live text[] := '{}';
  r record;
  v_rows jsonb;
  v_pos int;
  v_neg int;
  v_gathern jsonb;
begin
  select count(*) into v_pos from public.ops_liveness_checking_shortfall(
    '[{"platform":"__selftest_stalled","active_rows":100,"sla_hours":24,"probes_24h":0,"probes_7d":50,"shape":"STALLED"}]'::jsonb)
   where injected and shape = 'STALLED';
  select count(*) into v_neg from public.ops_liveness_checking_shortfall('[]'::jsonb) where injected;

  if v_pos <> 1 or v_neg <> 0 then
    return public.mon_raise('P1', 'liveness_checking_predicate_blind', 'all',
      'liveness_checking_predicate_blind',
      jsonb_build_object('why', 'ops_liveness_checking_shortfall() stopped discriminating; its '
                              || 'silence no longer means anything',
                         'got_injected', v_pos, 'got_empty', v_neg));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', s.platform, 'shape', s.shape, 'active', s.active_rows,
           'sla_hours', s.sla_hours, 'checked_24h', s.probes_24h,
           'needed_per_day', s.required_per_day, 'pct_of_needed', s.pct_of_required)
         order by s.active_rows desc), '[]'::jsonb)
    into v_rows
    from public.ops_liveness_checking_shortfall() s where not s.injected;

  select to_jsonb(x) into v_gathern from (
    select s.platform, s.shape, s.active_rows, s.sla_hours, s.probes_24h,
           s.required_per_day, s.pct_of_required
      from public.ops_liveness_checking_shortfall() s
     where not s.injected and s.platform = 'gathern') x;

  if jsonb_array_length(v_rows) > 0 then
    -- ::text is load-bearing, see header.
    live := live || 'liveness_checking_shortfall:fleet'::text;
    n := n + public.mon_raise('P1', 'liveness_checking_shortfall', 'all',
      'liveness_checking_shortfall:fleet',
      jsonb_build_object(
        'platforms_behind', jsonb_array_length(v_rows),
        'rows', v_rows,
        'gathern', coalesce(v_gathern, to_jsonb('gathern is NOT behind its schedule'::text)),
        'why', 'These websites are not re-checking their listings fast enough to complete one full '
            || 'pass inside the SLA they themselves declare. required_per_day = active / '
            || '(sla_hours/24). NEVER_CHECKED = nothing has ever looked at this platform. STALLED = '
            || 'it was being checked and stopped. BEHIND = running at under half the needed rate.',
        'do_not', 'Do NOT clear this by raising a platform''s sla_hours or by lowering a cap. That '
            || 'changes the promise instead of the checking, which LISTING_LIVENESS.md §7 forbids '
            || 'in terms. The fix is checking capacity or rotation fairness — see gathern, whose '
            || '0.4% was caused by a sweep re-probing the same 1,500 rows every run, not by '
            || 'throughput (migration 20260924020545, last_liveness_probe_at).',
        'note', 'last_liveness_probe_at starts NULL everywhere it was just added, so a platform '
            || 'reads NEVER_CHECKED until its checker runs once after 2026-09-24. Read this '
            || 'alert''s trend, not its first firing.'));
  else
    perform public.mon_resolve_stale_keys('liveness_checking_shortfall', '{}'::text[]);
  end if;

  for r in
    select * from public.ops_liveness_checking_shortfall()
     where not injected and shape = 'STALLED'
  loop
    live := live || ('liveness_checking_shortfall:' || r.platform)::text;
    n := n + public.mon_raise('P1', 'liveness_checking_stalled', r.platform,
      'liveness_checking_shortfall:' || r.platform,
      jsonb_build_object(
        'active_rows', r.active_rows, 'sla_hours', r.sla_hours,
        'checked_last_24h', r.probes_24h, 'checked_last_7d', r.probes_7d,
        'needed_per_day', r.required_per_day,
        'why', 'This platform WAS having its listings checked within the last 7 days and has '
            || 'checked ZERO in the last 24h. A checker that stops produces no rows for anything to '
            || 'compare, so nothing else in the system notices — that is exactly how wasalt''s '
            || 'enumeration died for seven days while its workflow reported success every run.',
        'action', 'Find why this platform''s liveness job stopped running or stopped selecting '
            || 'rows. Check its workflow schedule, its last runs in scrape_runs, and whether its '
            || 'rotation is stuck behind rows it cannot resolve.',
        'do_not', 'A platform nothing has looked at is UNKNOWN, never dead. Do NOT deactivate or '
            || 'delete anything on account of this alert, and do NOT widen a kill to catch up.'));
  end loop;

  perform public.mon_resolve_stale_keys('liveness_checking_stalled',
    array(select ('liveness_checking_shortfall:' || s.platform)::text
            from public.ops_liveness_checking_shortfall() s
           where not s.injected and s.shape = 'STALLED'));
  return n;
end
$fn$;
