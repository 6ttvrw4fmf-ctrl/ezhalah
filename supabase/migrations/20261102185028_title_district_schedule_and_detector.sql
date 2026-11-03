-- NEW ADS GET THEIR TITLE DISTRICT AUTOMATICALLY, AND A STUCK ONE IS NOTICED (backlog 1165).
--  * refresh_title_district() runs every hour at :05 (cheap: only served ads with no district), just before the
--    hourly district recovery (:10) that serves its decisions through the title arm, which the index sync (:22) ships;
--  * mon_detect_title_district_unserved() raises P2 when the decider has gone silent (> 3 h) and P3 when decided
--    districts are still not on the served ad more than 3 h after the decision (the arm or the sync stopped
--    carrying them); it resolves itself when both are clear. Roster entry in the same migration.
--  * first_decided_at never moves (decided_at is refreshed every run), so "3 h after the decision" is measurable.
alter table public.listing_title_district add column if not exists first_decided_at timestamptz not null default now();
create or replace function public.mon_detect_title_district_unserved()
returns integer
language plpgsql
set search_path = public
as $$
declare n integer := 0; v_last timestamptz; v_stuck integer;
begin
  select max(decided_at) into v_last from public.listing_title_district;
  if v_last is null or v_last < now() - interval '3 hours' then
    n := n + public.mon_raise('P2', 'title_district_silent', null, 'title_district_silent',
           jsonb_build_object('last_decision', v_last, 'why', 'refresh_title_district() has not run for > 3 h: new ads keep a blank district their title names'));
  else
    perform public.mon_resolve_key('title_district_silent', 'title_district_silent');
  end if;
  select count(*) into v_stuck
    from public.listing_title_district t
    join public.search_listings_ar s on s.source_table = t.source_table and s.listing_id = t.listing_id
   where s.production_ready and (s.district_ar is null or btrim(s.district_ar) = '')
     and t.first_decided_at < now() - interval '3 hours'
     -- a pin-corrected city takes its district from that correction (listing_native_location_v2), not from recovery
     and not exists (select 1 from public.listing_city_correction x
                      where x.source_table = t.source_table and x.listing_id = t.listing_id and x.city_source = 'pin_governorate');
  if v_stuck > 0 then
    n := n + public.mon_raise('P3', 'title_district_unserved', null, 'title_district_unserved',
           jsonb_build_object('stuck', v_stuck, 'why', 'districts proven from the title are not on the served ad after 3 h — check the title arm of refresh_district_recovery_table() and the index sync'));
  else
    perform public.mon_resolve_key('title_district_unserved', 'title_district_unserved');
  end if;
  return n;
end $$;
revoke all on function public.mon_detect_title_district_unserved() from public, anon, authenticated;

do $mig$
declare
  d text := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  needle constant text := 'fns text[] := array[';
begin
  if position('mon_detect_title_district_unserved' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, needle, ''))) / length(needle) <> 1 then
    raise exception 'mon_run_all_detectors: roster needle not found exactly once';
  end if;
  execute replace(d, needle, needle || E'\n    ''mon_detect_title_district_unserved'',');
  if position('mon_detect_title_district_unserved' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then
    raise exception 'mon_run_all_detectors: roster entry did not land';
  end if;
end
$mig$;

select cron.schedule('title-district', '5 * * * *',
  $c$set statement_timeout to '300s'; select public.refresh_title_district()$c$);
