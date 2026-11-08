-- 🔧 2026-11-08: mon_detect_alert_delivery() BRANCH 2 tells «the dispatcher ran and skipped this alert» from «the
-- dispatcher has not run since this alert was armed».
--
-- repeat_bug alert_delivery_undelivered: 20 reopens in 7 days (ops_repeat_bugs), every one a 3–35 minute flap — e.g.
-- 13788 raised 03:54 UTC over ONE P2 armed at 02:52 and resolved 03:57; 13527/13537 raised 05:01/05:07 over alerts armed
-- 03:59 and resolved 05:13. In each case alert-dispatch.yml had simply not run yet: GitHub runners were queued at night
-- (~100 runs, fleet lesson 11-04 ①) and the dispatch run that the :43 bundle asked for started 60–75 minutes later; the
-- moment it ran, every row was stamped and the P1 self-resolved. The 60-minute grace measured wall-clock queue delay,
-- not a lost alert, so the P1 carried no information (owner 2026-11-07: fix the ROOT so the same bugs stop coming back).
--
-- The fix keeps the real failure loud and makes the condition specific:
--   · an alert still undispatched 60 minutes after it was armed AND the dispatcher has stamped a LATER alert since
--     (it ran and skipped this one — a filter, a failed issue create, a broken row) → P1 at once, as before;
--   · an alert nothing has dispatched for 180 minutes, whatever the dispatcher did → P1 (the dispatcher is dead or the
--     queue is longer than any night measured — still a delivery outage, said plainly);
--   · an alert 60–180 minutes old while the dispatcher has stamped nothing newer → not yet a delivery failure.
-- Edited in place with replace() (10-30 lesson); every anchor must be present or the block raises and nothing changes.
do $$
declare
  d text;
  decl_anchor text := E'  c_grace_min   int    := 60;';
  decl_add text := E'  c_grace_min   int    := 60;\n'
    || E'  -- 2026-11-08 (🔧, repeat_bug alert_delivery_undelivered — 20 reopens in 7 days, each a 3–35 min flap): a row older\n'
    || E'  -- than the grace is a delivery FAILURE only when the dispatcher has stamped a later row since (it ran and skipped\n'
    || E'  -- this one), or when nothing has dispatched it for c_dead_min. A dispatcher that has not run yet — GitHub runners\n'
    || E'  -- queued at night — is not a lost alert; its P1 self-resolved minutes later on every one of the 20 reopens.\n'
    || E'  c_dead_min    int    := 180;\n'
    || E'  v_last_stamp  timestamptz := (select max(dispatched_at) from public.alert_event);';
  pred_anchor text := 'greatest(created_at, coalesce(rearmed_at, created_at)) < now() - make_interval(mins => c_grace_min)';
  pred_new text := E'((greatest(created_at, coalesce(rearmed_at, created_at)) < now() - make_interval(mins => c_grace_min)\n'
    || E'                  and v_last_stamp > greatest(created_at, coalesce(rearmed_at, created_at)) + interval ''2 minutes'')\n'
    || E'              or greatest(created_at, coalesce(rearmed_at, created_at)) < now() - make_interval(mins => c_dead_min))';
  n_pred int;
begin
  select pg_get_functiondef('public.mon_detect_alert_delivery'::regproc) into d;
  if position(decl_anchor in d) = 0 then
    raise exception 'declare anchor not found in mon_detect_alert_delivery(); body changed — re-read before editing';
  end if;
  select count(*) into n_pred from regexp_matches(d, 'greatest\(created_at, coalesce\(rearmed_at, created_at\)\) < now\(\) - make_interval\(mins => c_grace_min\)', 'g');
  if n_pred <> 3 then
    raise exception 'expected the grace predicate 3 times (v_late/v_oldest, v_sev, v_late_sample), found %', n_pred;
  end if;
  d := replace(d, decl_anchor, decl_add);
  d := replace(d, pred_anchor, pred_new);
  execute d;
end $$;

-- PROOF (pure SELECT over hand-made rows of the real shape; nothing written): the three cases the comment names.
do $$
declare
  r record;
  c_grace_min int := 60;
  c_dead_min int := 180;
  n_bad int := 0;
begin
  for r in
    with cases(name, armed, last_stamp, expect) as (values
      ('skipped: armed 70 min ago, dispatcher stamped another row 10 min ago', now() - interval '70 minutes', now() - interval '10 minutes', true),
      ('not yet run: armed 70 min ago, last stamp 80 min ago',                 now() - interval '70 minutes', now() - interval '80 minutes', false),
      ('not yet run, never stamped anything',                                  now() - interval '70 minutes', null::timestamptz,              false),
      ('dead: armed 200 min ago, nothing since',                               now() - interval '200 minutes', now() - interval '210 minutes', true),
      ('fresh: armed 20 min ago, dispatcher stamped 5 min ago',                now() - interval '20 minutes', now() - interval '5 minutes', false))
    select name, expect,
           -- coalesce: a NULL last stamp makes the AND unknown; in the detector's WHERE an unknown row is simply not late
           coalesce((armed < now() - make_interval(mins => c_grace_min) and last_stamp > armed + interval '2 minutes')
             or armed < now() - make_interval(mins => c_dead_min), false) as got
      from cases
  loop
    if r.got is distinct from r.expect then
      n_bad := n_bad + 1;
      raise warning 'case «%» expected % got %', r.name, r.expect, r.got;
    end if;
  end loop;
  if n_bad > 0 then raise exception '% proof case(s) failed', n_bad; end if;
  if position('c_dead_min' in pg_get_functiondef('public.mon_detect_alert_delivery'::regproc)) = 0 then
    raise exception 'the live function does not carry c_dead_min after the edit';
  end if;
  raise notice 'alert_delivery branch 2: skipped-vs-not-yet-run predicate proven on 5 cases; function carries c_dead_min';
end $$;