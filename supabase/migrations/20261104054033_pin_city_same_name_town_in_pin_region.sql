-- A SAME-NAME TOWN IN THE PIN'S REGION IS A CANDIDATE (alert 12259 phasea_offregion_pick, تربه حائل 2372).
--
-- WHY. Saudi place names repeat across regions. «تربه» is a town in منطقة مكة المكرمة (2156) AND in منطقة حائل (2372,
-- proven separate 2026-11-03 from aqarcity 29743: addressRegion «منطقة حائل», geo 28.235, 42.910). aqar files every
-- «تربه» ad under its crawl facet «Turabah, Makkah» and wasalt's scraper resolves «تربة» by name alone, so 36 ads whose
-- OWN pin sits at 28.25 N 42.93 E (aqar's own URL also says «مدينة-تربة-منطقة-حائل») were served in Makkah's Turbah.
-- refresh_pin_city_correction() flagged all of them and still called them «unfixable», for two reasons that both come
-- from the towns sharing a name: (1) a title saying «مدينة <our city>» keeps our city — and «مدينة تربة» IS our city's
-- name; (2) a candidate must belong to the pin's governorate by seat or by ≥ 10 of its own pins — and 2372's homes were
-- the ones misfiled under 2156, so it had 8.
--
-- WHAT. One more candidate arm, the city-resolution invariant (city_resolution_ignores_region) applied to the pin:
-- the ad's pin is in a governorate of region R, the filed city is in another region, and region R holds EXACTLY ONE
-- live catalogue city of the SAME name → that city. Never when the ad's own words name a DIFFERENT city after «مدينة»
-- (aqar's «…, مدينة الخوير» ads under تربه stay on the owner's conflict list). Moving a row between two EXISTING catalogue
-- cities on its own pin + name is an evidence-backed repair; the catalogue is untouched. _pick still needs one candidate.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure);
  a_old constant text := $o$in t.txt) = 0;

  create temp table _pick on commit drop as$o$;
  a_new constant text := $n$in t.txt) = 0
  union all
  -- same-name town in the PIN's region (alert 12259): the filed city's own name, exactly one live city of that name in
  -- the pin's region, the filed city in another region, and the ad's words name no OTHER city after «مدينة».
  select f.source_table, f.listing_id, c.city_id, c.city_ar, 'same_name_pin_region'::text,
         regexp_replace(c.city_norm, '[^ء-ي]+', ' ', 'g')
    from _flag f
    join _txt t on t.source_table = f.source_table and t.listing_id = f.listing_id
    join public.loc_catalog_city oc on oc.city_id = f.city_id
    join (select distinct gid, region_id from _gov) g on g.gid = f.gid
    join public.loc_catalog_city c on c.city_norm = oc.city_norm and c.region_id = g.region_id
                                  and c.city_id <> f.city_id and c.retired_at is null
   where g.region_id <> oc.region_id
     and length(c.city_norm) >= 3
     and (select count(*) from public.loc_catalog_city c3
           where c3.city_norm = oc.city_norm and c3.region_id = g.region_id and c3.retired_at is null) = 1
     and (t.txt !~ ' مدينه [ء-ي]'
          or position(' مدينه ' || regexp_replace(oc.city_norm, '[^ء-ي]+', ' ', 'g') || ' ' in t.txt) > 0);

  create temp table _pick on commit drop as$n$;
begin
  if position(a_old in d) = 0 then
    raise exception 'refresh_pin_city_correction: _cand/_pick anchor not found';
  end if;
  if position('same_name_pin_region' in d) > 0 then
    raise exception 'refresh_pin_city_correction: same_name_pin_region already present';
  end if;
  execute replace(d, a_old, a_new);
  if position('same_name_pin_region' in pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure)) = 0 then
    raise exception 'refresh_pin_city_correction: same_name_pin_region patch did not land';
  end if;
end
$mig$;
