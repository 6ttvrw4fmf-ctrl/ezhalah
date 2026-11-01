-- 🔧 Quality & Repair 2026-10-12: mon_district_contradicts_source called 1,092 served districts
-- «a district the source never published». Measured: 1,080 are the SAME ضاحية هجر sub-district
-- spelled four ways («ضاحية هجر الحي التاسع» / «التاسع بضاحية هجر» / «حي هجر التاسع» /
-- «الضاحية التاسع», bossbih adds «(640/4) ب»), 10 differ only by a missing space
-- («حي الرفعةالجنوبية» vs «حي الرفعة الجنوبية»), and 2 are real (aqar 15117268 الدرعية
-- «حي الحزم» served as «حي الخالدية»; «درة الضاحية» served as «حي السويفلة»). A P1 that is 99.8%
-- spelling variants hides the two real ones (the 10-07 lesson: a detector firing on a state we
-- chose on purpose is noise; teach it the pattern, prove both directions). The view keeps its
-- columns and its normalisation; it stops reporting a pair when (a) both sides name the same hajar
-- ordinal, or (b) the two normalised tokens differ only by whitespace. A different ordinal, or a
-- different neighbourhood, still fires — proven below, in the same migration.
create or replace function public.district_hajar_ordinal(t text)
returns text
language sql
immutable
as $function$
  select case when n ~ '(هجر|الضاحيه)' then
    (regexp_match(n, '(الحادي عشر|الثاني عشر|الثالث عشر|الرابع عشر|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|التعاون)'))[1]
  end
  from (select regexp_replace(translate(lower(coalesce(t, '')), 'أإآةى', 'اااهي'), '\s+', ' ', 'g') as n) x;
$function$;

comment on function public.district_hajar_ordinal(text) is
  'The ordinal (or named) sub-district of ضاحية هجر a district string names, or NULL when the string is not about the dahiya. «ضاحية هجر الحي التاسع», «التاسع بضاحية هجر», «حي هجر التاسع» and «الضاحية التاسع» all give «التاسع». 🔧 2026-10-12.';

create or replace view public.mon_district_contradicts_source as
 select s.source_table,
    s.listing_id,
    s.platform,
    s.city_ar,
    sd.source_district_ar as source_says,
    s.district_ar as we_display
   from public.search_listings_ar s
     join public.listing_source_district_ar_fleet sd
       on sd.source_table = s.source_table and sd.listing_id = s.listing_id
  where s.district_ar is not null
    and public.norm_district_tok(s.district_ar) <> public.norm_district_tok(sd.source_district_ar)
    and position(public.norm_district_tok(s.district_ar) in public.norm_district_tok(sd.source_district_ar)) = 0
    and position(public.norm_district_tok(sd.source_district_ar) in public.norm_district_tok(s.district_ar)) = 0
    -- the same ضاحية هجر sub-district, written differently, is not a contradiction
    and not (public.district_hajar_ordinal(s.district_ar) is not null
             and public.district_hajar_ordinal(s.district_ar) = public.district_hajar_ordinal(sd.source_district_ar))
    -- two tokens that differ only by whitespace are one name
    and regexp_replace(public.norm_district_tok(s.district_ar), '\s', '', 'g')
        <> regexp_replace(public.norm_district_tok(sd.source_district_ar), '\s', '', 'g');

-- Both directions, in the migration itself: the equivalences hold, and a real difference still reads
-- as a difference. A failed assertion aborts the migration.
do $$
begin
  if public.district_hajar_ordinal('ضاحية هجر الحي التاسع') is distinct from 'التاسع'
     or public.district_hajar_ordinal('التاسع بضاحية هجر') is distinct from 'التاسع'
     or public.district_hajar_ordinal('حي هجر التاسع') is distinct from 'التاسع'
     or public.district_hajar_ordinal('الضاحية التاسع') is distinct from 'التاسع'
     or public.district_hajar_ordinal('الضاحية الحي الحادي عشر (640/4) ب') is distinct from 'الحادي عشر'
     or public.district_hajar_ordinal('ضاحية هجر(الحي الحادي عشر)') is distinct from 'الحادي عشر'
     or public.district_hajar_ordinal('التعاون بضاحية هجر') is distinct from 'التعاون'
  then raise exception 'district_hajar_ordinal: an attested spelling of the same dahiya sub-district did not canonicalise';
  end if;
  if public.district_hajar_ordinal('الضاحية الخامس') = public.district_hajar_ordinal('ضاحية هجر الحي التاسع')
  then raise exception 'district_hajar_ordinal: two different dahiya sub-districts read as one';
  end if;
  if public.district_hajar_ordinal('حي الحزم') is not null
     or public.district_hajar_ordinal('درة الضاحية') is not null
     or public.district_hajar_ordinal('حي الخالدية') is not null
  then raise exception 'district_hajar_ordinal: a non-dahiya district got an ordinal';
  end if;
  if regexp_replace(public.norm_district_tok('حي الرفعةالجنوبية'), '\s', '', 'g')
     <> regexp_replace(public.norm_district_tok('حي الرفعة الجنوبية'), '\s', '', 'g')
  then raise exception 'whitespace-only variants must compare equal';
  end if;
end $$;