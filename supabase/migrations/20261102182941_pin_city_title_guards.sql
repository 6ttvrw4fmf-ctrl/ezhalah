-- refresh_pin_city_correction, two guards found by sampling the dry run (backlog 1166):
--  1. a title that itself says «مدينة <our city>» keeps our city (aqar 6565146: title «مدينة الرياض», only the URL
--     breadcrumb word «حريملاء» named another town) — the ad's own words agree with how we filed it;
--  2. a word right after «حي» is a district, never a city («/جدة/شمال-جدة/حي-الرياض/» is a Jeddah district).
-- Patched on the live definition.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure);
  old_txt constant text := $o$     and position(' ' || regexp_replace(c.city_norm, '[^ء-ي]+', ' ', 'g') || ' ' in t.txt) > 0;$o$;
  new_txt constant text := $n$     and position(' ' || regexp_replace(c.city_norm, '[^ء-ي]+', ' ', 'g') || ' '
                  in regexp_replace(t.txt, ' حي [ء-ي]+(?= )', ' ', 'g')) > 0
     and position(' مدينه ' || btrim(regexp_replace(normalize_ar(f.city_ar), '[^ء-ي]+', ' ', 'g')) || ' ' in t.txt) = 0;$n$;
begin
  if position(old_txt in d) = 0 then raise exception 'refresh_pin_city_correction: candidate clause not found'; end if;
  execute replace(d, old_txt, new_txt);
  if position(' مدينه '' || btrim' in pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure)) = 0 then
    raise exception 'refresh_pin_city_correction: guard did not land';
  end if;
end
$mig$;
