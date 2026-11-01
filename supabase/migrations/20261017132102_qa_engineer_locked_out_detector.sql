-- 🔧 Quality & Repair 2026-10-17 (owner order of 2026-10-16, «missed-run detector»): on 10-15 and 10-16
-- three night engineers lost their runs to «You've hit your weekly limit» (the session died within
-- seconds) and nothing flagged it until the next review two days later. ops_engineer_review keys «ran»
-- on the <engineer>:start row, so an engineer that never starts is simply absent — and absence cannot
-- be compared (AGENTS.md: «a checker's silence must be an alarm»). This detector turns that absence into
-- a P1 on the owner's morning screen, on its own 15-minute cadence, with its own dedup key per engineer
-- (never per day: a per-day key is a detector that can never close yesterday, lesson 2026-10-13).
--
-- mon_engineer_missed_runs(p_now) DECIDES and takes the clock as a parameter so it can be executed
-- against the real past: at 2026-10-15 10:00 UTC it names the engineers that were locked out that night;
-- at now() every slot reads «ran». mon_detect_engineer_locked_out() only raises and resolves.
--   missed = no <engineer>:start row from 30 min before the slot to 12 h after it (a late firing, like
--            🔬's 14:29 start on 10-16, still counts as ran — the key closes the moment it starts);
--   died   = a :start row and then no row at all from that engineer for 150 minutes (a session that
--            errored seconds after starting leaves exactly this shape; a healthy run writes a proof,
--            a progress or an end row well inside that);
--   ran    = anything else.
-- Night-shift slots (UTC, owner 2026-10-04): ⚡ 05:00 · 🆕 07:00 · 🔬 09:00 · ♻️ 11:00 · 🔧 13:00; the
-- grace is 45 minutes (the triggers fire 5–15 minutes past the hour).
insert into public.ops_declared_alert_kind (kind, declared_in, note)
values ('engineer_locked_out', 'docs/ops/QUALITY_REPAIR_ENGINEER.md (owner order 2026-10-16: missed-run detector)',
        'P1 — a night engineer wrote no :start row by 45 min after its slot, or wrote :start and nothing else for 150 min')
on conflict do nothing;

create or replace function public.mon_engineer_missed_runs(p_now timestamptz default now())
returns table(engineer text, slot_at timestamptz, deadline_at timestamptz, started_at timestamptz,
              rows_after_start integer, verdict text)
language sql
stable
set search_path to 'public'
as $function$
with slots(engineer, slot_time) as (
  values ('scraping-engineer', time '05:00'), ('new_listings_engineer', time '07:00'),
         ('advanced_filter', time '09:00'), ('lifecycle', time '11:00'), ('qa', time '13:00')),
days as (
  select d::date as d
  from generate_series(((p_now at time zone 'utc')::date - 1)::timestamp,
                       ((p_now at time zone 'utc')::date)::timestamp, interval '1 day') d),
expected as (
  select s.engineer, ((d.d + s.slot_time) at time zone 'utc') as slot_at
  from slots s cross join days d),
latest as (
  select distinct on (e.engineer) e.engineer, e.slot_at
  from expected e
  where e.slot_at + interval '45 minutes' <= p_now
  order by e.engineer, e.slot_at desc),
started as (
  select l.engineer, l.slot_at,
         (select min(r.run_at) from public.ops_daily_engineer_run r
           where r.phase = l.engineer || ':start'
             and r.run_at >= l.slot_at - interval '30 minutes'
             and r.run_at <  l.slot_at + interval '12 hours'
             and r.run_at <= p_now) as started_at
  from latest l),
counted as (
  select s.engineer, s.slot_at, s.started_at,
         (select count(*)::int from public.ops_daily_engineer_run r
           where s.started_at is not null
             and r.phase like s.engineer || ':%'
             and r.run_at > s.started_at and r.run_at <= p_now) as rows_after_start
  from started s)
select c.engineer, c.slot_at, c.slot_at + interval '45 minutes' as deadline_at, c.started_at, c.rows_after_start,
       case
         when c.started_at is null then 'missed'
         when c.rows_after_start = 0 and p_now >= c.started_at + interval '150 minutes' then 'died'
         else 'ran'
       end as verdict
from counted c
order by c.slot_at;
$function$;

create or replace function public.mon_detect_engineer_locked_out()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; n int := 0; k text;
begin
  for rec in select * from public.mon_engineer_missed_runs(now()) loop
    k := 'engineer_locked_out:' || rec.engineer;
    if rec.verdict = 'ran' then
      perform public.mon_resolve_key('engineer_locked_out', k);
    else
      n := n + public.mon_raise('P1', 'engineer_locked_out', rec.engineer, k,
        jsonb_build_object(
          'verdict', rec.verdict, 'slot_utc', rec.slot_at, 'deadline_utc', rec.deadline_at,
          'started_at', rec.started_at, 'rows_after_start', rec.rows_after_start,
          'why', case rec.verdict
                   when 'missed' then 'no ' || rec.engineer || ':start row by 45 minutes after its night-shift slot. On 10-15 and 10-16 three engineers were locked out by «You''ve hit your weekly limit» and nothing flagged it for two days; an engineer that never starts contributes no row anyone compares.'
                   else 'the run wrote its :start row and then nothing for 150 minutes. A session that errors seconds after starting (rate_limit, is_error) leaves exactly this shape.'
                 end,
          'action', 'read the trigger''s run log for this engineer. If the weekly usage limit is exhausted the owner decides; the engineer''s queue is intact in ops_engineer_backlog and 🔧 reviews the gap next morning.'));
    end if;
  end loop;
  return n;
end
$function$;

-- Its own cadence: expected-but-absent runs are watched every 15 minutes, independent of the half-hourly
-- detector sweep (a cron job makes it reachable for mon_detect_orphaned_detectors).
select cron.schedule('mon-engineer-locked-out', '*/15 * * * *', $c$select public.mon_detect_engineer_locked_out()$c$);