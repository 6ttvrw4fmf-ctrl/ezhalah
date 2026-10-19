-- ════════════════════════════════════════════════════════════════════════════════════════════
-- The detector sweep's skip was a SUFFIX, so array position was a permanent priority.
-- routine #7 🧵 systems-seam, 2026-09-18.
--
-- mon_run_all_detectors() walks a fixed-order array and, when the soft budget binds, skips every
-- remaining detector to the END of the array. Position was therefore a permanent priority, and a
-- newly-added detector -- always appended last -- was always the FIRST to go dark, silently, in
-- exactly the degraded conditions barriers exist for.
--
-- MEASURED 2026-09-18 over 47 sweeps in 24h (roster size 208), a perfect rank correlation:
--     positions 202-208  skipped 6x     (97-100% through the roster)
--     positions 189-201  skipped 5x     (91-97%)
--     positions 158-167  skipped 4x     (76-80%)
--     positions 1-157    skipped 0x     -- never, not once
-- Among the 6x cohort: mon_detect_dead_qa_oracle_wrapper (pos 208, added three days earlier in
-- PR #2756 to catch a QA oracle that had been dead 24 days) and mon_detect_cron_timeout_headroom
-- (pos 205 -- the detector that watches THIS job being killed by statement_timeout). The monitor
-- for the sweep's own health was being starved by the sweep it monitors.
--
-- Trigger: mon_detect_card_label_contract regressed 6s -> 478s on 2026-09-15 and ate ~74% of the
-- sweep budget for three days (it has since returned to ~10s on its own). The runaway detector was
-- the occasion; the starvation ORDER is the defect, and it outlives any one slow detector.
--
-- This does NOT weaken the budget: the same detectors are skipped in the same numbers, the same
-- P1 detector_sweep_budget still names them. It only stops the skip landing on the same tail
-- every time -- least-recently-RUN goes first, so a detector starved this sweep leads the next.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. The barrier: a rostered detector that is being skipped and has not actually RUN in hours
--       is NOT green, it is unmeasured. (AGENTS.md: nine dark detectors read as a clean bill of
--       health on 2026-08-10.) Kind starts with `detector_`, so scripts/lib/alertRouting.ts
--       routes it to routine-7-seam -- the routine that owns the sweep.
create or replace function public.mon_detect_detector_dark()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n int := 0;
  v_dark jsonb;
begin
  with roster as (
    select distinct (m.f_arr)[1] as detector
      from regexp_matches(
             pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure),
             '''(mon_detect_[a-z0-9_]+)''', 'g') as m(f_arr)
  ),
  agg as (
    select t.detector,
           max(t.swept_at) filter (where not t.skipped
                                     and coalesce(t.crashed, false) = false) as last_ran,
           min(t.swept_at) as first_seen,
           count(*) filter (where t.skipped) as skips
      from public.ops_detector_timing t
     where t.swept_at > now() - interval '14 days'
     group by t.detector
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'detector',           r.detector,
           'last_actually_ran',  a.last_ran,
           'never_ran',          (a.last_ran is null),
           'hours_dark',         round((extract(epoch from
                                    now() - coalesce(a.last_ran, a.first_seen)) / 3600.0)::numeric, 1),
           'skipped_sweeps_14d', a.skips)
         order by coalesce(a.last_ran, a.first_seen)), '[]'::jsonb)
    into v_dark
    from roster r
    join agg a on a.detector = r.detector
   where a.skips > 0
     and coalesce(a.last_ran, a.first_seen) < now() - interval '6 hours';

  if jsonb_array_length(v_dark) > 0 then
    n := public.mon_raise('P1', 'detector_dark', 'monitoring', 'detector_dark',
      jsonb_build_object(
        'dark',  v_dark,
        'count', jsonb_array_length(v_dark),
        'why',   'These detectors are ON the roster but have not actually executed in over 6 hours '
              || '(12+ consecutive sweeps) because the sweep''s soft budget skipped them. A skipped '
              || 'detector is NOT green -- it is unmeasured, and it reads to every dashboard and '
              || 'every routine as a clean bill of health. This is the failure shape recorded in '
              || 'AGENTS.md for 2026-08-10, when nine dark detectors did exactly that.',
        'action','Attribute the sweep cost first: select detector, round(avg(elapsed_ms)) ms from '
              || 'ops_detector_timing where swept_at > now() - interval ''24 hours'' and not '
              || 'skipped group by 1 order by 2 desc limit 10;  A single runaway detector starves '
              || 'the rest. Fix the runaway -- do NOT raise the budget and do NOT drop a detector.'));
  else
    perform public.mon_resolve_key('detector_dark', 'detector_dark');
  end if;
  return n;
end
$fn$;

-- ── 2. Needle-edit the LIVE mon_run_all_detectors(), never a full-body replace: three sessions
--       are active in this database right now, and re-creating a ~200-entry roster from a stale
--       body silently drops whatever another session added in the meantime (AGENTS.md, SAFETY).
do $mig$
declare
  v_src text;
  v_new text;
  v_anchor_roster constant text := '''mon_detect_dead_qa_oracle_wrapper''';
  v_anchor_loop   constant text := '  foreach fn in array fns loop';
  v_rotation      constant text :=
'  -- ANTI-STARVATION (routine #7, 2026-09-18). The skip below is a SUFFIX of this array: when the
  -- budget binds, every detector from that point to the END does not run. Array position was
  -- therefore a permanent priority and the newest detector was always first to go dark. Ordering
  -- least-recently-RUN first makes the skip ROTATE, so a detector starved this sweep leads the
  -- next one. Same detectors skipped, same count, same P1 -- just never the same tail twice.
  select array_agg(u.fn order by l.last_ran nulls first, u.ord)
    into fns
    from unnest(fns) with ordinality as u(fn, ord)
    left join (select detector, max(swept_at) as last_ran
                 from public.ops_detector_timing
                where not skipped and coalesce(crashed, false) = false
                group by detector) l on l.detector = u.fn;

' || v_anchor_loop;
begin
  select pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure) into v_src;
  v_new := v_src;

  -- 2a. roster entry, in the SAME migration as the detector it names (AGENTS.md: a detector
  --     outside the roster is decoration, and mon_detect_orphaned_detectors() fires on it).
  if position('''mon_detect_detector_dark''' in v_new) = 0 then
    if (length(v_new) - length(replace(v_new, v_anchor_roster, '')))
         / length(v_anchor_roster) <> 1 then
      raise exception 'roster anchor % not found exactly once -- refusing to edit blind',
        v_anchor_roster;
    end if;
    v_new := replace(v_new, v_anchor_roster,
                     v_anchor_roster || ',
    ''mon_detect_detector_dark''');
  end if;

  -- 2b. the rotation itself.
  if position('ANTI-STARVATION' in v_new) = 0 then
    if (length(v_new) - length(replace(v_new, v_anchor_loop, '')))
         / length(v_anchor_loop) <> 1 then
      raise exception 'loop anchor not found exactly once -- refusing to edit blind';
    end if;
    v_new := replace(v_new, v_anchor_loop, v_rotation);
  end if;

  if v_new = v_src then
    raise notice 'mon_run_all_detectors() already carries both edits; nothing to do';
    return;
  end if;

  execute v_new;
end
$mig$;

-- ── 3. Prove BOTH edits landed on the live object, or fail the migration. A needle edit that
--       silently matched nothing is the exact failure this shape exists to prevent.
do $verify$
declare v text;
begin
  select pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure) into v;
  if position('''mon_detect_detector_dark''' in v) = 0 then
    raise exception 'VERIFY FAILED: mon_detect_detector_dark is not on the roster';
  end if;
  if position('ANTI-STARVATION' in v) = 0 then
    raise exception 'VERIFY FAILED: rotation was not inserted';
  end if;
  if position('array_agg(u.fn order by l.last_ran nulls first, u.ord)' in v) = 0 then
    raise exception 'VERIFY FAILED: rotation body missing';
  end if;
  raise notice 'VERIFIED: roster entry + rotation both live';
end
$verify$;