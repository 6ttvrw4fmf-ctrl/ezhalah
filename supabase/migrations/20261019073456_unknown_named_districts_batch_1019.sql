-- 🆕 New Listings 10-19 (contract G, #657): the next names from the sources' own district field, measured
-- 07:35 UTC (206 names / 1,186 ads fleet-wide). Same admission rule as 20261018073107: >= 3 ads, the ad's
-- own title names the district in that city, not a town in loc_catalog_city, not a plan / direction /
-- number, not a spelling of a catalogued district.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (11, 'حي قرطبة'),          -- بريدة: muhaysini 11 + sadiqeltajer 4 («أرض للبيع في حي قرطبة, مدينة بريدة»)
    (11, 'حي الفلاح'),         -- بريدة: muhaysini 9 + sadiqeltajer 3 («دور للبيع في حي الفلاح، بريدة»)
    (11, 'حي الأمل'),          -- بريدة: muhaysini 7 («حي الأمل, مدينة بريدة, منطقة القصيم»)
    (11, 'حي جبارة'),          -- بريدة: muhaysini 6 («أرض للبيع في حي جبارة, مدينة بريدة»)
    (11, 'حي الياسمين'),       -- بريدة: muhaysini 4 («أرض للبيع في حي الياسمين, مدينة بريدة»)
    (5,  'حي أم الرصف'),       -- الطائف: muhaysini 3 + sakan 3 («شقة للبيع في حي أم الرصف، الطائف»)
    (6,  'حي الفلق الجديد'),   -- مكة: muhaysini 5 + sakan 4 («فيلا للبيع في حي الفلق الجديد، مكة»)
    (6,  'حي السنابل')         -- مكة: muhaysini 5 («شقة للبيع في السنابل، مكة»)
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), v.decision, v.why
from (values
    (6,    'حارة الباب الجديد', 'rejected', 'may be the catalogued «حي حارة الباب والشامية» — ambiguous (muhaysini 9, sakan 4)'),
    (5,    'الكدى',     'rejected', 'a sub-area the ads place inside the catalogued القراحين / المثناة («حي القراحين ( الكدى )») — not a district of its own (muhaysini 6, sakan 7)'),
    (18,   'الأصيل',    'rejected', 'sakani project label («شقة - جدة - الأصيل»), near the catalogued «حي الاصالة» — ambiguous (sakani 13)'),
    (3,    'تنال',      'rejected', 'a development name in the ad titles («هيو فلورز - تنال B201»), not a catalogued Riyadh district (wahadat 10)'),
    (1257, 'الأصالة',   'rejected', 'the ads place it in بحرة («فيلا للبيع في الأصالة، بحره 3»), not الجموم — a city-level misfiling (muhaysini 7, sakani 3)'),
    (13,   'المروج',    'rejected', 'project-only titles («مشروع: 454 - وحدة 104»), no evidence it is a Dammam district (thousand 8)'),
    (11,   'غنامة',     'rejected', 'neighbourhood field only, no title evidence; may be a village near بريدة (sadiqeltajer 6)'),
    (11,   'الجولة',    'rejected', 'neighbourhood field only, no title evidence (sadiqeltajer 6)'),
    (11,   'النازية',   'rejected', 'neighbourhood field only, no title evidence; may be a village near بريدة (sadiqeltajer 5)'),
    (11,   'البصرية',   'rejected', 'neighbourhood field only, no title evidence; may be a village near البصر (sadiqeltajer 5)'),
    (11,   'صناعية',    'rejected', 'a land-use word («industrial»), not a district name (sadiqeltajer 7)'),
    (11,   'خب',        'rejected', 'a generic prefix of several catalogued خب districts («خب الثنيان», «خب البريدي») — ambiguous (sadiqeltajer 6)'),
    (13,   'هجر',       'rejected', 'هجر is الأحساء, not a Dammam district — a city-level misfiling (muhaysini 3, sakan 3, tuba 3)'),
    (3,    'KSA',       'rejected', 'the country, not a district (rightcompound 23)'),
    (31,   'KSA',       'rejected', 'the country, not a district (rightcompound 14)'),
    (3,    'Al Malaz',  'rejected', 'English bridge key is ambiguous in الرياض (حي الملز AND حي الضباط) — scrapers/rightcompound/run.py leaves it NULL on purpose (rightcompound 11)'),
    (31,   'Rakah',     'rejected', 'English name covers two catalogued الخبر districts (الراكة الشمالية AND الجنوبية) — ambiguous (rightcompound 9)'),
    (31,   'Doha',      'rejected', 'under الخبر the site uses «Doha» for a street / the Dhahran district, not a الخبر district — ambiguous (rightcompound 8)'),
    (14,   'أبوكبير',   'variant',  'spelling of the catalogued «حي ابو كبير» — map in the muhaysini scraper, never add (7)'),
    (14,   'أبوبريقاء', 'variant',  'spelling of the catalogued «حي ابو بريقاء» — map in the muhaysini scraper, never add (6)'),
    (11,   'المريدسية', 'variant',  'spelling of the catalogued «حي المريديسية» — map in the sadiqeltajer / ashab scrapers, never add (12)')
) as v(city_id, name, decision, why)
on conflict (city_id, name_norm) do nothing;

do $$
declare k int;
begin
  select count(*) into k from public.loc_catalog_district
   where (city_id, district_norm) in ((11, public.norm_district_tok('قرطبة')), (5, public.norm_district_tok('أم الرصف')),
                                      (6, public.norm_district_tok('الفلق الجديد')));
  if k <> 3 then raise exception 'only % of 3 probe names are catalogued', k; end if;
  select count(*) into k from public.ops_district_name_decision
   where city_id = 5 and name_norm = public.norm_district_tok('الكدى');
  if k <> 1 then raise exception 'decision for الكدى not recorded'; end if;
end $$;
