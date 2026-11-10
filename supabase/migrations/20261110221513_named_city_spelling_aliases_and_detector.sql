-- A city the ad NAMES must be placed even when the site spells it another way (owner 2026-11-10:
-- «Fix all … these issues can't happen … I am trying to fully automate it»).
--
-- Measured 2026-11-10 on the served index: 15 ads were hidden (production_ready = false, no city) although each
-- one names its city — the site just writes it differently from the catalogue:
--   sirdab          «الطايف»                               7 ads  → الطائف (5). Pins read 21.22–21.34 N, 40.36–40.46 E.
--   kellerwilliams  «مدينة الملك عبد الله الاقتصادية»       8 ads  → مدينة الملك عبدالله الاقتصادية (3666). Pins 22.43–22.46 N, 39.09–39.12 E.
-- Neither written form is a catalogue city name, so neither alias can make a twin.
--
-- 1) the two aliases (loc_catalog_city_alias is read by listing_native_location_v2 and by the scrapers).
-- 2) a detector, so the next spelling the catalogue does not know reports itself instead of hiding ads quietly:
--    a hidden, unplaced ad whose named city is ONE catalogue city once the hamza seat (ئ/ؤ) and «عبد ال» are
--    folded. It only REPORTS. The fix is an alias row after reading the ads' own pins — never a looser match.

do $alias$
declare n int;
begin
  set local lock_timeout = '5s';
  if (select count(*) from public.loc_catalog_city where city_id = 5 and city_ar = 'الطائف') <> 1
     or (select count(*) from public.loc_catalog_city where city_id = 3666 and city_ar = 'مدينة الملك عبدالله الاقتصادية') <> 1 then
    raise exception 'alias targets moved: 5 الطائف / 3666 مدينة الملك عبدالله الاقتصادية';
  end if;
  if exists (select 1 from public.loc_catalog_city
              where city_norm in (public.normalize_ar('الطايف'), public.normalize_ar('مدينة الملك عبد الله الاقتصادية'))) then
    raise exception 'an alias spelling is already a catalogue city name — it would make a twin';
  end if;
  insert into public.loc_catalog_city_alias (alias_norm, city_id)
  select v.a, v.c from (values (public.normalize_ar('الطايف'), 5),
                               (public.normalize_ar('مدينة الملك عبد الله الاقتصادية'), 3666)) v(a, c)
   where not exists (select 1 from public.loc_catalog_city_alias x where x.alias_norm = v.a);
  select count(*) into n from public.loc_catalog_city_alias
   where (alias_norm, city_id) in ((public.normalize_ar('الطايف'), 5),
                                   (public.normalize_ar('مدينة الملك عبد الله الاقتصادية'), 3666));
  if n <> 2 then raise exception 'alias rows: % of 2', n; end if;
  if exists (select 1 from public.loc_catalog_city_alias group by alias_norm having count(distinct city_id) > 1) then
    raise exception 'an alias now names two catalogue cities';
  end if;
end $alias$;

-- The fold: normalize_ar, then the two spelling habits measured above. Deliberately narrow — dropping every space
-- would read «البيضاء» as «آل بيضاء», a different place.
create or replace function public.loc_city_spelling_fold(t text)
returns text language sql immutable
set search_path to 'public'
as $$
  select replace(translate(public.normalize_ar(t), 'ئؤ', 'يو'), 'عبد ال', 'عبدال')
$$;

-- The predicate, on its own so it can be executed and read: one row per (site, written city).
create or replace function public.named_city_spelling_unplaced()
returns table(platform text, city_written text, ads integer, catalogue_city_id integer, catalogue_city_ar text)
language sql stable security definer
set search_path to 'public'
as $$
  with hid as (
    select s.platform, s.city_ar, count(*)::int as ads
      from public.search_listings_ar s
     where not s.production_ready and s.city_id is null and s.city_ar is not null
     group by 1, 2),
  cat as (
    select public.loc_city_spelling_fold(c.city_ar) as f, min(c.city_id) as city_id, min(c.city_ar) as city_ar
      from public.loc_catalog_city c
     group by 1
    having count(distinct c.city_id) = 1)
  select h.platform::text, h.city_ar::text, h.ads, cat.city_id::int, cat.city_ar::text
    from hid h
    join cat on cat.f = public.loc_city_spelling_fold(h.city_ar)
   order by h.ads desc, h.platform, h.city_ar
$$;

revoke all on function public.named_city_spelling_unplaced() from public, anon, authenticated;

create or replace function public.mon_detect_named_city_spelling_unplaced()
returns integer language plpgsql security definer
set search_path to 'public'
as $$
declare n int := 0; found jsonb; total int;
begin
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb), coalesce(sum(r.ads), 0)::int
    into found, total
    from public.named_city_spelling_unplaced() r;
  if jsonb_array_length(found) > 0 then
    n := public.mon_raise('P2', 'named_city_spelling_unplaced', 'all',
      'named_city_spelling_unplaced',
      jsonb_build_object('ads_hidden', total, 'spellings', found,
        'why', 'these ads name their city, but in a spelling the catalogue does not know, so they are served '
            || 'with no city and stay out of every location search.',
        'fix', 'read the ads'' own map pins; when they sit in the catalogue city named here, add one row to '
            || 'loc_catalog_city_alias (alias_norm = normalize_ar(<the written form>), city_id). Never widen '
            || 'the fold and never place an ad by this hint alone.'));
  else
    perform public.mon_resolve('named_city_spelling_unplaced', 'all');
  end if;
  return n;
end $$;

revoke all on function public.mon_detect_named_city_spelling_unplaced() from public, anon, authenticated;

-- Roster entry in the SAME migration: read the live body, splice one name in, execute. Never a pasted body.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_named_city_spelling_unplaced' in src) = 0 then
    src := replace(src,
      $q$'mon_detect_adjudication_guard_missing',$q$,
      $q$'mon_detect_adjudication_guard_missing',
    'mon_detect_named_city_spelling_unplaced',$q$);
    if position('mon_detect_named_city_spelling_unplaced' in src) = 0 then
      raise exception 'could not splice mon_detect_named_city_spelling_unplaced into mon_run_all_detectors';
    end if;
    execute src;
  end if;
end $$;
