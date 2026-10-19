-- QA & Repair 2026-10-06 — a remediation escalation no longer outlives the condition it escalated.
--
-- DEFECT (measured 2026-10-06 13:55 UTC): 11 P0 alerts `remediation_exhausted:dangling_scrape_run:*`
-- were open, the oldest since 2026-09-23. Every one of their parent alerts (kind dangling_scrape_run,
-- the same dedup key) had been RESOLVED by its own detector days earlier, and no scrape_run was left
-- dangling (0 unfinished runs older than 6 h). run_remediation() resolves an escalation only inside
-- its loop over OPEN parent alerts, after a verified fix; once the parent closed by any other path the
-- loop never visited it again, so the P0 stayed open forever. Eleven stale P0s are noise that hides a
-- real P0 — the exact shape AGENTS.md warns about (an all-zero sweep sitting on open alerts).
--
-- FIX: mon_resolve_orphaned_escalations() resolves an open remediation_exhausted alert ONLY when its
-- parent (detail.failed_kind + detail.dedup_key) has no open alert_event row. A parent that re-opens
-- re-escalates through the unchanged loop. run_remediation() (cron 141, every 15 min) calls it first,
-- whether or not the worker is enabled. Nothing else in the worker changes (occurrence-guarded replace).

create or replace function public.mon_resolve_orphaned_escalations()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n int := 0;
begin
  for r in
    select e.dedup_key, e.detail->>'failed_kind' as pkind, e.detail->>'dedup_key' as pkey
      from public.alert_event e
     where e.kind = 'remediation_exhausted'
       and e.resolved_at is null
       and e.detail ? 'failed_kind'
       and e.detail ? 'dedup_key'
  loop
    if not exists (select 1 from public.alert_event p
                    where p.kind = r.pkind and p.dedup_key = r.pkey and p.resolved_at is null) then
      perform public.mon_resolve_key('remediation_exhausted', r.dedup_key);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$function$;

comment on function public.mon_resolve_orphaned_escalations() is
  'Resolves a remediation_exhausted P0 whose parent alert (detail.failed_kind/dedup_key) is no longer open. Called first by run_remediation(). QA & Repair 2026-10-06.';

do $outer$
declare
  old_def text := pg_get_functiondef('public.run_remediation()'::regprocedure);
  needle  text := E'begin\n  if not v_enabled then';
  repl    text := E'begin\n  -- 2026-10-06: an escalation must not outlive its parent condition (mon_resolve_orphaned_escalations).\n  perform public.mon_resolve_orphaned_escalations();\n  if not v_enabled then';
begin
  if (length(old_def) - length(replace(old_def, needle, ''))) / length(needle) <> 1 then
    raise exception 'expected exactly one «begin / if not v_enabled» in run_remediation';
  end if;
  execute replace(old_def, needle, repl);
end
$outer$;

-- EXECUTED PROOF at apply time, both directions, on synthetic rows that are rolled back.
do $verify$
declare
  v_open_parent int;
  v_orphan_open int;
begin
  begin
    perform public.mon_raise('P2', 'qa_synthetic_parent', 'qa', 'qa_synthetic_parent:live', '{}'::jsonb);
    perform public.mon_raise('P2', 'remediation_exhausted', 'qa', 'remediation_exhausted:qa_synthetic_parent:live',
      jsonb_build_object('failed_kind', 'qa_synthetic_parent', 'dedup_key', 'qa_synthetic_parent:live'));
    perform public.mon_raise('P2', 'remediation_exhausted', 'qa', 'remediation_exhausted:qa_synthetic_parent:gone',
      jsonb_build_object('failed_kind', 'qa_synthetic_parent', 'dedup_key', 'qa_synthetic_parent:gone'));
    perform public.mon_resolve_orphaned_escalations();
    select count(*) into v_open_parent from public.alert_event
     where dedup_key = 'remediation_exhausted:qa_synthetic_parent:live' and resolved_at is null;
    select count(*) into v_orphan_open from public.alert_event
     where dedup_key = 'remediation_exhausted:qa_synthetic_parent:gone' and resolved_at is null;
    if v_open_parent <> 1 then raise exception 'REGRESSION: an escalation whose parent is OPEN was resolved'; end if;
    if v_orphan_open <> 0 then raise exception 'FIX DID NOT TAKE: an orphaned escalation stayed open'; end if;
    raise exception 'qa_rollback_ok';
  exception when others then
    if sqlerrm <> 'qa_rollback_ok' then raise; end if;
  end;
  if position('mon_resolve_orphaned_escalations' in pg_get_functiondef('public.run_remediation()'::regprocedure)) = 0 then
    raise exception 'run_remediation() does not call the orphan sweep';
  end if;
  -- And the real backlog: every orphan open today is cleared.
  perform public.mon_resolve_orphaned_escalations();
  if exists (select 1 from public.alert_event e
              where e.kind = 'remediation_exhausted' and e.resolved_at is null
                and not exists (select 1 from public.alert_event p
                                 where p.kind = e.detail->>'failed_kind' and p.dedup_key = e.detail->>'dedup_key'
                                   and p.resolved_at is null)
                and e.detail ? 'failed_kind') then
    raise exception 'orphaned escalations remain after the sweep';
  end if;
end
$verify$;
