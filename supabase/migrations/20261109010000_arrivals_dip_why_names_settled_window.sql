-- 🔧 2026-11-09 (CodeRabbit on #11367): arrivals_pin_licence_coverage() now judges SETTLED arrivals (aged 5–29 h,
-- 20261108223000), but the alert's «why» still told the operator «The last 24 h», sending them to the newest
-- listings the function deliberately excludes. Text only; logic, thresholds and privileges are unchanged
-- (pg_get_functiondef + create or replace keeps the existing grants).
do $m$
declare v text;
  old_why constant text := $a$'The last 24 h of a platform''s arrivals serve$a$;
  new_why constant text := $a$'A platform''s settled arrivals (listed 5–29 h ago) serve$a$;
begin
  v := pg_get_functiondef('public.mon_detect_arrivals_pin_or_licence_dip()'::regprocedure);
  if (length(v) - length(replace(v, old_why, ''))) / length(old_why) <> 1 then
    raise exception 'mon_detect_arrivals_pin_or_licence_dip: expected the «last 24 h» why text exactly once';
  end if;
  execute replace(v, old_why, new_why);
end
$m$;
