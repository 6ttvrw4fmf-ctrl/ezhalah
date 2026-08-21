-- Paired retraction for the map_city road-name fix (rule 21: fixing the parser is half the job).
--
-- scrapers/common/normalize.map_city() matched the CITY_MAP_AR key «المدينه» inside «طريق المدينه»
-- («Madinah Road») and returned Medina. aqarcity ad 30334 (listing 4573610) publishes, in its own
-- schema.org block, addressRegion «منطقة تبوك» and addressLocality
-- «مزارع جنوب طريق المدينه (الاولى)», and its description reads «اراضي للبيع في طريق المدينة - تبوك».
-- Probed live 2026-08-21. The source names NO city -- only a farm locality on a road -- so a Tabuk
-- farm plot was served to real users in منطقة المدينة المنورة.
--
-- db._unknown_must_not_overwrite_known() deliberately refuses to let a weaker read erase a stored
-- value, so the fabricated 'Medina' would survive every future crawl with the parser already fixed
-- and every test green. This is the fourth-plus occurrence of that trap (alhoshan instalments,
-- eastabha EA21188, aqar residential areas, aqar commercial area).
--
-- Retracted to NULL, never to a value scraped from prose: rule 6 says an unverifiable name stays
-- NULL and we never guess. region ('Tabuk') is the platform's own published field and is LEFT
-- UNTOUCHED. With no resolvable city the row becomes an unlocated-fallback listing -- reachable in
-- a nationwide search, and correctly absent the moment a user filters by any location, so it can
-- never again claim to be somewhere it is not.
do $$
declare
  v_city text;
  v_region text;
  v_control_city text;
  v_before int;
  v_after int;
begin
  select city, region into v_city, v_region
    from public.aqarcity_residential_listings where id = 4573610;

  if v_city is null then
    raise notice 'already retracted; nothing to do';
    return;
  end if;

  if v_city <> 'Medina' or v_region <> 'Tabuk' then
    raise exception 'refusing to retract: expected city=Medina region=Tabuk, found city=% region=%',
      v_city, v_region;
  end if;

  -- CONTROL (rule 21): a row whose city came from a GENUINE longest-substring match must survive
  -- untouched, which is what stops a targeted retraction becoming a sweep.
  select city into v_control_city
    from public.aqarcity_residential_listings
   where city = 'Jubail' and active limit 1;

  select count(*) into v_before
    from public.aqarcity_residential_listings where city is not null;

  update public.aqarcity_residential_listings
     set city = null
   where id = 4573610 and city = 'Medina';

  select count(*) into v_after
    from public.aqarcity_residential_listings where city is not null;

  if v_before - v_after <> 1 then
    raise exception 'retraction touched % rows, expected exactly 1', v_before - v_after;
  end if;

  if v_control_city is not null
     and not exists (select 1 from public.aqarcity_residential_listings
                      where city = 'Jubail' and active) then
    raise exception 'control row lost - retraction behaved as a sweep';
  end if;

  raise notice 'retracted aqarcity 4573610 city Medina -> NULL (region Tabuk preserved); % -> % non-null cities',
    v_before, v_after;
end
$$;