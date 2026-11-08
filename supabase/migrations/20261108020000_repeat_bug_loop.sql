-- 🔧 2026-11-08 — the REPEAT-BUG LOOP (owner 2026-11-07: «get repeat bugs under 20 % QUICK and fully automate it»).
-- Measured before: 804 alerts opened in 7 days, 534 of them (66 %) on a dedup_key that had an earlier row.
--  1. ops_repeat_bugs        — per kind + dedup_key over 7 days: reopens, first/last seen, owning lane, backlog item.
--     ops_repeat_rate_weekly — opened / repeats / % per ISO week, plus a rolling «last 7 d» row (🔧 QA :end line).
--  2. mon_detect_repeat_bug() on the roster — a key that reopened ≥ 3 times in 7 days (and reopened in the last 48 h,
--     or is open now) raises ONE P1 kind «repeat_bug:<kind>» (dedup «repeat_bug:<dedup_key>»), carried to the source
--     alert's owner_routine, and files ONE ops_engineer_backlog item for the owning lane if none is open.
--  3. Close-check, automatic: the P1 and the backlog item close only when that key has had 0 reopens for 48 h and
--     is not open — the detector closes both itself, with the evidence written into the item.
--  4. ops_engineer_for_alert routes «repeat_bug:<kind>» to the lane that owns <kind>.
-- The repeat_bug rows themselves are left out of the rate (honest denominator) and never watched for repeats.

create or replace view public.ops_repeat_bugs as
with h as (
  select a.id, a.kind, a.dedup_key, a.created_at, a.resolved_at, a.owner_routine,
         lag(a.id) over (partition by a.dedup_key order by a.created_at, a.id) as prev_id
    from public.alert_event a
   where a.kind not like 'repeat\_bug:%'
), k as (
  select h.kind, h.dedup_key,
         count(*) filter (where h.prev_id is not null and h.created_at > now() - interval '7 days')::int as reopens_7d,
         min(h.created_at) as first_seen,
         max(h.created_at) as last_seen,
         bool_or(h.resolved_at is null) as open_now,
         (array_agg(h.owner_routine order by h.created_at desc))[1] as owner_routine
    from h
   group by h.kind, h.dedup_key
)
select k.kind, k.dedup_key, k.reopens_7d, k.first_seen, k.last_seen, k.open_now, k.owner_routine,
       public.ops_engineer_for_alert(k.kind, k.owner_routine) as owning_lane,
       b.id as backlog_id,
       b.id is not null as backlog_open
  from k
  left join lateral (
    select x.id from public.ops_engineer_backlog x
     where x.status = 'open' and position('repeat_bug:' || k.dedup_key || ' ' in x.item) > 0
     order by x.id desc limit 1) b on true
 where k.reopens_7d > 0;

comment on view public.ops_repeat_bugs is
  'Per kind + dedup_key: reopens in the last 7 days (a reopen = a row whose dedup_key had an earlier row), first/last seen, owning lane (ops_engineer_for_alert), and the open ops_engineer_backlog item if one exists. Feeds mon_detect_repeat_bug().';

create or replace view public.ops_repeat_rate_weekly as
with h as (
  select a.created_at,
         lag(a.id) over (partition by a.dedup_key order by a.created_at, a.id) is not null as is_repeat
    from public.alert_event a
   where a.kind not like 'repeat\_bug:%'
)
select 'last 7 d'::text as period, (now() - interval '7 days')::date as week_start,
       count(*)::int as opened, count(*) filter (where is_repeat)::int as repeats,
       round(100.0 * count(*) filter (where is_repeat) / nullif(count(*), 0), 1) as repeat_pct
  from h where h.created_at > now() - interval '7 days'
union all
select 'week'::text, date_trunc('week', h.created_at)::date,
       count(*)::int, count(*) filter (where is_repeat)::int,
       round(100.0 * count(*) filter (where is_repeat) / nullif(count(*), 0), 1)
  from h where h.created_at > now() - interval '12 weeks'
 group by date_trunc('week', h.created_at);

comment on view public.ops_repeat_rate_weekly is
  'Repeat rate: share of opened alerts whose dedup_key had an earlier row. One rolling «last 7 d» row (the 🔧 QA :end line «Repeat rate: X % (7 d)») plus one row per ISO week for 12 weeks. Owner target 2026-11-07: under 20 %.';

revoke all on public.ops_repeat_bugs, public.ops_repeat_rate_weekly from public, anon, authenticated;
grant select on public.ops_repeat_bugs, public.ops_repeat_rate_weekly to service_role;

create or replace function public.mon_detect_repeat_bug()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; r record; live text[] := '{}'; v_key text; v_quiet boolean;
  c_min_reopens constant int := 3;          -- owner 2026-11-07: ≥ 3 reopens in 7 days
  c_quiet       constant interval := interval '48 hours';
begin
  for r in
    select b.*,
           (select a.id from public.alert_event a where a.dedup_key = 'repeat_bug:' || b.dedup_key
             and a.resolved_at is null order by a.created_at desc limit 1) as p1_id
      from public.ops_repeat_bugs b
  loop
    v_key := 'repeat_bug:' || r.dedup_key;
    v_quiet := not r.open_now and r.last_seen < now() - c_quiet;

    -- CLOSE-CHECK: an open repeat P1 closes only after 48 h with no reopen and the source alert not open.
    if r.p1_id is not null and v_quiet then
      update public.alert_event set resolved_at = now() where id = r.p1_id;
      update public.ops_engineer_backlog
         set status = 'done', closed_at = now(),
             evidence = 'auto-closed by mon_detect_repeat_bug(): ' || r.dedup_key || ' last reopened '
                        || to_char(r.last_seen at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC, 0 reopens for 48 h, not open now.'
       where status = 'open' and position(v_key || ' ' in item) > 0;
      continue;
    end if;

    if v_quiet or (r.p1_id is null and r.reopens_7d < c_min_reopens) then
      continue;
    end if;

    live := live || v_key;
    n := n + public.mon_raise('P1', 'repeat_bug:' || r.kind, 'monitoring', v_key,
      jsonb_build_object(
        'for', r.owning_lane, 'source_kind', r.kind, 'source_dedup_key', r.dedup_key,
        'reopens_7d', r.reopens_7d, 'first_seen', r.first_seen, 'last_seen', r.last_seen, 'open_now', r.open_now,
        'why', 'This problem has come back ' || r.reopens_7d || ' times in 7 days. Each fix so far treated the symptom; '
            || 'the cause is still there (owner 2026-11-07: repeat bugs under 20 %).',
        'action', 'Find and fix the ROOT CAUSE, with a test. Symptom fixes are rejected. If the check itself flaps '
            || '(it re-raises while nothing real changed), fix the check — debounce or a correct threshold — without hiding a real failure.',
        'closes_when', 'Automatic: 48 h without a reopen of ' || r.dedup_key || ' and it is not open. Nothing else closes this.'));
    update public.alert_event set owner_routine = coalesce(owner_routine, r.owner_routine)
     where dedup_key = v_key and resolved_at is null and r.owner_routine is not null;

    if not r.backlog_open then
      insert into public.ops_engineer_backlog (engineer, item, status)
      values (r.owning_lane,
              v_key || ' — «' || r.kind || '» reopened ' || r.reopens_7d || ' times in 7 days. ROOT CAUSE REQUIRED: '
              || 'symptom fixes are rejected. Show «48 h without reopen» to close — mon_detect_repeat_bug() closes this '
              || 'item and its P1 itself once ' || r.dedup_key || ' has had 0 reopens for 48 h.',
              'open');
    end if;
  end loop;

  -- a repeat P1 whose key fell out of the 7-day view entirely is quiet by definition: close it and its item.
  update public.ops_engineer_backlog x
     set status = 'done', closed_at = now(),
         evidence = 'auto-closed by mon_detect_repeat_bug(): no reopen of the key in 7 days.'
    from public.alert_event a
   where a.kind like 'repeat\_bug:%' and a.resolved_at is null and not (a.dedup_key = any (live))
     and not exists (select 1 from public.ops_repeat_bugs b where 'repeat_bug:' || b.dedup_key = a.dedup_key)
     and x.status = 'open' and position(a.dedup_key || ' ' in x.item) > 0;
  update public.alert_event a set resolved_at = now()
   where a.kind like 'repeat\_bug:%' and a.resolved_at is null and not (a.dedup_key = any (live))
     and not exists (select 1 from public.ops_repeat_bugs b where 'repeat_bug:' || b.dedup_key = a.dedup_key);
  return n;
end $function$;
revoke all on function public.mon_detect_repeat_bug() from public, anon, authenticated;
grant execute on function public.mon_detect_repeat_bug() to service_role;

-- Lanes: «repeat_bug:<kind>» belongs to whoever owns <kind>.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('repeat_bug:' in src) > 0 then raise notice 'ops_engineer_for_alert already routes repeat_bug'; return; end if;
  out_def := replace(src,
    E'  select case\n',
    E'  select case\n    when p_kind like ''repeat\\_bug:%'' then public.ops_engineer_for_alert(substr(p_kind, 12), p_owner_routine)\n');
  if out_def = src then raise exception 'ops_engineer_for_alert anchor not found — refusing to guess'; end if;
  execute out_def;
end $$;

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_repeat_bug' in src) > 0 then raise notice 'mon_detect_repeat_bug already on the roster'; return; end if;
  out_def := replace(src,
    E'    ''mon_detect_heartbeat_silent'',',
    E'    ''mon_detect_heartbeat_silent'',\n    ''mon_detect_repeat_bug'',');
  if out_def = src then raise exception 'roster anchor not found — refusing to guess where the entry belongs'; end if;
  execute out_def;
end $$;

-- MUTATION PROOF (rolled back): 4 rows on one key raise ONE P1 + ONE backlog item; a second sweep duplicates nothing;
-- a key with 2 reopens raises nothing; the lane follows the source kind; moving the reopens 3 days back (0 reopens
-- for 48 h) closes the P1 and the item by itself.
do $$
declare v_p1 int; v_items int; v_lane text;
begin
  begin
    insert into public.alert_event (severity, kind, platform, dedup_key, detail, created_at, resolved_at)
    select 'P2', 'run_selftest_repeat', 'selftest', '__selftest_repeat__', '{}', now() - make_interval(hours => g), now() - make_interval(hours => g) + interval '5 minutes'
      from generate_series(1, 4) g;
    insert into public.alert_event (severity, kind, platform, dedup_key, detail, created_at, resolved_at)
    select 'P2', 'run_selftest_repeat', 'selftest', '__selftest_twice__', '{}', now() - make_interval(hours => g), now() - make_interval(hours => g) + interval '5 minutes'
      from generate_series(1, 3) g;
    perform public.mon_detect_repeat_bug();
    perform public.mon_detect_repeat_bug();
    select count(*) into v_p1 from public.alert_event where dedup_key = 'repeat_bug:__selftest_repeat__' and resolved_at is null;
    select count(*), max(engineer) into v_items, v_lane from public.ops_engineer_backlog
     where status = 'open' and position('repeat_bug:__selftest_repeat__ ' in item) > 0;
    if v_p1 <> 1 or v_items <> 1 then raise exception 'PROOF: expected 1 P1 + 1 backlog item, got % + %', v_p1, v_items; end if;
    if v_lane <> 'scraping-engineer' then raise exception 'PROOF: lane % is not the source kind''s lane (run_* → scraping-engineer)', v_lane; end if;
    if public.ops_engineer_for_alert('repeat_bug:run_selftest_repeat', null) <> 'scraping-engineer' then
      raise exception 'PROOF: ops_engineer_for_alert does not route repeat_bug:<kind> to <kind>''s lane';
    end if;
    if exists (select 1 from public.alert_event where dedup_key = 'repeat_bug:__selftest_twice__') then
      raise exception 'PROOF: a key with only 2 reopens raised a repeat P1';
    end if;
    if position('mon_detect_repeat_bug' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
      raise exception 'PROOF: the detector is not on the roster';
    end if;
    update public.alert_event set created_at = created_at - interval '3 days', resolved_at = resolved_at - interval '3 days'
     where dedup_key = '__selftest_repeat__';
    perform public.mon_detect_repeat_bug();
    if exists (select 1 from public.alert_event where dedup_key = 'repeat_bug:__selftest_repeat__' and resolved_at is null)
       or exists (select 1 from public.ops_engineer_backlog where status = 'open' and position('repeat_bug:__selftest_repeat__ ' in item) > 0) then
      raise exception 'PROOF: 48 h without a reopen did not close the P1 and its backlog item';
    end if;
    raise exception '__repeat_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__repeat_selftest_rollback__' then raise; end if;
  end;
  if exists (select 1 from public.alert_event where dedup_key like '%\_\_selftest\_repeat\_\_%' or dedup_key like '%\_\_selftest\_twice\_\_%') then
    raise exception 'PROOF: selftest rows were not rolled back';
  end if;
  raise notice 'PROOF: 1 P1 + 1 item, no duplicate, 2 reopens silent, lane follows kind, 48 h quiet closes both; rolled back';
end $$;

select public.mon_detect_repeat_bug();
