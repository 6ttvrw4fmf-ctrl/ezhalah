-- 🔧 2026-11-04 — THE FACADE A SOURCE STATES WITH A «*» OR IN THE OTHER WORD ORDER IS THE SAME COMPASS CORNER.
-- hajer writes its corner facades as «جنوب*غرب», «شرق*شمال», «غرب*شمال», «شرق*جنوب» (18 active ads); canon_direction_ar()
-- read none of them, so «الواجهة» could not reach the ads and their cards showed no facade (alert cross_surface_scraper_af
-- 8447, open since 2026-10-06: «the scraper is faithful and the Advanced Filter is honest — the gap is between them»).
-- Two folds in fold_direction_variants_ar(), never a platform rule: a «*», «/» or «-» between the two words is a space,
-- and an east/west word written BEFORE the north/south word is the same corner («شرق شمال» = «شمال شرق»). Controls are
-- captured BEFORE the replace and compared after it, so nothing the function already read can change.
create temp table _dir_controls on commit drop as
select x as raw, public.canon_direction_ar(x) as before_val
  from unnest(array['شمال','جنوب','شرق','غرب','شمال شرق','شمال شرقي','جنوب غرب','جنوب غربي','الشمال','شماليه','شرقية','مجهول','']) x;

create or replace function public.fold_direction_variants_ar(t text)
 returns text
 language sql
 immutable parallel safe
as $function$
  select replace(replace(replace(replace(
         replace(replace(replace(replace(
           replace(' ' || translate(coalesce(t, ''), 'ى*/-', 'ي   ') || ' ', 'يه ', 'ية '),
           ' الشمال', ' شمال'), ' الجنوب', ' جنوب'), ' الشرق', ' شرق'), ' الغرب', ' غرب'),
         -- 2026-11-04: the east/west word before the north/south word names the same corner (hajer «شرق*شمال»)
         ' شرق شمال ', ' شمال شرق '), ' غرب شمال ', ' شمال غرب '), ' شرق جنوب ', ' جنوب شرق '), ' غرب جنوب ', ' جنوب غرب ');
$function$;

do $chk$
declare r record; v text;
begin
  -- the four hajer spellings now read as their corner
  if public.canon_direction_ar('جنوب*غرب') is distinct from 'جنوب غربي' then raise exception 'جنوب*غرب → %', coalesce(public.canon_direction_ar('جنوب*غرب'),'NULL'); end if;
  if public.canon_direction_ar('شرق*شمال') is distinct from 'شمال شرقي' then raise exception 'شرق*شمال → %', coalesce(public.canon_direction_ar('شرق*شمال'),'NULL'); end if;
  if public.canon_direction_ar('غرب*شمال') is distinct from 'شمال غربي' then raise exception 'غرب*شمال → %', coalesce(public.canon_direction_ar('غرب*شمال'),'NULL'); end if;
  if public.canon_direction_ar('شرق*جنوب') is distinct from 'جنوب شرقي' then raise exception 'شرق*جنوب → %', coalesce(public.canon_direction_ar('شرق*جنوب'),'NULL'); end if;
  -- nothing the function already read has moved
  for r in select raw, before_val from _dir_controls loop
    if public.canon_direction_ar(r.raw) is distinct from r.before_val then
      raise exception 'control «%» changed: % → %', r.raw, coalesce(r.before_val,'NULL'), coalesce(public.canon_direction_ar(r.raw),'NULL');
    end if;
  end loop;
  -- the function's own selftest still passes (it raises on a failed case)
  v := public.canon_direction_selftest();
  raise notice 'canon_direction_selftest: %', v;
end
$chk$;