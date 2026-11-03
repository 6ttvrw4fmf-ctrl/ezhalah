-- THE PIN-CITY CHECK KEEPS RUNNING AND SPEAKS UP ONLY FOR WHAT IT CANNOT FIX (backlog 1166).
--  * refresh_pin_city_correction(true) runs four times a day (00:50, 04:50, 18:50, 20:50 UTC — outside the in-house
--    engineer windows) and repairs every new misfiled ad itself;
--  * each decision now keeps the city the ad's own title names after «مدينة» (title_says_city), so the detector can
--    tell a genuine conflict (pin outside our city's governorate AND the title naming a different city, yet no single
--    city could be proven) from a metro ad whose pin merely crosses a governorate line;
--  * mon_detect_city_pin_mismatch() raises P2 when the check has gone silent (> 8 h without a decision pass) and P3
--    when unresolved title conflicts exist; it resolves itself when both are clear. Roster entry in the same migration.
alter table public.listing_city_pin_evidence add column if not exists title_says_city text;

do $mig$
declare
  d text := pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure);
  a_old constant text := $o$     district_basis, title_word, pin_lat, pin_lon, pin_gov_ar, own_gov_ar, decided_at)$o$;
  a_new constant text := $n$     district_basis, title_word, title_says_city, pin_lat, pin_lon, pin_gov_ar, own_gov_ar, decided_at)$n$;
  b_old constant text := $o$         f.city_id, f.city_ar, k.city_id, k.city_ar, d.district_norm, d.basis, k.word,
         f.lat,$o$;
  b_new constant text := $n$         f.city_id, f.city_ar, k.city_id, k.city_ar, d.district_norm, d.basis, k.word,
         (select btrim(substring(x.txt from ' مدينه ((?:[ء-ي]+ )?[ء-ي]+) ')) from _txt x
           where x.source_table = f.source_table and x.listing_id = f.listing_id),
         f.lat,$n$;
  c_old constant text := $o$    district_basis = excluded.district_basis, title_word = excluded.title_word, pin_lat = excluded.pin_lat,$o$;
  c_new constant text := $n$    district_basis = excluded.district_basis, title_word = excluded.title_word,
    title_says_city = excluded.title_says_city, pin_lat = excluded.pin_lat,$n$;
begin
  if position(a_old in d) = 0 or position(b_old in d) = 0 or position(c_old in d) = 0 then
    raise exception 'refresh_pin_city_correction: evidence insert not found';
  end if;
  execute replace(replace(replace(d, a_old, a_new), b_old, b_new), c_old, c_new);
  if position('title_says_city = excluded.title_says_city' in pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure)) = 0 then
    raise exception 'refresh_pin_city_correction: title_says_city patch did not land';
  end if;
end
$mig$;

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
     and e.title_says_city <> btrim(regexp_replace(normalize_ar(coalesce(e.from_city_ar, '')), '[^ء-ي]+', ' ', 'g'));
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

do $mig$
declare
  d text := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  needle constant text := 'fns text[] := array[';
begin
  if position('mon_detect_city_pin_mismatch' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, needle, ''))) / length(needle) <> 1 then
    raise exception 'mon_run_all_detectors: roster needle not found exactly once';
  end if;
  execute replace(d, needle, needle || E'\n    ''mon_detect_city_pin_mismatch'',');
  if position('mon_detect_city_pin_mismatch' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'mon_run_all_detectors: roster entry did not land';
  end if;
end
$mig$;

select cron.schedule('pin-city-correction', '50 0,4,18,20 * * *',
  $c$set statement_timeout to '900s'; select public.refresh_pin_city_correction(true)$c$);
