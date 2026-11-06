-- district_is_own_town() asks the cheap question first (20261105085039 follow-up). Measured 09:35 UTC: the nightly's
-- pin_district_candidates() took 11.4 s and the REST call timed out (57014), because loc_display_district_ar() — ~5 ms —
-- ran for every one of ~1,800 site-named blank ads before the letters test that rejects almost all of them. Same answer,
-- the order is forced with CASE: only a name whose letters are the ad's own town (or alias to it) pays for the display test.
create or replace function public.district_is_own_town(p_city_id integer, p_raw text)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce((
    select case when public.district_key_letters(p_raw) = public.district_key_letters(c.city_ar)
                  or exists (select 1 from public.loc_district_alias a
                              where a.city_id = p_city_id and a.from_norm = public.norm_district_tok(p_raw)
                                and public.district_key_letters(a.to_norm) = public.district_key_letters(c.city_ar))
                then public.loc_display_district_ar(p_city_id, p_raw) is null
                else false end
      from public.loc_catalog_city c
     where c.city_id = p_city_id and nullif(btrim(p_raw), '') is not null), false)
$function$;

do $proof$
declare t0 timestamptz := clock_timestamp(); n int;
begin
  if not public.district_is_own_town(664, 'حي الدرعية الجديدة') or not public.district_is_own_town(5, 'الطائف')
     or public.district_is_own_town(3, 'الدرعية') or public.district_is_own_town(664, 'حي الملقاه')
     or public.district_is_own_town(664, null) then
    raise exception 'PROOF: district_is_own_town answers changed';
  end if;
  select count(*) into n from public.pin_district_candidates(1000);
  if clock_timestamp() - t0 > interval '6 seconds' then
    raise exception 'PROOF: pin_district_candidates still takes % (REST times out at 8 s)', clock_timestamp() - t0;
  end if;
  raise notice 'PROOF OK: same answers; % candidates in %', n, clock_timestamp() - t0;
end $proof$;
