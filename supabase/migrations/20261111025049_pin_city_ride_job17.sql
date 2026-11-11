-- PIN CITIES RIDE THE EXISTING CITY-FIX STEP INSTEAD OF A CRON SLOT OF THEIR OWN (follow-up to 20261111021620).
--
-- 20261111021620 scheduled `pin-city-for-cityless` at :12 hourly. The cron slot rules (sql/mirrors/cron_schedule.json,
-- scripts/verify-cron-slot-discipline.ts — at most 2 jobs per (hour, minute), none inside a hog's p95 window) have NO
-- free hourly minute: every minute 1-59 was tried and each fails one rule (CodeRabbit on #11762 found it first).
-- So the job goes, and the rule runs where the other city fixes already run: refresh_listing_city_correction(), called
-- by refresh_district_recovery() in job 17 (:16 hourly, before the :22 index sync) — the same place the retired-place
-- remap was hooked on 2026-10-30. Nothing about the rule itself changes.
--
-- The alarm now watches the run it can see: every run stamps mon_mv_refresh_log('pin_city_for_cityless'), and
-- mon_detect_pin_city_cityless_unplaced() fires when that stamp is 3+ hours old, when refresh_listing_city_correction()
-- no longer calls the rule, or when a pin row is still served with no city 2 hours later.

select cron.unschedule('pin-city-for-cityless');

create or replace function public.refresh_pin_city_for_cityless(p_apply boolean default true)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions'
as $$
declare v_site_wins bigint := 0; v_dropped bigint := 0; v_added bigint := 0; v_found bigint;
begin
  create temp table if not exists _pc (source_table text, listing_id bigint, platform text, city_id integer,
                                       km_nearest numeric, km_second numeric) on commit drop;
  truncate _pc;
  insert into _pc select * from public.pin_city_for_cityless_rows();
  select count(*) into v_found from _pc;
  if p_apply then
    -- the site now names a city or region of its own → its word wins, our pin row goes
    delete from public.listing_city_correction x
     using public.listing_native_location_v1 v1
     where x.city_source = 'pin_nearest_city'
       and v1.source_table = x.source_table and v1.listing_id = x.listing_id
       and (v1.city_id is not null or v1.region_id is not null or nullif(btrim(coalesce(v1.city_ar, '')), '') is not null);
    get diagnostics v_site_wins = row_count;
    -- the ad is gone from the index (inactive / removed) → nothing to place
    delete from public.listing_city_correction x
     where x.city_source = 'pin_nearest_city'
       and not exists (select 1 from public.search_listings_ar s
                        where s.source_table = x.source_table and s.listing_id = x.listing_id);
    get diagnostics v_dropped = row_count;
    -- district_norm '' = no district from the pin (the same empty marker pin_governorate rows use)
    insert into public.listing_city_correction (source_table, listing_id, city_id, city_source, district_norm)
    select p.source_table, p.listing_id, p.city_id, 'pin_nearest_city', '' from _pc p
    on conflict (source_table, listing_id) do nothing;
    get diagnostics v_added = row_count;
    -- the run's own stamp: the alarm reads its AGE, so a run that stops happening is seen
    insert into public.mon_mv_refresh_log (object_name, refreshed_at, rows_after, note)
    select 'pin_city_for_cityless', now(), (select count(*) from public.listing_city_correction where city_source = 'pin_nearest_city'),
           format('qualifying %s, added %s, site wins %s, gone %s', v_found, v_added, v_site_wins, v_dropped)
    on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;
  end if;
  return jsonb_build_object('qualifying', v_found, 'added', v_added, 'site_now_names_a_city', v_site_wins,
                            'gone_from_index', v_dropped, 'applied', p_apply);
end $$;

revoke all on function public.refresh_pin_city_for_cityless(boolean) from public, anon, authenticated;

-- Hook into refresh_listing_city_correction(): live body, one exact edit, or fail.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.refresh_listing_city_correction'::regproc);
  if position('refresh_pin_city_for_cityless' in src) = 0 then
    src := replace(src,
      $q$  n := n + public.refresh_retired_place_remap();$q$,
      $q$  n := n + public.refresh_retired_place_remap();
  -- an ad whose site gives no city is placed by its own pin (owner 2026-11-11, 20261111021620)
  n := n + coalesce((public.refresh_pin_city_for_cityless(true) ->> 'added')::bigint, 0);$q$);
    if position('refresh_pin_city_for_cityless' in src) = 0 then
      raise exception 'could not hook refresh_pin_city_for_cityless into refresh_listing_city_correction';
    end if;
    execute src;
  end if;
end $$;

create or replace function public.mon_detect_pin_city_cityless_unplaced()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions'
as $$
declare n int := 0; v_last timestamptz; v_unserved int; v_examples jsonb; v_wired boolean;
begin
  select refreshed_at into v_last from public.mon_mv_refresh_log where object_name = 'pin_city_for_cityless';
  v_wired := position('refresh_pin_city_for_cityless' in pg_get_functiondef('public.refresh_listing_city_correction'::regproc)) > 0;
  select count(*), coalesce(jsonb_agg(jsonb_build_object('table', z.source_table, 'id', z.listing_id)) filter (where z.rn <= 5), '[]'::jsonb)
    into v_unserved, v_examples
    from (select x.source_table, x.listing_id, row_number() over (order by x.listing_id) rn
            from public.listing_city_correction x
            join public.search_listings_ar s on s.source_table = x.source_table and s.listing_id = x.listing_id
           where x.city_source = 'pin_nearest_city' and x.corrected_at < now() - interval '2 hours'
             and s.city_id is null) z;
  if not v_wired or v_last is null or v_last < now() - interval '3 hours' or v_unserved > 0 then
    n := public.mon_raise('P2', 'pin_city_cityless_unplaced', 'all', 'pin_city_cityless_unplaced',
      jsonb_build_object('wired_into_refresh_listing_city_correction', v_wired, 'last_run', v_last,
        'pin_rows_not_served', v_unserved, 'examples', v_examples,
        'why', 'ads whose site gives no city are placed by their own pin inside refresh_listing_city_correction() '
            || '(job 17, :16 hourly, then the :22 sync). Either that hook is gone, the rule has not run for 3 hours, '
            || 'or a pin row it wrote 2+ hours ago is still served with no city — so those ads stay out of search.',
        'fix', 'check job 17 in cron.job_run_details and mon_mv_refresh_log(pin_city_for_cityless); run select '
            || 'refresh_pin_city_for_cityless(true) and the next sync. Never widen the 15 km / 2x rule to clear this.'));
  else
    perform public.mon_resolve('pin_city_cityless_unplaced', 'all');
  end if;
  return n;
end $$;

revoke all on function public.mon_detect_pin_city_cityless_unplaced() from public, anon, authenticated;

-- stamp the first run now (the 65 rows already exist; this only records the run and adds any new arrivals)
select public.refresh_pin_city_for_cityless(true);
