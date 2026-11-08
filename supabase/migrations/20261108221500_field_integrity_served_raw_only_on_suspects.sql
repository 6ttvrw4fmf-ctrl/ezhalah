-- 🔧 2026-11-08 follow-up: a band test on a row with no price is NULL, and `NULL AND x` must still evaluate x, so the
-- served-raw helper ran on every active row (dealapp: 55,347 calls, 1.9 s vs 0.2 s). Guard it with a CASE (evaluated in
-- order) on a cheap pre-test that is a SUPERSET of both arms: price >= 100,000,000 (phone/ID bands), or price per m²
-- > 500,000 (extreme Buy > 2,000,000 and Rent > 500,000), or area > 1,000,000 m².
do $m$
declare v text; n text;
  old_call constant text := $a$and public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))$a$;
  new_call constant text := $a$and case when greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0)) >= 100000000
                                      or (x.area_m2 > 0 and greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0))::numeric / x.area_m2 > 500000)
                                      or x.area_m2::numeric > 1000000
                                 then public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))
                                 else false end$a$;
begin
  v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  if (length(v) - length(replace(v, old_call, ''))) / length(old_call) <> 2 then
    raise exception 'mon_detect_field_integrity: expected the served-raw call exactly twice';
  end if;
  n := replace(v, old_call, new_call);
  execute n;
end
$m$;
