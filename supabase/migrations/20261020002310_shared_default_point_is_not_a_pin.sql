-- A point shared by many ads across several districts is the SITE'S DEFAULT, not any ad's pin.
--
-- Owner 2026-10-19 («every listing goes to the map»; «fix the ones we don't get a pin»). Measured
-- the same night in the served index (search_listings_ar), grouped by platform + point:
--   nofodh      24.72896,46.74363  2,556 ads / 13 districts  (the company office, from JSON-LD)
--   eaqartabuk  28.39215,36.57399    339 ads / 43 districts  (Tabuk Park Mall — the page's address)
--   sakan       24.71729,46.67530     73 ads / 12 districts  (Riyadh centre, printed with
--                                                             `show_exact_location = true`)
--   sakan       26.96257,49.56573     49 ads /  3 districts  (Dammam centre)
-- One coordinate lies in ONE district. A point tagged with three or more districts is therefore not
-- the pin of those ads; shown as a pin it puts the customer on the wrong street, and because the ad
-- "has a pin" the district-border fallback (src/data/adPageData.ts) never kicks in. A real shared
-- point — a subdivision's place link on bossbih — stays inside one district and is untouched.
--
-- Three parts, all automatic (owner: «the robot has to fix it automatically»):
--   1. shared_default_pins()        — finds such points in the served index (≥10 ads, ≥3 districts; 20261020002525 lowers the floor to 5).
--   2. strip_shared_default_pins()  — registers each point (ops_default_pin_register), removes the pair
--      from the source rows' additional_info, and attaches reject_registered_default_pin to that
--      table so the next crawl cannot write the same point back. Hourly at :15, before the :22 sync.
--   3. mon_detect_shared_default_pin() — rostered; runs the strip and raises P2 only when a registered
--      point is STILL stored at source after the strip (a pin held outside additional_info), i.e. the
--      robot could not fix it by itself.
-- Scrapers are not changed: the page shape is identical for a default and a real pin (sakan prints
-- the exact-location flag on both), so only the fleet-wide view can tell them apart.

create table if not exists public.ops_default_pin_register (
  source_table text not null,
  lat numeric(9,5) not null,
  lng numeric(9,5) not null,
  ads int not null,
  districts int not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (source_table, lat, lng)
);
comment on table public.ops_default_pin_register is
  'Points a platform prints on many ads across several districts (its default/office point). The reject trigger strips them on write; strip_shared_default_pins() fills this (owner 2026-10-19).';

create or replace function public.shared_default_pins(p_min_ads int default 10, p_min_districts int default 3)
returns table(source_table text, platform text, lat numeric, lng numeric, ads bigint, districts bigint)
language sql stable as $$
  select s.source_table, s.platform,
         round(s.latitude::numeric, 5), round(s.longitude::numeric, 5),
         count(*), count(distinct s.district_ar)
    from public.search_listings_ar s
   where s.latitude is not null and s.longitude is not null and s.district_ar is not null
   group by 1, 2, 3, 4
  having count(*) >= p_min_ads and count(distinct s.district_ar) >= p_min_districts
   order by 5 desc;
$$;

create or replace function public.tg_reject_registered_default_pin() returns trigger
language plpgsql as $$
declare v_lat text; v_lng text;
begin
  v_lat := coalesce(new.additional_info ->> 'latitude', new.additional_info ->> 'lat');
  v_lng := coalesce(new.additional_info ->> 'longitude', new.additional_info ->> 'lng');
  if v_lat ~ '^-?[0-9]+(\.[0-9]+)?$' and v_lng ~ '^-?[0-9]+(\.[0-9]+)?$'
     and exists (select 1 from public.ops_default_pin_register r
                  where r.source_table = TG_TABLE_NAME
                    and r.lat = round(v_lat::numeric, 5) and r.lng = round(v_lng::numeric, 5)) then
    new.additional_info := new.additional_info - 'latitude' - 'longitude' - 'lat' - 'lng';
  end if;
  return new;
end $$;
comment on function public.tg_reject_registered_default_pin() is
  'BEFORE INSERT/UPDATE: a pair listed in ops_default_pin_register for this table is the site''s default point, not the ad''s pin — stripped so the district-border fallback shows instead (owner 2026-10-19).';

-- Rows at a registered point still stored at source: what the strip could not remove.
create or replace function public.shared_default_pins_unfixed()
returns table(source_table text, lat numeric, lng numeric, still_stored bigint)
language plpgsql stable as $$
declare r record; n bigint;
begin
  for r in select * from public.ops_default_pin_register loop
    execute format(
      $q$select count(*) from public.%I t where t.active
           and coalesce(t.additional_info->>'latitude', t.additional_info->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
           and coalesce(t.additional_info->>'longitude', t.additional_info->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
           and round(coalesce(t.additional_info->>'latitude', t.additional_info->>'lat')::numeric, 5) = $1
           and round(coalesce(t.additional_info->>'longitude', t.additional_info->>'lng')::numeric, 5) = $2$q$,
      r.source_table) into n using r.lat, r.lng;
    if n > 0 then
      source_table := r.source_table; lat := r.lat; lng := r.lng; still_stored := n;
      return next;
    end if;
  end loop;
end $$;

create or replace function public.strip_shared_default_pins() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare r record; n int; total int := 0;
begin
  for r in select * from public.shared_default_pins() loop
    insert into public.ops_default_pin_register (source_table, lat, lng, ads, districts)
    values (r.source_table, r.lat, r.lng, r.ads, r.districts)
    on conflict (source_table, lat, lng) do update
      set ads = excluded.ads, districts = excluded.districts, last_seen_at = now();
  end loop;
  for r in select distinct g.source_table from public.ops_default_pin_register g loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = r.source_table) then
      continue;
    end if;
    if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where c.relname = r.source_table and t.tgname = 'reject_registered_default_pin') then
      execute format('create trigger reject_registered_default_pin before insert or update on public.%I
                      for each row execute function public.tg_reject_registered_default_pin()', r.source_table);
    end if;
  end loop;
  for r in select * from public.ops_default_pin_register loop
    execute format(
      $q$update public.%I t set additional_info = t.additional_info - 'latitude' - 'longitude' - 'lat' - 'lng'
          where coalesce(t.additional_info->>'latitude', t.additional_info->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
            and coalesce(t.additional_info->>'longitude', t.additional_info->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
            and round(coalesce(t.additional_info->>'latitude', t.additional_info->>'lat')::numeric, 5) = $1
            and round(coalesce(t.additional_info->>'longitude', t.additional_info->>'lng')::numeric, 5) = $2$q$,
      r.source_table) using r.lat, r.lng;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $$;
comment on function public.strip_shared_default_pins() is
  'Registers every point shared by ≥10 ads across ≥3 districts (shared_default_pins), attaches the reject trigger to that table, and removes the pair from the stored rows. Hourly at :15 (before the :22 index sync) and from the detector roster.';

create or replace function public.mon_detect_shared_default_pin() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare stripped int; v_n int := 0; sample jsonb;
begin
  stripped := public.strip_shared_default_pins();
  select count(*), jsonb_agg(jsonb_build_object('source_table', u.source_table, 'lat', u.lat, 'lng', u.lng, 'still_stored', u.still_stored))
    into v_n, sample
    from (select * from public.shared_default_pins_unfixed() limit 10) u;
  if v_n > 0 then
    perform public.mon_raise('P2', 'shared_default_pin_unfixed', 'map', 'shared_default_pin_unfixed',
      jsonb_build_object('points', v_n, 'stripped_this_run', stripped, 'sample', sample,
        'why', 'A point shared by many ads across several districts is the site''s default, not a pin (sakan/nofodh/eaqartabuk, 2026-10-19). strip_shared_default_pins() removes it from additional_info, but these rows still carry it — the pin is stored somewhere else for this table.',
        'fix', 'Find where this table''s pin is read from (listing_rich_attrs) and strip the pair there; the register row keeps the trigger refusing the point in additional_info.'));
  else
    perform public.mon_resolve_key('shared_default_pin_unfixed', 'shared_default_pin_unfixed');
  end if;
  return v_n;
end $$;

do $roster$
declare d text; anchor text := '''mon_detect_aqar_proven_wrong_resolution'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_shared_default_pin''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_shared_default_pin'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_shared_default_pin''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

select cron.unschedule(jobid) from cron.job where jobname = 'strip-shared-default-pins';
select cron.schedule('strip-shared-default-pins', '15 * * * *',
  $c$set statement_timeout to '120s'; select public.strip_shared_default_pins();$c$);

insert into public.ops_cron_ordering_contract (upstream_job, downstream_job, min_gap_minutes, why)
select 'strip-shared-default-pins', 'sync-search-listings-ar', 5,
       'The strip removes a platform''s default point from the stored rows; the :22 sync then serves those ads without a pin so the district border shows (owner 2026-10-19). Run after the sync, the default point is served for an extra hour.'
 where not exists (select 1 from public.ops_cron_ordering_contract
                    where upstream_job = 'strip-shared-default-pins' and downstream_job = 'sync-search-listings-ar');

-- SELF-TEST at apply: (1) the live finder sees the measured sakan point; (2) the strip empties it at
-- source; (3) the trigger refuses a registered point on write and lets an unregistered one through
-- (planted, rolled back).
do $proof$
declare r int; v_stripped int; v_after int; v_ai jsonb; v_id bigint;
begin
  select count(*) into r from public.shared_default_pins() where source_table = 'sakan_residential_listings' and lat = 24.71729;
  if r <> 1 then raise exception 'PROOF: the measured sakan default point is not found by shared_default_pins() (%)', r; end if;
  v_stripped := public.strip_shared_default_pins();
  if v_stripped < 100 then raise exception 'PROOF: strip removed only % rows, expected the measured sakan + eaqartabuk points', v_stripped; end if;
  select count(*) into v_after from public.shared_default_pins_unfixed();
  if v_after <> 0 then raise exception 'PROOF: % registered points still stored after the strip', v_after; end if;
  begin
    select id into v_id from public.sakan_residential_listings where active order by id limit 1;
    update public.sakan_residential_listings
       set additional_info = coalesce(additional_info, '{}'::jsonb) || '{"latitude": 24.717294174805804, "longitude": 46.675295699999985}'::jsonb
     where id = v_id;
    select additional_info into v_ai from public.sakan_residential_listings where id = v_id;
    if v_ai ? 'latitude' then raise exception 'PROOF: the trigger let the registered sakan default point through'; end if;
    update public.sakan_residential_listings
       set additional_info = coalesce(additional_info, '{}'::jsonb) || '{"latitude": 24.812345, "longitude": 46.612345}'::jsonb
     where id = v_id;
    select additional_info into v_ai from public.sakan_residential_listings where id = v_id;
    if not (v_ai ? 'latitude') then raise exception 'PROOF: the trigger stripped a point that is NOT registered'; end if;
    raise exception 'ROLLBACK_PLANT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PLANT' then raise; end if;
  end;
  raise notice 'shared_default_pin proof ok: stripped % rows', v_stripped;
end
$proof$;
