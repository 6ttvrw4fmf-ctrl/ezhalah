-- THE DELIVERY CHANNEL MUST REPORT ITS OWN LIVENESS (systems-seam run 1, 2026-08-28).
--
-- What broke, and between which two systems. alert_event -> a human. Since 2026-08-26 the whole
-- delivery path is .github/workflows/alert-dispatch.yml (0 enabled ops_alert_channel rows,
-- mon_config.alert_webhook_url is NULL, github_issue_delivery='enabled'), and mon_detect_alert_delivery
-- watches it. But that detector can only ever see the SYMPTOM ON ALERT ROWS: it counts
-- delivery-eligible alerts still undispatched past a grace window. If the workflow stops running
-- entirely during a quiet spell, there are no undelivered rows to count, the detector reads green,
-- and the channel is dead with nothing saying so. That is the same shape as the 41-day P0 blackout
-- (a destination existed, so it read green) with the failure moved one layer out.
--
-- Measured this run, and this is why the gap matters rather than being theoretical. The workflow is
-- scheduled '9,39 * * * *' = 48 runs/day. Over the 61.6h to 2026-08-28T11:12Z it ran 30 times:
--   * 11.7 runs/day actual against 48 scheduled (~76% of runs never happen)
--   * essentially never at :09 or :39 -- observed minutes were :02 :13 :18 :32 :36 :37 :45 :51 :52 :55
--   * median gap 53 min; the four largest gaps were 11.3h, 11.1h, 9.4h and 5.1h
--   * consequences on real alerts: P0 id 1011 (silent_scraper_death:erapulse) took 2h47m from raise
--     to issue; P1 id 1058 (silent_partial_success:gathern) took 6h14m.
-- GitHub documents that `schedule` runs are delayed and dropped under load, so the nominal cron
-- expression is not evidence of anything. Note in passing that mon_detect_alert_delivery's own
-- comment reasons from the nominal schedule ("alert-dispatch.yml runs at :09/:39. 60 minutes is two
-- consecutive missed runs") -- that premise is false in production. This migration does NOT touch
-- that detector or its grace window: loosening a live guard to match degraded reality is exactly the
-- move the hard safety rails forbid. It adds the missing INDEPENDENT signal instead.
--
-- The fix: the channel stamps a heartbeat every time it runs, and a detector watches the heartbeat.
-- This is downstream evidence of a promise kept, not an upstream row -- the workflow can only write
-- this after its own steps have run.
--
-- THRESHOLD, and why it is 24h rather than something tighter. This detector answers "is the channel
-- DEAD", not "is it slow". The largest observed legitimate gap is 11.3h, so anything under ~12h
-- would flap on healthy-but-throttled behaviour, and a flapping P1 is how real ones get ignored. 24h
-- is comfortably past the worst observed gap while still catching the blackout class within a day.
-- The latency picture is carried in the payload for whoever reads it. WHETHER ~12 deliveries/day
-- with an 11h tail is acceptable for P0 is a product/ops decision and an OWNER input (choosing the
-- destination always was) -- this migration deliberately does not decide it, it only makes the
-- channel's silence impossible to mistake for health.

create table if not exists public.ops_alert_dispatch_heartbeat (
  id            boolean primary key default true check (id),
  last_run_at   timestamptz not null,
  filed         integer,
  closed        integer,
  acknowledged  integer,
  run_url       text
);

comment on table public.ops_alert_dispatch_heartbeat is
  'One row. Stamped by .github/workflows/alert-dispatch.yml on every run (if: always(), so a partly '
  'failed run still reports). Watched by mon_detect_alert_dispatch_silent(). This is the alert '
  'delivery channel proving it is alive independently of whether there are alerts to deliver.';

alter table public.ops_alert_dispatch_heartbeat enable row level security;
revoke all on public.ops_alert_dispatch_heartbeat from anon, authenticated;

-- Seed so the clock starts now: the workflow step that maintains this ships in the same change, and
-- if that step never lands the row goes stale within a day and the detector says so.
insert into public.ops_alert_dispatch_heartbeat (id, last_run_at)
values (true, now())
on conflict (id) do nothing;

create or replace function public.mon_detect_alert_dispatch_silent()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- See the migration header for why this is 24h and not tighter: the largest observed healthy gap
  -- is 11.3h. This asks "is the channel dead", not "is it slow". Do NOT raise this number to make a
  -- real blackout green -- if it fires, the channel genuinely stopped.
  c_silent_hours int := 24;
  v_last  timestamptz;
  v_hours numeric;
  v_open  int;
  n       int := 0;
begin
  select last_run_at into v_last from public.ops_alert_dispatch_heartbeat where id;
  select count(*) into v_open from public.alert_event where resolved_at is null;

  if v_last is null or v_last < now() - make_interval(hours => c_silent_hours) then
    v_hours := round(extract(epoch from (now() - coalesce(v_last, 'epoch'::timestamptz))) / 3600.0, 1);
    n := n + public.mon_raise('P1', 'alert_delivery', 'monitoring', 'alert_dispatch_silent',
      jsonb_build_object(
        'last_run_at', v_last,
        'hours_since_last_run', v_hours,
        'silent_threshold_hours', c_silent_hours,
        'open_alerts', v_open,
        'why', 'The alert delivery channel (.github/workflows/alert-dispatch.yml) has not reported a '
            || 'run within the silence window. mon_detect_alert_delivery cannot see this on its own: '
            || 'it counts undelivered ALERT ROWS, so a dead dispatcher during a quiet spell leaves it '
            || 'reading green. Every alert raised while this is true reaches nobody, including this '
            || 'one -- read mon_run_all_detectors().open_alerts directly rather than trusting a quiet '
            || 'inbox.',
        'action', 'Check the Alert dispatch workflow runs for failures or a disabled schedule, and '
            || 'confirm SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are still valid Actions secrets. Do '
            || 'NOT hand-stamp ops_alert_dispatch_heartbeat and do not widen c_silent_hours.'));
  else
    perform public.mon_resolve_key('alert_delivery', 'alert_dispatch_silent');
  end if;

  return n;
end $function$;

-- Wire it into the roster IN THIS SAME MIGRATION (a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() would fire on it). Needle-edit from the LIVE function definition
-- rather than re-creating the body from a copy held here: concurrent sessions edit this roster, and
-- a full-body replace built from a stale copy silently drops their work.
do $wire$
declare
  v_def    text;
  v_anchor text := $a$    'mon_detect_alert_delivery',$a$;
  v_new    text := $a$    'mon_detect_alert_delivery',
    'mon_detect_alert_dispatch_silent',$a$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'mon_run_all_detectors'
   limit 1;

  if v_def is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to wire a detector nothing reaches';
  end if;

  if position('mon_detect_alert_dispatch_silent' in v_def) > 0 then
    raise notice 'already on the roster, nothing to do';
    return;
  end if;

  if position(v_anchor in v_def) = 0 then
    raise exception 'roster anchor not found -- the roster shape changed; re-derive the needle edit '
                    'by hand rather than guessing (refusing to leave the detector orphaned)';
  end if;

  execute replace(v_def, v_anchor, v_new);
end $wire$;

-- Prove the wiring actually took, in the same transaction that claimed to do it.
do $verify$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors' limit 1;
  if position('mon_detect_alert_dispatch_silent' in v_def) = 0 then
    raise exception 'roster edit did not take -- mon_detect_alert_dispatch_silent is not reachable';
  end if;
end $verify$;
