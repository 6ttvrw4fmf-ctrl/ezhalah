-- QA & Repair 2026-10-06 — the district resolver's fallback also strips a «رقم N» plan number, a
-- block letter after a slash, and the listing's own city after an Arabic comma.
--
-- MEASURED (2026-10-06 13:45 UTC, every production_ready listing with no district and a source
-- neighbourhood): 8,567 rows; 579 carry one of these three suffixes; 126 of them name a district
-- that is ALREADY attested in the listing's own city once the suffix is gone, e.g.
--   «النزهة / ب» → حي النزهة · «الراشدية رقم 809 / أ» → حي الراشدية · «الفيصلية رقم 2» → حي الفيصلية
--   «العزيزية ، الهفوف رقم 741 / أ» → حي العزيزية · «جنوب الهفوف رقم 475 / ي» → حي جنوب الهفوف
-- Same class as 20261005131351 (plan number «(126/4) أ», glued city «X - الهفوف»): what is
-- stripped is a plot/plan reference or the city, never part of the district's name.
--
-- WHAT DOES NOT MOVE. The retry still goes through the attested-district lookup, so nothing is
-- invented; the digit guard still refuses a retry that keeps a number («الغسانية 2 رقم 5» → no
-- retry); the compass guard still refuses «شمال/جنوب…» alone; and the city strip still needs the
-- listing's OWN city name, now also after «،» or «,».
--
-- Applied as a server-side replace() of the two exact lines on the live definition (occurrence-
-- guarded), the same way 20260926222522 was, so no line of the ~100-line function is retyped.
do $outer$
declare
  old_def text := pg_get_functiondef('public.resolve_district_ar(integer, text)'::regprocedure);
  new_def text;
  old_plan text := $q$        v2 := regexp_replace(v, '\s*\([^)]*[0-9٠-٩][^)]*\)\s*[أابجده]?\s*$', '');$q$;
  new_plan text := $q$        v2 := regexp_replace(v, '\s*\([^)]*[0-9٠-٩][^)]*\)\s*[أابجده]?\s*$', '');
        -- 2026-10-06: «X رقم 741 / أ» (plan number) and «X / ب» (block letter after a slash)
        v2 := regexp_replace(v2, '\s*رقم\s*[0-9٠-٩][^،]*$', '');
        v2 := regexp_replace(v2, '\s*/\s*[أابجدهو]\s*$', '');$q$;
  old_city text := $q$v2 := regexp_replace(v2, '\s*[-–/]?\s*ب?' || c || '$', '');$q$;
  new_city text := $q$v2 := regexp_replace(v2, '\s*[-–/،,]*\s*ب?' || c || '$', '');$q$;
begin
  if (length(old_def) - length(replace(old_def, old_plan, ''))) / length(old_plan) <> 1 then
    raise exception 'expected exactly one plan-number line in resolve_district_ar';
  end if;
  if (length(old_def) - length(replace(old_def, old_city, ''))) / length(old_city) <> 1 then
    raise exception 'expected exactly one city-suffix line in resolve_district_ar';
  end if;
  new_def := replace(replace(old_def, old_plan, new_plan), old_city, new_city);
  execute new_def;
end
$outer$;

-- EXECUTED PROOF at apply time, both directions, against the real catalogue.
do $verify$
begin
  if public.resolve_district_ar(3677, 'النزهة / ب') is distinct from public.resolve_district_ar(3677, 'النزهة') then
    raise exception 'FIX DID NOT TAKE: «النزهة / ب» must resolve like «النزهة»';
  end if;
  if public.resolve_district_ar(3677, 'الفيصلية رقم 2') is distinct from public.resolve_district_ar(3677, 'الفيصلية') then
    raise exception 'FIX DID NOT TAKE: «الفيصلية رقم 2» must resolve like «الفيصلية»';
  end if;
  if public.resolve_district_ar(3677, 'النزهة') is null then
    raise exception 'precondition: النزهة must be attested in الاحساء';
  end if;
  if public.resolve_district_ar(3677, 'الغسانية 2 رقم 5') is not null then
    raise exception 'REGRESSION: a retry that keeps a number must not resolve';
  end if;
  if public.resolve_district_ar(80, 'غرب عنيزة') is not null then
    raise exception 'REGRESSION: a compass part of town is not a district';
  end if;
end
$verify$;
