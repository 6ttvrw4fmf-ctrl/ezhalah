-- Section 24e: record a detector's MEASURED cost in its COMMENT ON, so a future run reads a real
-- regression as a regression instead of guessing. The previous comments carried pre-measurement
-- estimates (~15 ms / ~20 ms); these are the timed values on an idle database, 2026-09-01.
comment on function public.mon_detect_stuck_open_alert() is
  'Flags alerts that were being re-affirmed and stopped. Excludes ops_alert_kind_autoresolve kinds '
  'while inside their horizon -- a day-scoped key CANNOT be re-affirmed after midnight, so without '
  'this the detector false-positives by construction (its first and only lifetime firing, '
  '2026-08-31, was exactly that). Past the horizon the exemption lapses and the alert is flagged, '
  'because a failed auto-resolve is a real bug. Measured cost 4.3 ms (2026-09-01).';

comment on function public.mon_detect_autoresolve_kind_unregistered() is
  'Catches a detector that adopts the clock-auto-resolve pattern without declaring its kind in '
  'ops_alert_kind_autoresolve, which would silently reintroduce the stuck_open_alert false-positive '
  'class. A standing 0 is the healthy reading (section 24c). Measured cost 9.3 ms (2026-09-01).';
