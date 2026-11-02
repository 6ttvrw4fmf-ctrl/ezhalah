-- SECURITY PHASE 4.1 follow-up (2026-10-23): the scrape alarm's silence bar is 8 hours, not 4.
--
-- Measured 2026-10-22/23: GitHub runs the "hourly" scrape-alarm schedule only every 3-5 hours (runs at 04:48, 10:12,
-- 15:18, 20:07, 23:23 UTC), so the 4-hour bar raised scrape_alarm_silent after almost every gap and resolved it on the
-- next run: an alert that fires on normal behaviour trains people to ignore it. The alarm now catches up on every hour
-- since its last good run (scripts/scrape-alarm.ts, up to 24 h), so a 5-hour gap loses no coverage; 8 hours is past the
-- observed worst gap and well inside the 24-hour catch-up limit, so a genuinely stopped alarm is still caught with
-- coverage to spare.
-- Rollback: re-create with interval '4 hours'.
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
  if last_ok is null or last_ok < now() - interval '8 hours' then
    return public.mon_raise('P2', 'scrape_alarm_silent', 'all', 'scrape_alarm_silent',
      jsonb_build_object(
        'why', 'scripts/scrape-alarm.ts (.github/workflows/scrape-alarm.yml, GitHub runs it every 3-5 hours) has not completed a run in over 8 hours. '
            || 'Each run catches up on up to 24 hours, so coverage is lost only if this stays open past 24 hours. While it is silent, nobody is watching for bulk listing downloads: silence here is NOT "no scraping".',
        'last_ok_at', last_ok,
        'adjudicate', 'Open the Scrape alarm workflow runs. A failing log query (token, API change) is a fix to the checker, never a reason to raise the threshold.'));
  end if;
  perform public.mon_resolve_key('scrape_alarm_silent', 'scrape_alarm_silent');
  return 0;
end
$fn$;
revoke all on function public.mon_detect_scrape_alarm_silent() from public, anon, authenticated;
