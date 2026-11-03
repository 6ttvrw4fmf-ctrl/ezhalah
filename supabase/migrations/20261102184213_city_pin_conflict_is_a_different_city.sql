-- mon_detect_city_pin_mismatch: title_says_city holds up to two words after «مدينة» («الرياض غرف» = «مدينة الرياض -
-- 3 غرف»), so a conflict is a title whose «مدينة …» does NOT start with the city we filed it under.
create or replace function public.mon_detect_city_pin_mismatch()
returns integer
language plpgsql
set search_path = public
as $$
declare n integer := 0; v_last timestamptz; v_conf integer;
begin
  select max(decided_at) into v_last from public.listing_city_pin_evidence;
  if v_last is null or v_last < now() - interval '8 hours' then
    n := n + public.mon_raise('P2', 'city_pin_check_silent', null, 'city_pin_check_silent',
           jsonb_build_object('last_decision', v_last, 'why',
             'refresh_pin_city_correction() has not decided anything for > 8 h: new misfiled ads are not being repaired'));
  else
    perform public.mon_resolve_key('city_pin_check_silent', 'city_pin_check_silent');
  end if;

  select count(*) into v_conf
    from public.listing_city_pin_evidence e
   where e.verdict = 'unfixable' and e.title_says_city is not null
     and position(btrim(regexp_replace(normalize_ar(coalesce(e.from_city_ar, '')), '[^ء-ي]+', ' ', 'g')) || ' '
                  in e.title_says_city || ' ') <> 1;
  if v_conf > 0 then
    n := n + public.mon_raise('P3', 'city_pin_title_conflict', null, 'city_pin_title_conflict',
           jsonb_build_object('unresolved', v_conf, 'why',
             'pin outside the filed city''s governorate and the title names another city, but no single city was provable — review listing_city_pin_evidence'));
  else
    perform public.mon_resolve_key('city_pin_title_conflict', 'city_pin_title_conflict');
  end if;
  return n;
end $$;
revoke all on function public.mon_detect_city_pin_mismatch() from public, anon, authenticated;
