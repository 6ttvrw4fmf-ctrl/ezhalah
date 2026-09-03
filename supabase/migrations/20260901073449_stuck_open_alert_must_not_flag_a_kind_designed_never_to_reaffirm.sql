-- Data Integrity run 2026-09-01.
--
-- DEFECT. mon_detect_stuck_open_alert() flags any open alert whose last_affirmed_at is older than
-- 26h, on the premise (its own 'why' text) that "the detector that was re-affirming them every
-- sweep has stopped". That premise is FALSE for a day-scoped dedup key.
--
-- mon_detect_unverified_inactivation() raises 'unverified_inactivation:' || current_date and
-- auto-resolves the kind after 2 days. So the moment the date rolls over, the previous day's key
-- can NEVER be re-affirmed again -- a new day's breach raises a DIFFERENT key -- yet the alert
-- stays deliberately open for up to 48h. Every such alert therefore spends ~22h inside
-- stuck_open_alert's window, BY CONSTRUCTION, every single time the condition fires and clears.
-- mon_detect_mass_inactivation() carries the identical pattern.
--
-- Measured: stuck_open_alert has fired exactly ONCE in its lifetime (2026-08-31 21:29) and its
-- sole payload is unverified_inactivation:2026-08-30 -- i.e. the detector is currently 100%
-- false-positive. That is not merely noise: while its own key sits open, mon_raise() returns 0
-- for a GENUINE stuck alert at the same severity, so the true positive this barrier exists to
-- catch would raise nothing and page nobody. Same wound as sections 23a/25a, one level up.
--
-- FIX, respecting the detector's own 'do_not' (no window widening, no hand-resolving, no
-- last_affirmed_at stamping): make the cohort DISCRIMINATE. An alert whose kind declares a
-- time-based auto-resolve contract is excluded only while it is still INSIDE that horizon. Past
-- the horizon and still open, the auto-resolve genuinely failed -- that IS the bug this barrier
-- is for, and it still raises. Both directions preserved.

create table if not exists public.ops_alert_kind_autoresolve (
  kind      text primary key,
  horizon   interval not null,
  note      text not null,
  added_at  timestamptz not null default now()
);

comment on table public.ops_alert_kind_autoresolve is
  'Alert kinds whose detector deliberately holds a point-in-time alert OPEN without re-affirming '
  'it, then auto-resolves it on a clock. mon_detect_stuck_open_alert() excludes these while they '
  'are inside `horizon` -- past it they are flagged normally, because then the auto-resolve failed. '
  'Registration is enforced by mon_detect_autoresolve_kind_unregistered(): a NEW detector using '
  'this pattern raises P2 until it is declared here, so the false-positive class cannot come back '
  'silently.';

insert into public.ops_alert_kind_autoresolve (kind, horizon, note) values
  ('unverified_inactivation', interval '2 days',
   'Day-scoped key (unverified_inactivation:<date>); mon_detect_unverified_inactivation() auto-resolves after 2 days. Cannot be re-affirmed once the date rolls over.'),
  ('mass_inactivation', interval '2 days',
   'Point-in-time event; mon_detect_mass_inactivation() auto-resolves after 2 days using the identical pattern.')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_stuck_open_alert()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  v_stale jsonb;
  v_count int;
  stale_after constant interval := interval '26 hours';
begin
  select count(*) into v_count
    from public.alert_event a
   where a.resolved_at is null
     and a.last_affirmed_at is not null
     and a.last_affirmed_at > a.created_at
     and a.last_affirmed_at < now() - stale_after
     -- A kind that is DESIGNED never to re-affirm is not "stuck" while inside its own horizon.
     and not exists (select 1 from public.ops_alert_kind_autoresolve r
                      where r.kind = a.kind and a.created_at > now() - r.horizon);

  select coalesce(jsonb_agg(jsonb_build_object(
           'alert_id', s.id, 'kind', s.kind, 'severity', s.severity,
           'dedup_key', s.dedup_key, 'created_at', s.created_at,
           'last_affirmed_at', s.last_affirmed_at,
           'hours_since_affirmed', round(extract(epoch from (now() - s.last_affirmed_at))::numeric/3600.0, 1)
         ) order by s.last_affirmed_at), '[]'::jsonb)
    into v_stale
    from (select a.* from public.alert_event a
           where a.resolved_at is null
             and a.last_affirmed_at is not null
             and a.last_affirmed_at > a.created_at
             and a.last_affirmed_at < now() - stale_after
             and not exists (select 1 from public.ops_alert_kind_autoresolve r
                              where r.kind = a.kind and a.created_at > now() - r.horizon)
           order by a.last_affirmed_at
           limit 25) s;

  if v_count > 0 then
    n := public.mon_raise('P2', 'stuck_open_alert', 'all', 'stuck_open_alert',
      jsonb_build_object(
        'count', v_count,
        'stale_after_hours', 26,
        'alerts_shown', jsonb_array_length(v_stale),
        'alerts', v_stale,
        'why', 'These alerts are OPEN, and the detector that was re-affirming them every sweep has '
            || 'stopped. Exactly one of two things is true and both are bugs: (a) the condition '
            || 'CLEARED and the detector failed to resolve the key -- so it reads as a standing '
            || 'alert forever AND, worse, mon_raise() now returns 0 for a genuine re-occurrence at '
            || 'the same severity, meaning the recurrence raises nothing and pages nobody; or '
            || '(b) the detector itself went DARK -- crashed, fell off the mon_run_all_detectors() '
            || 'roster, or is no longer reached -- and its whole bug class is unwatched. '
            || 'mon_detect_unresolvable_detector() cannot see either case: it only reads source '
            || 'text for the PRESENCE of a resolve call, not whether that call is ever reached.',
        'excluded', 'Kinds in ops_alert_kind_autoresolve are exempt ONLY while inside their declared '
            || 'horizon: they hold a point-in-time alert open on purpose and cannot re-affirm a '
            || 'day-scoped key. Past the horizon they appear here normally -- that means the '
            || 'auto-resolve itself failed, which is a real bug.',
        'adjudicate', 'For each: find the detector that raises this kind, re-evaluate its condition '
            || 'against production NOW, and confirm the detector is still on the roster and still '
            || 'running (ops_detector_timing). If the condition cleared, fix the detector so it '
            || 'calls mon_resolve_stale_keys(kind, live_keys) on its EVALUATED path, passing the '
            || 'keys that run re-affirmed -- never resolve from an early return, which is a worse '
            || 'bug than not resolving at all. If the detector went dark, that is the real finding.',
        'do_not', 'Do NOT clear this by hand-resolving the alerts, by stamping last_affirmed_at, or '
            || 'by widening the 26h window. The window already clears the ~20h '
            || 'ops_detector_last_full_run gate with margin, so a legitimately slow detector cannot '
            || 'reach it. Resolving the symptom leaves the re-occurrence still unpageable. Do NOT '
            || 'register a kind in ops_alert_kind_autoresolve to silence it either -- that table is '
            || 'only for detectors that genuinely auto-resolve on a clock.'));
  else
    perform public.mon_resolve_key('stuck_open_alert', 'stuck_open_alert');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_stuck_open_alert() is
  'Flags alerts that were being re-affirmed and stopped. Excludes ops_alert_kind_autoresolve kinds '
  'while inside their horizon -- a day-scoped key CANNOT be re-affirmed after midnight, so without '
  'this the detector false-positives by construction (its first and only lifetime firing, '
  '2026-08-31, was exactly that). Past the horizon the exemption lapses and the alert is flagged, '
  'because a failed auto-resolve is a real bug. Measured cost ~15 ms.';

-- ---------------------------------------------------------------------------------------------
-- Guard: a NEW detector adopting the clock-auto-resolve pattern must declare itself, or the
-- false-positive class returns silently. Fails LOUDLY (P2) rather than degrading to silence.
create or replace function public.mon_detect_autoresolve_kind_unregistered()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; bad jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('detector', d.proname, 'kind', d.kind,
                                               'horizon_in_code', d.horizon) order by d.proname), '[]'::jsonb)
    into bad
    from (
      select p.proname,
             (regexp_match(p.prosrc, 'resolved_at\s*=\s*now\(\)\s*where\s+kind\s*=\s*''([a-z_]+)''\s*and\s+resolved_at\s+is\s+null\s*and\s+created_at\s*<\s*now\(\)\s*-\s*interval\s*''([^'']+)''', 'i'))[1] as kind,
             (regexp_match(p.prosrc, 'resolved_at\s*=\s*now\(\)\s*where\s+kind\s*=\s*''([a-z_]+)''\s*and\s+resolved_at\s+is\s+null\s*and\s+created_at\s*<\s*now\(\)\s*-\s*interval\s*''([^'']+)''', 'i'))[2] as horizon
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'mon\_detect\_%'
    ) d
   where d.kind is not null
     and not exists (select 1 from public.ops_alert_kind_autoresolve r where r.kind = d.kind);

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P2', 'autoresolve_kind_unregistered', 'all', 'autoresolve_kind_unregistered',
      jsonb_build_object('detectors', bad, 'count', jsonb_array_length(bad),
        'why', 'This detector holds a point-in-time alert OPEN and auto-resolves it on a clock, but '
            || 'its kind is not declared in ops_alert_kind_autoresolve. mon_detect_stuck_open_alert() '
            || 'will therefore flag every one of its alerts as "stuck" for the whole window between '
            || 'the last re-affirmation and the auto-resolve -- a guaranteed false positive that also '
            || 'suppresses genuine stuck-alert detection, because mon_raise() dedups on the open key.',
        'action', 'Add the kind to ops_alert_kind_autoresolve with the SAME horizon the detector uses. '
            || 'If the detector should instead resolve on its evaluated path, fix it to call '
            || 'mon_resolve_stale_keys() and do not register it here.'));
  else
    perform public.mon_resolve_key('autoresolve_kind_unregistered', 'autoresolve_kind_unregistered');
  end if;
  return n;
end $function$;

comment on function public.mon_detect_autoresolve_kind_unregistered() is
  'Catches a detector that adopts the clock-auto-resolve pattern without declaring its kind in '
  'ops_alert_kind_autoresolve, which would silently reintroduce the stuck_open_alert false-positive '
  'class. A standing 0 is the healthy reading (section 24c). Measured cost ~20 ms.';

-- Roster: insert ONE element into the LIVE definition. Re-emitting the whole ~40-entry array from a
-- snapshot would silently drop any detector a concurrent session added (section 26).
do $roster$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to leave the new detector orphaned';
  end if;

  if position('mon_detect_autoresolve_kind_unregistered' in src) > 0 then
    raise notice 'already on the roster';
    return;
  end if;

  newsrc := replace(src,
    '''mon_detect_enumeration_incomplete'',',
    '''mon_detect_enumeration_incomplete'',' || chr(10) || '    ''mon_detect_autoresolve_kind_unregistered'',');

  if newsrc = src then
    raise exception 'roster anchor not found -- refusing to apply a no-op roster edit';
  end if;

  execute newsrc;
end $roster$;
