-- The detector added by wasalt_card_licence_guard_and_arrivals is an ops function: only the service role may run it
-- (CodeRabbit on #11275; same as the sibling detectors). A new function is EXECUTE-able by PUBLIC by default.
revoke all on function public.mon_detect_wasalt_card_licence_missing() from public, anon, authenticated;
grant execute on function public.mon_detect_wasalt_card_licence_missing() to service_role;
