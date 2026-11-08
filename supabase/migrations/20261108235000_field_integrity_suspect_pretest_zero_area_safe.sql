-- 🔧 2026-11-08 (CodeRabbit Major on #11367): the suspect pre-test from 20261108221500 divides by x.area_m2 behind
-- «x.area_m2 > 0 and …». PostgreSQL does not promise to evaluate that guard first, so a zero-area row could raise
-- division_by_zero and the detector would skip the whole source table. nullif(x.area_m2, 0) makes the division safe
-- whatever the evaluation order; the guard, the threshold and every other term are unchanged.
do $m$
declare v text; n text;
  old_div constant text := $a$coalesce(x.price_annual, 0))::numeric / x.area_m2 > 500000)$a$;
  new_div constant text := $a$coalesce(x.price_annual, 0))::numeric / nullif(x.area_m2, 0) > 500000)$a$;
begin
  v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  if (length(v) - length(replace(v, old_div, ''))) / length(old_div) <> 2 then
    raise exception 'mon_detect_field_integrity: expected the suspect pre-test division exactly twice';
  end if;
  n := replace(v, old_div, new_div);
  execute n;
end
$m$;
