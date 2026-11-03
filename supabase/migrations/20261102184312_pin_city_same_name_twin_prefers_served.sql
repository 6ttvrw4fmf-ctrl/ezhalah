-- refresh_pin_city_correction: the catalogue lists some towns twice under one name (الدرعية 664 with 1,045 served ads
-- and 828 with none), which made «مدينة الدرعية» look ambiguous and left Riyadh-filed ads pinned in محافظة الدرعية
-- unfixed. Among same-name candidates in the pin's governorate, the one that already holds more served ads wins; an
-- exact tie stays ambiguous. Live patch.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure);
  a_old constant text := $o$  -- candidate cities: in the PIN's governorate and named in the ad's own words$o$;
  a_new constant text := $n$  create temp table _served on commit drop as select city_id, count(*) n from _pin group by 1;
  -- candidate cities: in the PIN's governorate and named in the ad's own words$n$;
  b_old constant text := $o$     and length(c.city_norm) >= 3
$o$;
  b_new constant text := $n$     and length(c.city_norm) >= 3
     and not exists (select 1 from public.loc_catalog_city c2 join _cg cg2 on cg2.city_id = c2.city_id and cg2.gid = f.gid
                      where c2.city_norm = c.city_norm and c2.city_id <> c.city_id and c2.retired_at is null
                        and coalesce((select n from _served where city_id = c2.city_id), 0)
                          > coalesce((select n from _served where city_id = c.city_id), 0))
$n$;
begin
  if position(a_old in d) = 0 or position(b_old in d) = 0 then raise exception 'refresh_pin_city_correction: twin patch anchors not found'; end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
  if position('_served' in pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure)) = 0 then
    raise exception 'refresh_pin_city_correction: twin patch did not land';
  end if;
end
$mig$;
