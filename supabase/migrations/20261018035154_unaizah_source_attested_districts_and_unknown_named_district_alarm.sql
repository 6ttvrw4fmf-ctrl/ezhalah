-- APPLIED 2026-10-18 03:51:54 UTC (owner session, DB quiet: 1 active API query). Pre-check: 24 names new, 0 already catalogued, 0 town names.
-- Owner 2026-10-17 («Ibrahim Al-Qarawi puts the district in the title but we don't capture or match it — fix the
-- ones I have and make sure we never get it again»). Measured 2026-10-17: 832 of 2,600 ialqarawi ads had no
-- district; their titles say «… بحي النزهة بعنيزة». Root cause: find_district_in_text() accepts only exact
-- loc_catalog_district names (never invents) and عنيزة's catalog lacked 21 real districts. Aqar, Deal App and
-- Al-Khaas name the same districts in عنيزة too (الروابي 31 ads, الخالدية 25, الرحاب 8, الذهبي 6, العروبة 5,
-- الراحة 4, النخيل 3), and those ads had no district either.
--
-- 1) Source-attested districts — same admission rule as 20261011133138: ≥ 3 distinct active ads name it
--    («بحي X» in the title), not a city/village name in loc_catalog_city, not a direction, plan or numbered
--    name, resolves to nothing today; spelling = the source's own form. No listing row is written here: the
--    next crawl and the hourly district recovery (:10) re-resolve through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (80, 'حي الروابي'),   -- ialqarawi 22, + aqar/dealapp/alkhaas 31
    (80, 'حي الرحاب'),    -- 20, + alkhaas 8
    (80, 'حي النخيل'),    -- 14, + alkhaas 3
    (80, 'حي القدس'),     -- 13
    (80, 'حي الراحة'),    -- 12, + alkhaas 4
    (80, 'حي الورود'),    -- 10
    (80, 'حي المربع'),    -- 10
    (80, 'حي العروبة'),   -- 9, + alkhaas 5
    (80, 'حي شيخة'),      -- 9 (+ «شيخه» 3)
    (80, 'حي الغنامية'),  -- 8
    (80, 'حي الزهور'),    -- 7
    (80, 'حي الخالدية'),  -- 7, + aqar/dealapp/alkhaas 25
    (80, 'حي الصهيل'),    -- 7
    (80, 'حي الفيضة'),    -- 5
    (80, 'حي الناصرية'),  -- 5
    (80, 'حي المصمك'),    -- 4
    (80, 'حي الرايسية'),  -- 4
    (80, 'حي الملز'),     -- 3
    (80, 'حي الذهبي'),    -- 3, + aqar 6
    (80, 'حي الغروب'),    -- 3
    (80, 'حي النزهة'),    -- 3
    (11, 'حي الليوان'),   -- بريدة, ialqarawi 3
    (11, 'حي النرجس'),    -- بريدة, muhaysini 7
    (17, 'حي الرحاب')     -- جازان, muhaysini 3
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

-- 2) Names a person decided are NOT a new district (so the alarm below does not re-raise them forever).
create table if not exists public.ops_district_name_decision (
  city_id    int  not null,
  name_norm  text not null,
  decision   text not null check (decision in ('rejected', 'variant')),
  why        text not null,
  decided_at timestamptz not null default now(),
  primary key (city_id, name_norm)
);
alter table public.ops_district_name_decision enable row level security;

insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), v.decision, v.why
from (values
    (80, 'الفرسان', 'rejected', 'also a town name in loc_catalog_city (admission rule); 42 ialqarawi ads — owner decides'),
    (80, 'الربوة', 'rejected', 'may be the catalogued «حي ربوة الحاجب» — ambiguous'),
    (80, 'الصناعية', 'rejected', 'two catalogued industrial areas (الاولى/الثانية) — ambiguous'),
    (80, 'الصناعيه', 'rejected', 'two catalogued industrial areas (الاولى/الثانية) — ambiguous'),
    (11, 'المليداء', 'rejected', 'a separate place outside بريدة (cf. «حي الميداء» excluded 20261011133138, pins 15 km out)'),
    (3677, 'الدانة', 'rejected', 'الاحساء is the governorate; its districts belong to الهفوف / المبرز'),
    (80, 'الاشرافية', 'variant', 'ialqarawi spelling of «حي الاشرفية» — mapped in scrapers/ialqarawi/run.py'),
    (80, 'الاشرافيه', 'variant', 'ialqarawi spelling of «حي الاشرفية» — mapped in scrapers/ialqarawi/run.py'),
    (80, 'اشبيليا', 'variant', 'ialqarawi spelling of «حي اشبيلية» — mapped in scrapers/ialqarawi/run.py'),
    (80, 'إشبيليا', 'variant', 'ialqarawi spelling of «حي اشبيلية» — mapped in scrapers/ialqarawi/run.py')
) as v(city_id, name, decision, why)
on conflict (city_id, name_norm) do nothing;

-- 3) The alarm that was missing: a district the AD NAMES («بحي X») that we cannot resolve, on ≥ 3 active ads
--    of one city, on any platform. mon_detect_district_resolution watches the opposite case (district known,
--    city missing), so this one sat unseen. Raised P2 → the 🔧 engineer's nightly alert read.
create or replace function public.unknown_named_districts(p_min int default 3)
returns table (platform text, city_id int, name text, ads bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare t text;
begin
  for t in
    select tt.tablename from pg_tables tt
     where tt.schemaname = 'public' and tt.tablename ~ '_(residential|commercial)_listings$'
       and (select count(*) from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = tt.tablename
               and c.column_name in ('title', 'city_id', 'district_ar', 'active')) = 4
  loop
    return query execute format($q$
      select %L::text, x.city_id, x.d, count(*)::bigint
        from (select city_id, (regexp_match(title, 'بحي\s+([ء-ي]+)'))[1] as d
                from public.%I where active and district_ar is null and city_id is not null and title ~ 'بحي\s') x
       where x.d is not null
         and x.d !~ '^(شرق|غرب|شمال|جنوب|وسط)(ي|يه|ية)?$' and x.d <> 'ابن'
         and not exists (select 1 from public.loc_catalog_district c
                          where c.city_id = x.city_id and c.district_norm = public.norm_district_tok(x.d))
         and not exists (select 1 from public.ops_district_name_decision o
                          where o.city_id = x.city_id and o.name_norm = public.norm_district_tok(x.d))
       group by 2, 3 having count(*) >= %s$q$,
      regexp_replace(t, '_(residential|commercial)_listings$', ''), t, p_min);
  end loop;
end $function$;

create or replace function public.mon_detect_unknown_named_district()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb; n_names int; n_ads bigint; v_open text; r int := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'city_id', city_id, 'name', name, 'ads', ads)
                            order by ads desc), '[]'::jsonb), count(*), coalesce(sum(ads), 0)
    into v, n_names, n_ads
    from (select platform, city_id, name, sum(ads) ads from public.unknown_named_districts(3)
           group by 1, 2, 3) u;
  select severity into v_open from public.alert_event
   where dedup_key = 'unknown_named_district' and resolved_at is null order by created_at desc limit 1;
  if n_names = 0 then
    if v_open is not null then perform public.mon_resolve('unknown_named_district', 'district_catalog'); end if;
  elsif v_open is null then
    r := public.mon_raise('P2', 'unknown_named_district', 'district_catalog', 'unknown_named_district',
      jsonb_build_object('names', n_names, 'ads', n_ads, 'top', (select jsonb_agg(e) from (select e from jsonb_array_elements(v) e limit 25) s),
        'why', 'Ads name a district («بحي X») that loc_catalog_district does not hold for their city, so they have NO district and a customer who picks it never finds them. Admit it (≥3 ads, not a town/plan/direction — see 20261011133138) or record the decision in ops_district_name_decision.'));
  end if;
  return r;
end $function$;

select cron.schedule('mon-unknown-named-district', '41 4 * * *',
  $c$set statement_timeout to '300s'; select public.mon_detect_unknown_named_district();$c$);
