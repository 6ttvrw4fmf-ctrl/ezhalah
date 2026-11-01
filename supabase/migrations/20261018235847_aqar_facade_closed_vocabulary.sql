-- 2026-10-18. aqar's facade («الواجهة») is a CLOSED choice on the source — شمال/جنوب/شرق/غرب, the four diagonals,
-- «شرق غربي»/«شمال جنوبي» (two streets) and «3 شوارع»/«4 شوارع» — but `direction` stored whatever followed the label:
-- 14 live rows held the next spec fields («جنوب شرقي غرف النوم 4 عرض الشارع 12 م …»), the seller's prose («البحرية
-- وهدوء الحدائق …») or the advertiser block with a person's name. The coordinator's decision: the field accepts only
-- the closed vocabulary. aqar_facade() keeps the vocabulary value a raw string starts with (longest first) and
-- answers NULL for anything else; the trigger writes only that, and the 14 rows are repaired to it.
set local lock_timeout = '5s';

create or replace function public.aqar_facade(v text)
returns text language sql immutable as $$
  select f
    from unnest(array['شمال شرقي', 'شمال غربي', 'جنوب شرقي', 'جنوب غربي', 'شرق غربي', 'شمال جنوبي',
                      '3 شوارع', '4 شوارع', 'شمال', 'جنوب', 'شرق', 'غرب']) with ordinality u(f, i)
   where btrim(v) = f or btrim(v) like f || ' %'
   order by i
   limit 1
$$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.trg_aqar_parse()'::regprocedure);
  if position('aqar_facade(' in src) > 0 then
    raise notice 'trg_aqar_parse already writes aqar_facade()';
    return;
  end if;
  out_def := replace(src, $a$NEW.direction       := p->>'direction';$a$,
                          $a$NEW.direction       := public.aqar_facade(p->>'direction');$a$);
  if out_def = src then
    raise exception 'trg_aqar_parse: the direction anchor was not found — refusing to guess';
  end if;
  execute out_def;
end $$;

update public.aqar_residential_listings set direction = public.aqar_facade(direction)
 where direction is not null and direction is distinct from public.aqar_facade(direction);
update public.aqar_commercial_listings set direction = public.aqar_facade(direction)
 where direction is not null and direction is distinct from public.aqar_facade(direction);

do $$
begin
  if public.aqar_facade('جنوب شرقي غرف النوم 4 عرض الشارع 12 م') is distinct from 'جنوب شرقي'
     or public.aqar_facade('3 شوارع عرض الشارع 10 م') is distinct from '3 شوارع'
     or public.aqar_facade('شمال') is distinct from 'شمال'
     or public.aqar_facade('البحرية وهدوء الحدائق') is not null
     or public.aqar_facade('شمالية على شارع عرض 10 متر') is not null then
    raise exception 'aqar_facade() does not keep exactly the closed vocabulary';
  end if;
  if exists (select 1 from public.aqar_residential_listings where direction is distinct from public.aqar_facade(direction) and direction is not null)
     or exists (select 1 from public.aqar_commercial_listings where direction is distinct from public.aqar_facade(direction) and direction is not null) then
    raise exception 'a stored direction is still outside the vocabulary';
  end if;
end $$;
