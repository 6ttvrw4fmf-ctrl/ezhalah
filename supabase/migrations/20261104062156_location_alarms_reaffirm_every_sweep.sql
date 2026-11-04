-- AN OPEN DISTRICT ALARM IS RE-AFFIRMED EVERY SWEEP, NOT FROZEN AT ITS FIRST NUMBERS (2026-11-04).
--
-- Five location detectors raised only when NO alert was open (`elsif v_open is null then r := mon_raise(...)`). Once open,
-- they never called mon_raise again, so the alert's detail stayed at the numbers of the day it opened and
-- last_affirmed_at stayed NULL — which mon_raise defines as «no detector is standing behind this alert». Measured
-- 2026-11-04: district_blank_unexplained #9964 still showed its 2026-10-18 counts (5,150 ads) with last_affirmed_at NULL,
-- source_district_dropped #12679 and served_district_not_offered #12960 likewise. A reader could not tell a live
-- condition from an abandoned one. mon_raise() already dedups (one open row per key, returns 0 when nothing escalated)
-- and refreshes detail + last_affirmed_at on the open row, so the fix is to call it on every sweep while the condition
-- holds. Resolution paths are unchanged (n = 0 → mon_resolve). Same severity per detector, so nothing re-pages.
-- Live bodies patched, the anchor must appear exactly once in each, fail closed.
do $mig$
declare
  f text;
  d text;
  a_old constant text := E'elsif v_open is null then\n    r := public.mon_raise(';
  a_new constant text := E'else  -- re-affirm every sweep (mon_raise dedups; 20261104)\n    r := public.mon_raise(';
begin
  foreach f in array array['mon_detect_unknown_named_district', 'mon_detect_district_blank_unexplained',
                           'mon_detect_source_district_dropped', 'mon_detect_served_district_not_offered',
                           'mon_detect_location_whitespace_irregular'] loop
    d := pg_get_functiondef(format('public.%I()', f)::regprocedure);
    if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1 then
      raise exception '%: raise-only-when-closed anchor not found exactly once', f;
    end if;
    execute replace(d, a_old, a_new);
    if position(a_new in pg_get_functiondef(format('public.%I()', f)::regprocedure)) = 0 then
      raise exception '%: patch did not land', f;
    end if;
  end loop;
end
$mig$;
