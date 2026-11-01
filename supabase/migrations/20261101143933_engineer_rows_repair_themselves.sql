-- Owner 2026-11-01 («wire them so they do better»). Three things cost the engineers points or work
-- without any engineer doing the job badly. Each now repairs itself instead of relying on a prompt.
--
-- 1. A backlog row under a name its lane's queue never reads is invisible. Wasalt's P1 sat unread
--    under «⚡» for a night; 9 more open rows sat under qa / scraping / lifecycle-engineer / new_listings,
--    including one ♻️ routed to 🔧. Aliases fold to the lane's real name; an unknown name is refused.
-- 2. ♻️ wrote its 2026-11-01 rows into notes, so report stayed NULL and the review read it as 20%.
--    A row with notes and no report now takes the notes as its report.
-- 3. ops_engineer_review keys on a :start row. ⚡, 🔬 and ♻️ wrote a :plan with no :start and read as
--    NOT RUN. A :plan with no recent :start now records the start at the plan's time.
-- ops_engineer_fix_rate divides by everything found. The order is fixed ÷ (found − routed − dated), which
-- engineers write as «fixed N of M own-lane», so the view now also reads that sentence.

create or replace function public.ops_engineer_lane_name(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p in ('scraping-engineer','new_listings_engineer','advanced_filter','lifecycle','repair','falcon') then p
    when p in ('⚡','scraping','scraping_engineer','scraping engineer') then 'scraping-engineer'
    when p in ('🆕','new_listings','new-listings','new-listings-engineer','new_listing') then 'new_listings_engineer'
    when p in ('🔬','af','advanced-filter','advanced_filter_engineer') then 'advanced_filter'
    when p in ('♻️','♻','lifecycle-engineer','lifecycle_engineer') then 'lifecycle'
    when p in ('🔧','qa','quality-repair','quality_repair','repair-engineer') then 'repair'
    when p in ('🦅','falcon-engineer','falcon_engineer') then 'falcon'
  end
$$;

create or replace function public.enforce_backlog_lane_name()
returns trigger language plpgsql set search_path = '' as $$
declare lane text := public.ops_engineer_lane_name(new.engineer);
begin
  if lane is null then
    raise exception 'ops_engineer_backlog.engineer «%» is no lane: no queue would ever read this row. Use scraping-engineer, new_listings_engineer, advanced_filter, lifecycle, repair or falcon.', new.engineer;
  end if;
  new.engineer := lane;
  return new;
end $$;

update public.ops_engineer_backlog
   set engineer = public.ops_engineer_lane_name(engineer)
 where engineer is distinct from public.ops_engineer_lane_name(engineer)
   and public.ops_engineer_lane_name(engineer) is not null;

drop trigger if exists trg_backlog_lane_name on public.ops_engineer_backlog;
create trigger trg_backlog_lane_name before insert or update of engineer on public.ops_engineer_backlog
  for each row execute function public.enforce_backlog_lane_name();

create or replace function public.enforce_engineer_run_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.report is null and new.notes is not null then
    new.report := new.notes;
  end if;
  return new;
end $$;

drop trigger if exists trg_engineer_run_row on public.ops_daily_engineer_run;
create trigger trg_engineer_run_row before insert or update on public.ops_daily_engineer_run
  for each row execute function public.enforce_engineer_run_row();

create or replace function public.record_engineer_start_from_plan()
returns trigger language plpgsql set search_path = '' as $$
declare lane text := split_part(new.phase, ':', 1);
begin
  if not exists (select 1 from public.ops_daily_engineer_run r
                  where r.phase = lane || ':start'
                    and r.run_at > new.run_at - interval '4 hours'
                    and r.run_at <= new.run_at + interval '4 hours') then
    insert into public.ops_daily_engineer_run (run_at, phase, report)
    values (new.run_at, lane || ':start', 'recorded from this run''s plan row');
  end if;
  return null;
end $$;

drop trigger if exists trg_engineer_start_from_plan on public.ops_daily_engineer_run;
create trigger trg_engineer_start_from_plan after insert on public.ops_daily_engineer_run
  for each row when (new.phase like '%:plan') execute function public.record_engineer_start_from_plan();

-- The last two days, so tonight's review and fix-rate read them correctly.
update public.ops_daily_engineer_run set report = notes
 where report is null and notes is not null and run_at > now() - interval '2 days';

insert into public.ops_daily_engineer_run (run_at, phase, report)
select p.run_at, split_part(p.phase, ':', 1) || ':start', 'recorded from this run''s plan row'
  from public.ops_daily_engineer_run p
 where p.phase like '%:plan' and p.run_at > now() - interval '2 days'
   and not exists (select 1 from public.ops_daily_engineer_run r
                    where r.phase = split_part(p.phase, ':', 1) || ':start'
                      and r.run_at > p.run_at - interval '4 hours'
                      and r.run_at <= p.run_at + interval '4 hours');

create or replace view public.ops_engineer_fix_rate as
 WITH e AS (
         SELECT DISTINCT ON ((split_part(ops_daily_engineer_run.phase, ':'::text, 1)), (ops_daily_engineer_run.run_at::date)) split_part(ops_daily_engineer_run.phase, ':'::text, 1) AS engineer,
            ops_daily_engineer_run.run_at::date AS night,
            COALESCE(ops_daily_engineer_run.issues_found, 0) AS found,
            COALESCE(ops_daily_engineer_run.issues_fixed, 0) AS claimed_fixed,
            regexp_match(ops_daily_engineer_run.report, 'fixed\s+(\d+)\s+of\s+(\d+)\s+own-lane'::text) AS own_lane
           FROM ops_daily_engineer_run
          WHERE ops_daily_engineer_run.phase ~~ '%:end'::text
          ORDER BY (split_part(ops_daily_engineer_run.phase, ':'::text, 1)), (ops_daily_engineer_run.run_at::date), ops_daily_engineer_run.run_at DESC
        ), p AS (
         SELECT split_part(ops_daily_engineer_run.phase, ':'::text, 1) AS engineer,
            ops_daily_engineer_run.run_at::date AS night,
            count(*) FILTER (WHERE COALESCE(ops_daily_engineer_run.push_ok, ops_daily_engineer_run.notes ~ '"result"\s*:\s*"PASS"'::text)) AS pass_proofs
           FROM ops_daily_engineer_run
          WHERE ops_daily_engineer_run.phase ~~ '%:proof'::text
          GROUP BY (split_part(ops_daily_engineer_run.phase, ':'::text, 1)), (ops_daily_engineer_run.run_at::date)
        ), r AS (
         SELECT e.engineer,
            e.night,
            e.found,
            e.claimed_fixed,
            e.own_lane,
            COALESCE(p.pass_proofs, 0::bigint) AS pass_proofs,
            LEAST(e.claimed_fixed::bigint, COALESCE(p.pass_proofs, 0::bigint)) AS proven_fixed
           FROM e
             LEFT JOIN p USING (engineer, night)
        )
 SELECT engineer,
    night,
    found,
    claimed_fixed,
    pass_proofs,
    proven_fixed,
    round(100.0 * proven_fixed::numeric / NULLIF(found, 0)::numeric) AS fix_rate_pct,
    round(100.0 * proven_fixed::numeric / NULLIF(found, 0)::numeric) - lag(round(100.0 * proven_fixed::numeric / NULLIF(found, 0)::numeric)) OVER (PARTITION BY engineer ORDER BY night) AS change_vs_last_night,
    claimed_fixed > pass_proofs AS over_claimed,
    own_lane[1]::integer AS own_lane_fixed,
    own_lane[2]::integer AS own_lane_found,
    round(100.0 * own_lane[1]::numeric / NULLIF(own_lane[2]::numeric, 0)) AS own_lane_pct
   FROM r;
