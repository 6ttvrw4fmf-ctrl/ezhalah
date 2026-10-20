-- A pin far from the city the ad itself names is not shown as a pin: the card falls back to that city's /
-- district border (owner 2026-10-20, choice «A»: «show the border of the city the ad says»).
--
-- Measured that day over the served index: ~380 pins sit more than 150 km from the median of every other
-- pin in the city written on the ad (ksaaqar 105, aqar 100, haraj 85, dealapp 75, nofodh 52, …). Worked
-- example: nofodh 741907 — the page's own address reads «المدينة الخبر · حي اليرموك» while its map frame
-- is maps?q=24.565055,46.7534986 (Riyadh, 390 km away). The two halves of the ad disagree; the owner chose
-- the half the customer reads.
--
-- Same three-part shape as 20261020002310 (shared default points), per ROW instead of per point:
--   1. far_from_city_pins()       — served pins > 150 km from their city's median (cities with ≥ 30 pins).
--   2. strip_far_from_city_pins() — registers each row + pair (ops_far_pin_register), removes the pair from
--      the row's additional_info (where every platform but wasalt keeps it), and attaches
--      reject_far_from_city_pin to that table so the next crawl cannot write the SAME pair back. A source
--      that moves the pin writes a new pair, which is judged again next hour.
--   3. mon_detect_far_from_city_pin() — rostered; runs the strip and raises P3 when a registered pair is
--      still stored (a pin kept outside additional_info), i.e. the robot could not fix it by itself.
-- Hourly at :16 — after strip-shared-default-pins (:15), before the :22 index sync.

create table if not exists public.ops_far_pin_register (
  source_table text not null,
  listing_id bigint not null,
  lat numeric(9,5) not null,
  lng numeric(9,5) not null,
  city_ar text,
  km numeric(7,1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);
comment on table public.ops_far_pin_register is
  'Rows whose stored pin is > 150 km from the city the ad names (owner 2026-10-20 «A»). The reject trigger strips the same pair on write; strip_far_from_city_pins() fills this.';

create or replace function public.far_from_city_pins(p_km numeric default 150, p_min_city_pins int default 30)
returns table(source_table text, listing_id bigint, city_ar text, lat numeric, lng numeric, km numeric)
language sql stable as $$
  with p as (
    select s.source_table, s.listing_id, s.city_ar, s.latitude::float8 la, s.longitude::float8 lo
      from public.search_listings_ar s
     where s.latitude is not null and s.longitude is not null
       and s.city_ar is not null and s.city_ar <> 'غير معروف'),
  c as (
    select p.city_ar, percentile_cont(0.5) within group (order by p.la) mla,
           percentile_cont(0.5) within group (order by p.lo) mlo
      from p group by 1 having count(*) >= p_min_city_pins)
  select p.source_table, p.listing_id, p.city_ar, round(p.la::numeric, 5), round(p.lo::numeric, 5),
         round((111.0 * sqrt(power(p.la - c.mla, 2) + power((p.lo - c.mlo) * cos(radians(c.mla)), 2)))::numeric, 1)
    from p join c using (city_ar)
   where 111.0 * sqrt(power(p.la - c.mla, 2) + power((p.lo - c.mlo) * cos(radians(c.mla)), 2)) > p_km;
$$;

create or replace function public.tg_reject_far_from_city_pin() returns trigger
language plpgsql as $$
declare v_lat text; v_lng text;
begin
  v_lat := coalesce(new.additional_info ->> 'latitude', new.additional_info ->> 'lat');
  v_lng := coalesce(new.additional_info ->> 'longitude', new.additional_info ->> 'lng');
  if v_lat ~ '^-?[0-9]+(\.[0-9]+)?$' and v_lng ~ '^-?[0-9]+(\.[0-9]+)?$'
     and exists (select 1 from public.ops_far_pin_register r
                  where r.source_table = TG_TABLE_NAME and r.listing_id = new.id
                    and r.lat = round(v_lat::numeric, 5) and r.lng = round(v_lng::numeric, 5)) then
    new.additional_info := new.additional_info - 'latitude' - 'longitude' - 'lat' - 'lng';
  end if;
  return new;
end $$;
comment on function public.tg_reject_far_from_city_pin() is
  'BEFORE INSERT/UPDATE: the exact pair registered for this row in ops_far_pin_register (> 150 km from the ad''s own city) is stripped, so the card shows the city/district border (owner 2026-10-20 «A»). A new pair passes.';

create or replace function public.far_from_city_pins_unfixed()
returns table(source_table text, still_stored bigint)
language plpgsql stable as $$
declare t record; n bigint;
begin
  for t in select distinct r.source_table from public.ops_far_pin_register r loop
    if not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.source_table and c.column_name = 'additional_info') then
      continue;
    end if;
    execute format(
      $q$select count(*) from public.%I x join public.ops_far_pin_register r
           on r.source_table = %L and r.listing_id = x.id
          where x.active
            and coalesce(x.additional_info->>'latitude', x.additional_info->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
            and round(coalesce(x.additional_info->>'latitude', x.additional_info->>'lat')::numeric, 5) = r.lat
            and round(coalesce(x.additional_info->>'longitude', x.additional_info->>'lng')::numeric, 5) = r.lng$q$,
      t.source_table, t.source_table) into n;
    if n > 0 then source_table := t.source_table; still_stored := n; return next; end if;
  end loop;
end $$;

create or replace function public.strip_far_from_city_pins() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare r record; n int; total int := 0;
begin
  for r in select * from public.far_from_city_pins() loop
    insert into public.ops_far_pin_register (source_table, listing_id, lat, lng, city_ar, km)
    values (r.source_table, r.listing_id, r.lat, r.lng, r.city_ar, r.km)
    on conflict (source_table, listing_id) do update
      set lat = excluded.lat, lng = excluded.lng, city_ar = excluded.city_ar, km = excluded.km, last_seen_at = now();
  end loop;
  for r in select distinct g.source_table from public.ops_far_pin_register g loop
    if not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = r.source_table and c.column_name = 'additional_info') then
      continue;
    end if;
    if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where c.relname = r.source_table and t.tgname = 'reject_far_from_city_pin') then
      execute format('create trigger reject_far_from_city_pin before insert or update on public.%I
                      for each row execute function public.tg_reject_far_from_city_pin()', r.source_table);
    end if;
    execute format(
      $q$update public.%I x set additional_info = x.additional_info - 'latitude' - 'longitude' - 'lat' - 'lng'
           from public.ops_far_pin_register g
          where g.source_table = %L and g.listing_id = x.id
            and coalesce(x.additional_info->>'latitude', x.additional_info->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
            and coalesce(x.additional_info->>'longitude', x.additional_info->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
            and round(coalesce(x.additional_info->>'latitude', x.additional_info->>'lat')::numeric, 5) = g.lat
            and round(coalesce(x.additional_info->>'longitude', x.additional_info->>'lng')::numeric, 5) = g.lng$q$,
      r.source_table, r.source_table);
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $$;
comment on function public.strip_far_from_city_pins() is
  'Registers every served pin > 150 km from the city the ad names (far_from_city_pins), attaches the reject trigger, and removes that pair from the row. Hourly at :16 (before the :22 sync) and from the detector roster (owner 2026-10-20 «A»).';

create or replace function public.mon_detect_far_from_city_pin() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare stripped int; v_n int := 0; sample jsonb;
begin
  stripped := public.strip_far_from_city_pins();
  select count(*), jsonb_agg(jsonb_build_object('source_table', u.source_table, 'still_stored', u.still_stored))
    into v_n, sample from (select * from public.far_from_city_pins_unfixed() limit 10) u;
  if v_n > 0 then
    perform public.mon_raise('P3', 'far_from_city_pin_unfixed', 'map', 'far_from_city_pin_unfixed',
      jsonb_build_object('tables', v_n, 'stripped_this_run', stripped, 'sample', sample,
        'why', 'A pin > 150 km from the city the ad names is shown as the city border instead (owner 2026-10-20 «A»). These rows still store the registered pair after the strip.',
        'fix', 'Find where this table keeps its pin for listing_rich_attrs and strip it there.'));
  else
    perform public.mon_resolve_key('far_from_city_pin_unfixed', 'far_from_city_pin_unfixed');
  end if;
  return v_n;
end $$;

do $roster$
declare d text; anchor text := '''mon_detect_aqar_proven_wrong_resolution'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_far_from_city_pin''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_far_from_city_pin'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_far_from_city_pin''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

select cron.unschedule(jobid) from cron.job where jobname = 'strip-far-from-city-pins';
select cron.schedule('strip-far-from-city-pins', '16 * * * *',
  $c$set statement_timeout to '180s'; select public.strip_far_from_city_pins();$c$);

insert into public.ops_cron_ordering_contract (upstream_job, downstream_job, min_gap_minutes, why)
select 'strip-far-from-city-pins', 'sync-search-listings-ar', 5,
       'The strip removes a pin > 150 km from the ad''s own city from the stored row; the :22 sync then serves that ad with the city/district border (owner 2026-10-20 «A»). Run after the sync, the far pin is served for an extra hour.'
 where not exists (select 1 from public.ops_cron_ordering_contract
                    where upstream_job = 'strip-far-from-city-pins' and downstream_job = 'sync-search-listings-ar');

-- SELF-TEST at apply: the measured nofodh row is found, the strip removes its pair, the trigger refuses the
-- same pair on write and lets a different pair through (planted, rolled back).
do $proof$
declare r int; v_stripped int; v_ai jsonb;
begin
  select count(*) into r from public.far_from_city_pins() where source_table = 'nofodh_commercial_listings' and listing_id = 13433070;
  if r <> 1 then raise exception 'PROOF: the measured nofodh row 13433070 (الخبر, pin in Riyadh) is not found (%)', r; end if;
  v_stripped := public.strip_far_from_city_pins();
  if v_stripped < 100 then raise exception 'PROOF: strip removed only % rows', v_stripped; end if;
  select additional_info into v_ai from public.nofodh_commercial_listings where id = 13433070;
  if v_ai ? 'latitude' then raise exception 'PROOF: 13433070 still carries its far pin'; end if;
  if (select count(*) from public.far_from_city_pins_unfixed()) <> 0 then raise exception 'PROOF: registered pairs still stored'; end if;
  begin
    update public.nofodh_commercial_listings
       set additional_info = coalesce(additional_info, '{}'::jsonb) || '{"latitude": 24.565055, "longitude": 46.7534986}'::jsonb
     where id = 13433070;
    select additional_info into v_ai from public.nofodh_commercial_listings where id = 13433070;
    if v_ai ? 'latitude' then raise exception 'PROOF: the trigger let the registered far pair back in'; end if;
    update public.nofodh_commercial_listings
       set additional_info = coalesce(additional_info, '{}'::jsonb) || '{"latitude": 26.2787, "longitude": 50.2083}'::jsonb
     where id = 13433070;
    select additional_info into v_ai from public.nofodh_commercial_listings where id = 13433070;
    if not (v_ai ? 'latitude') then raise exception 'PROOF: the trigger stripped a NEW pair'; end if;
    raise exception 'ROLLBACK_PLANT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PLANT' then raise; end if;
  end;
  raise notice 'far_from_city_pin proof ok: stripped % rows', v_stripped;
end
$proof$;
