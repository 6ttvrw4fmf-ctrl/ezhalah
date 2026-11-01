-- SECURITY PHASE 4.1 (owner-approved plan, 2026-10-21): a scrape alarm, and an alarm for the alarm going quiet.
--
-- .github/workflows/scrape-alarm.yml runs scripts/scrape-alarm.ts hourly. It reads the API gateway logs for the past
-- hour and flags any caller that pulled a bulk-download's worth of listing rows. Each suspect is stored HERE,
-- service_role only: the address stays private, while the alert (which alert dispatch may file as a GitHub issue)
-- carries only country / city / network / device. Measured before writing the threshold (24 h to 2026-10-21): real
-- browsers stay in the hundreds of rows an hour; our own cloud sessions peak at ~27,000; no outside caller came near
-- the 50,000 bar.
--
-- A checker that stops running must not read as "nobody is scraping" (AGENTS.md, §9 of LISTING_LIVENESS.md): every
-- successful run stamps ops_scrape_alarm_heartbeat, and mon_detect_scrape_alarm_silent() raises P2 when the last stamp
-- is older than 4 hours (hourly cadence, so 3 missed runs). Seeded now, so the first real run has that same grace.
-- Rollback: remove the roster entry, drop the function and both tables.
create table if not exists public.ops_scrape_suspect (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  window_start timestamptz not null,
  ip text not null,
  country text, city text, network text, user_agent text,
  listing_rows bigint not null,
  requests bigint not null,
  top_paths jsonb
);
alter table public.ops_scrape_suspect enable row level security;
revoke all on public.ops_scrape_suspect from public, anon, authenticated;
grant select, insert on public.ops_scrape_suspect to service_role;
grant usage on sequence public.ops_scrape_suspect_id_seq to service_role;

create table if not exists public.ops_scrape_alarm_heartbeat (
  id int primary key default 1 check (id = 1),
  last_ok_at timestamptz not null,
  callers_seen int,
  suspects int,
  note text
);
alter table public.ops_scrape_alarm_heartbeat enable row level security;
revoke all on public.ops_scrape_alarm_heartbeat from public, anon, authenticated;
grant select, insert, update on public.ops_scrape_alarm_heartbeat to service_role;
insert into public.ops_scrape_alarm_heartbeat (id, last_ok_at, note) values (1, now(), 'seeded by migration: grace for the first run')
on conflict (id) do nothing;

create or replace function public.mon_detect_scrape_alarm_silent()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  last_ok timestamptz;
begin
  select last_ok_at into last_ok from public.ops_scrape_alarm_heartbeat where id = 1;
  if last_ok is null or last_ok < now() - interval '4 hours' then
    return public.mon_raise('P2', 'scrape_alarm_silent', 'all', 'scrape_alarm_silent',
      jsonb_build_object(
        'why', 'scripts/scrape-alarm.ts (hourly, .github/workflows/scrape-alarm.yml) has not completed a run in over 4 hours. '
            || 'While it is silent, nobody is watching for bulk listing downloads: silence here is NOT "no scraping".',
        'last_ok_at', last_ok,
        'adjudicate', 'Open the Scrape alarm workflow runs. A failing log query (token, API change) is a fix to the checker, never a reason to raise the threshold.'));
  end if;
  perform public.mon_resolve_key('scrape_alarm_silent', 'scrape_alarm_silent');
  return 0;
end
$fn$;
revoke all on function public.mon_detect_scrape_alarm_silent() from public, anon, authenticated;

-- Roster entry in the SAME migration (AGENTS.md: a detector outside the roster is decoration). Inserted into the live
-- definition rather than retyping it, so another session's roster edits are never overwritten. Fails closed.
do $mig$
declare
  d text := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  needle constant text := 'fns text[] := array[';
begin
  if position('mon_detect_scrape_alarm_silent' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, needle, ''))) / length(needle) <> 1 then
    raise exception 'mon_run_all_detectors: roster needle not found exactly once';
  end if;
  execute replace(d, needle, needle || E'\n    ''mon_detect_scrape_alarm_silent'',');
  if position('mon_detect_scrape_alarm_silent' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'mon_run_all_detectors: roster entry did not land';
  end if;
end
$mig$;
