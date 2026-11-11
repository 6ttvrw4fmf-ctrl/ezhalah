-- run_killed_by_timeout — A REQUEST THAT TIMED OUT IS NOT A RUN THAT WAS KILLED (2026-11-10).
--
-- WHAT WAS WRONG. The detector matched a run's notes against a list that included the bare words
-- «timed out». Those two words are also what curl prints for ONE slow request, and scrapers quote that
-- error in their notes. Measured over the last 30 days of scrape_runs: every run the bare words matched
-- (and no kill phrase did) was a request error, never a killed process —
--   fleet_liveness ×4  ok=true, 3-4 minute runs whose QUARANTINED note quotes «Connection timed out
--                      after 40002 milliseconds» for one probe (the open P1 was these);
--   muhaysini ×1       ok=false, the crawl's own exception «curl: (28) Operation timed out after 45002
--                      milliseconds» (a failed run, already an ok=false row — not a CI kill);
--   tamyaz ×2, ibaax, masar, aalbarrak, expattrusted — the same shape.
-- Every REAL kill in the same 30 days (aqar_liveness, manzo, shomou, wasalt_enum_shard, haraj, muktamel,
-- gathern_liveness, ialqarawi, sakani, fleet_liveness 10-19) carries one of the end-state phrases our own
-- code writes: «killed by SIGINT/SIGTERM before end_run() … timeout-minutes» (the signal handler) or
-- «orphaned — presumed killed (SIGKILL/OOM/lost runner…)» (the orphan reconciler).
--
-- WHAT CHANGES. The phrase test moves into mon_note_is_run_kill(), which keeps every kill phrase, drops
-- only the bare «timed out», and ADDS «runner lost» and SIGTERM — the note the gathern sweep writes when
-- it closes a run whose GitHub runner vanished did not match the old list at all. The detector proves the
-- function on canonical real notes every sweep and fails loud if it stops separating them. No threshold,
-- window or severity changes.

create or replace function public.mon_note_is_run_kill(p_notes text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(
    p_notes ~* 'SIGINT|SIGTERM|SIGKILL|killed by|presumed killed|runner lost|timeout-minutes|operation was canceled|was cancelled',
    false)
$function$;

create or replace function public.mon_detect_run_killed_by_timeout()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  -- SELF-PROOF, every sweep: real notes from production. A kill phrase must read as a kill; one
  -- request's timeout quoted inside a note, and the healthy metric "killed=0", must not.
  if    not public.mon_note_is_run_kill('killed by SIGINT before end_run() — CI job most likely hit its timeout-minutes')
     or not public.mon_note_is_run_kill('killed by SIGTERM before end_run()')
     or not public.mon_note_is_run_kill('orphaned — presumed killed (SIGKILL/OOM/lost runner): no end_run() after 12h')
     or not public.mon_note_is_run_kill('runner lost — GitHub run 42602133546 finished without end_run(); closed by the next sweep')
     or     public.mon_note_is_run_kill('QUARANTINED 1 (kept, not applied): Failed to connect: Connection timed out after 40002 milliseconds')
     or     public.mon_note_is_run_kill('Failed to perform, curl: (28) Operation timed out after 45002 milliseconds with 0 bytes received.')
     or     public.mon_note_is_run_kill('scanned=1500 alive=1490 killed=0 pruned=0 complete=True')
     or     public.mon_note_is_run_kill(null)
  then
    return public.mon_raise('P1', 'detector_discriminator_broken', 'monitoring',
      'detector_discriminator_broken:run_killed_by_timeout',
      jsonb_build_object(
        'detector', 'mon_detect_run_killed_by_timeout',
        'why', 'mon_note_is_run_kill() no longer separates a killed run''s end-state note from a note that '
            || 'only quotes one request''s timeout. Until this is fixed the detector is NOT green, it is '
            || 'unmeasured: a real CI kill may raise nothing, or every slow request may page as a kill.',
        'adjudicate', 'Restore the phrase list from the migration that created mon_note_is_run_kill(). '
            || 'Do NOT relax the assertions to make this pass.'));
  end if;

  for r in
    select split_part(platform, ':', 1) as fam,
           count(*) kills,
           count(distinct platform) shards,
           max(started_at) last_kill,
           round(max(extract(epoch from (coalesce(finished_at, now()) - started_at))/60.0)::numeric,1) worst_min
      from public.scrape_runs
     where started_at >= now() - interval '72 hours'
       -- Must be a kill PHRASE (the run's END STATE). Bare "killed" also matches the healthy metric
       -- "killed=0"; bare "timed out" also matches one request's curl error quoted in a note.
       and public.mon_note_is_run_kill(notes)
     group by 1
     order by 2 desc
  loop
    live := live || ('run_killed_by_timeout:' || r.fam);
    n := n + public.mon_raise('P1', 'run_killed_by_timeout', r.fam,
      'run_killed_by_timeout:' || r.fam,
      jsonb_build_object('kills_72h', r.kills, 'shards_affected', r.shards,
        'last_kill', r.last_kill, 'worst_minutes', r.worst_min,
        'why', 'the CI job hit its timeout budget and the process was killed. end_run() usually '
            || 'does NOT get to run, so the row is left dangling or demoted to a 0-row failure - '
            || 'which reads like "blocked or empty source" and sends the next engineer down the '
            || 'wrong path entirely.',
        'adjudicate', 'Read this WITH mon_detect_run_duration_explosion: a kill is the symptom, '
            || 'the slowdown is the cause. Never raise timeout-minutes as the fix on its own. '
            || 'Check what the killed job was holding - a shared workflow concurrency group means '
            || 'it also blocked every other source and any recovery dispatch behind it.'));
  end loop;
  perform public.mon_resolve_stale_keys('run_killed_by_timeout', live);
  return n;
end $function$;

-- APPLY-TIME CHECK: the function separates the cases, and every run the old list matched in the last
-- 30 days that the new one does not is a request-timeout note (it says «milliseconds»), never a kill.
do $$
declare lost int;
begin
  if not public.mon_note_is_run_kill('killed by SIGINT before end_run()')
     or public.mon_note_is_run_kill('Connection timed out after 40002 milliseconds') then
    raise exception 'mon_note_is_run_kill does not separate a kill from a request timeout';
  end if;
  select count(*) into lost
    from public.scrape_runs
   where started_at >= now() - interval '30 days'
     and notes ~* 'SIGINT|SIGKILL|timed out|timeout-minutes|operation was canceled|was cancelled|killed by'
     and not public.mon_note_is_run_kill(notes)
     and notes !~* 'timed out after [0-9]+ milliseconds';
  if lost > 0 then
    raise exception 'the narrowed phrase list would stop seeing % run(s) that are not request-timeout notes', lost;
  end if;
end $$;
