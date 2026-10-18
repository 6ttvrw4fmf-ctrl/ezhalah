-- 🆕 New Listings 10-18 (contract G, #658): English district texts that are NOT districts, recorded so the
-- unknown_named_district alarm stops re-raising them. The mappable English names are mapped in the
-- rightcompound scraper in the same PR (a spelling or an English name is MAPPED, never added).
insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), 'rejected', v.why
from (values
    (3,  'King Abdullah Financial', 'compoundin/rightcompound template text on every compound page, not the compound''s district (compoundin 104, rightcompound 40)'),
    (31, 'King Abdullah Financial', 'compoundin template text on every compound page, not the compound''s district (20)'),
    (31, 'Al Khobar',               'the city''s own name, not a district (rightcompound 29, compoundin 9)'),
    (3,  'Saudi Arabia',            'the country, not a district (compoundin 7)')
) as v(city_id, name, why)
on conflict (city_id, name_norm) do nothing;

do $$
begin
  if (select count(*) from public.ops_district_name_decision
       where (city_id, name_norm) in ((3, public.norm_district_tok('King Abdullah Financial')),
                                      (31, public.norm_district_tok('Al Khobar')))) <> 2 then
    raise exception 'English decisions missing';
  end if;
end $$;