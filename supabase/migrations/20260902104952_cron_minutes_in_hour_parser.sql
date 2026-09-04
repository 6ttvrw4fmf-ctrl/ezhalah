-- ATTENDANCE NEEDS A DENOMINATOR (routine #7, systems seam, 2026-09-02).
--
-- mon_detect_cron_health() has four limbs and every one of them measures FAILURE or STALENESS:
-- the last run failed, it failed twice today, last success is older than its cadence, it never
-- fired at all. A run that pg_cron simply never STARTS produces no row at all — no 'failed'
-- status for limbs 1-2, and the next period's success refreshes last_success before limb 3's
-- grace expires. So a job that silently skips a fraction of its scheduled runs is invisible to
-- the detector that exists to watch it.
--
-- Measured on this roster 2026-09-02: jobid 17 (refresh_listing_native_location_v1, '0 * * * *',
-- the matview refresh feeding location search) started 20 of its 24 due runs in 24h, skipping
-- 12:00, 23:00, 01:00 and 05:00 outright. Every run that did start succeeded, so all four limbs
-- read green. The pattern is top-of-hour contention -- every job scheduled in minutes 0-8 loses
-- runs while every job at minute >= 9 sits at 100% -- against max_worker_processes = 6.
--
-- This function is the denominator LIMB 5 needs: how many times an hourly cron schedule is DUE
-- in one hour. It parses only the minute field, and only for schedules whose hour/dom/month/dow
-- are all '*' (the caller enforces that); a daily or weekly job's attendance over 24h is 0 or 1
-- and far too noisy to threshold.
--
-- RETURNS 0 FOR ANYTHING IT DOES NOT FULLY UNDERSTAND, and the caller then skips that job rather
-- than guessing a cadence. That is deliberate: limbs 1-4 still cover such a job, so skipping
-- costs one limb of coverage, whereas guessing a denominator would invent absences and teach
-- everyone to ignore the alert.
create or replace function mon_cron_minutes_in_hour(p_schedule text)
returns int
language plpgsql
immutable
set search_path to 'public'
as $fn$
declare
  v_min   text;
  v_item  text;
  v_base  text;
  v_count int := 0;
  v_start int;
  v_end   int;
  v_step  int;
  v_hit   boolean;
  m       int;
begin
  if p_schedule is null then return 0; end if;
  v_min := split_part(btrim(p_schedule), ' ', 1);
  if v_min = '' then return 0; end if;

  -- Reject anything outside the shapes we can count exactly, rather than approximating one.
  if v_min !~ '^(\*|[0-9]+)(-[0-9]+)?(/[0-9]+)?(,(\*|[0-9]+)(-[0-9]+)?(/[0-9]+)?)*$' then
    return 0;
  end if;

  for m in 0..59 loop
    v_hit := false;
    foreach v_item in array string_to_array(v_min, ',') loop
      v_base := split_part(v_item, '/', 1);
      if position('/' in v_item) > 0 then
        v_step := nullif(split_part(v_item, '/', 2), '')::int;
      else
        v_step := 1;
      end if;
      if v_step is null or v_step < 1 then return 0; end if;

      if v_base = '*' then
        v_start := 0; v_end := 59;
      elsif position('-' in v_base) > 0 then
        v_start := split_part(v_base, '-', 1)::int;
        v_end   := split_part(v_base, '-', 2)::int;
      else
        v_start := v_base::int;
        -- a bare 'N/S' means N, N+S, ... to the end of the hour; a bare 'N' means only N
        v_end   := case when position('/' in v_item) > 0 then 59 else v_start end;
      end if;

      if v_start between 0 and 59 and v_end between 0 and 59 and v_start <= v_end
         and m between v_start and v_end and (m - v_start) % v_step = 0 then
        v_hit := true;
      end if;
    end loop;
    if v_hit then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end
$fn$;

comment on function mon_cron_minutes_in_hour(text) is
  'How many times an hourly cron minute-field is due per hour. 0 = not fully parseable; the caller skips rather than guessing. Denominator for mon_detect_cron_health LIMB 5 (attendance).';
