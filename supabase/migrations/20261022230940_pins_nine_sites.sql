-- Pins we held but never showed (owner 2026-10-22: «check the ones we have so far … fix all the bugs»).
-- A sweep of every served ad without a pin, over every shape a pin is stored in (not only "lat"/"lng" keys),
-- found the ad's OWN map link sitting in a field no reader looked at, on 9 sites (~96 ads):
--   eilmalriyada additional_info.map_location · wslnaa additional_info.map_url (the unit's mall) ·
--   eaqartabuk additional_info.address (a Maps place link, «!3dLAT!4dLNG») · alshawaf + rawasidark the ad
--   text's «الموقع : https://maps…» · alobid the API's virtual_tour_url · azdad the API's map_url ·
--   aljassim additional_info.maps_url («LAT, LNG» with a space).
-- And october_commercial_listings had NO arm in listing_rich_attrs, so even its stored pin never reached search.
--
-- The fix is one save-time reader per table (named so it fires BEFORE the reject_* guards): when a row arrives
-- without a pin, take the first COMPLETE Saudi pair from that site's own map field (a place marker «!3d!4d»
-- first, else a Maps link with both halves ≥ 4 decimals and not cut mid-number). Office / default points are
-- removed by strip_shared_default_pins() (run at the end here, and hourly), far-from-city pins by the far
-- register — the same guards every other site has.
set local statement_timeout = '5min';

-- 1. october_commercial_listings joins listing_rich_attrs (the pattern of 20260928025341, live body + arm)
DO $do$
DECLARE base text; arm text; i int; ok boolean := false;
BEGIN
  IF position('october_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass, true)) > 0 THEN
    RAISE NOTICE 'listing_rich_attrs already carries october_commercial_listings';
  ELSE
    FOR i IN 1..20 LOOP
      BEGIN
        SET LOCAL lock_timeout = '3s';
        base := rtrim(rtrim(pg_get_viewdef('public.listing_rich_attrs'::regclass, true)), ';');
        arm := $f$
UNION ALL
 SELECT 'october_commercial_listings'::text AS source_table,
    x.id AS listing_id,
    NULL::text AS ac_type,
    NULL::text AS kitchen_status,
    NULL::text AS furnishing_level,
    NULL::smallint AS parking_count,
    NULL::text AS parking_type,
    x.rent_now_pay_later AS installment_available,
        CASE
            WHEN x.rent_now_pay_later THEN x.rent_now_pay_later_monthly::numeric
            ELSE NULL::numeric
        END AS installment_amount,
    NULL::smallint AS installment_count,
    x.separate_electricity_meter,
    x.separate_water_meter,
    x.electricity,
    x.water_supply,
    x.sanitation,
    x.balcony_terrace AS balcony,
    x.laundry_room,
    NULL::boolean AS pool,
    NULL::boolean AS gym,
    NULL::boolean AS garden,
    x.halls AS living_rooms,
    x.reception_rooms_majlis AS majlis_rooms,
    NULL::smallint AS total_floors,
    NULL::smallint AS frontage_count,
        CASE
            WHEN COALESCE(x.additional_info ->> 'latitude'::text, x.additional_info ->> 'lat'::text) ~ '^-?[0-9.]+$'::text THEN COALESCE(x.additional_info ->> 'latitude'::text, x.additional_info ->> 'lat'::text)::numeric
            ELSE NULL::numeric
        END AS latitude,
        CASE
            WHEN COALESCE(x.additional_info ->> 'longitude'::text, x.additional_info ->> 'lng'::text) ~ '^-?[0-9.]+$'::text THEN COALESCE(x.additional_info ->> 'longitude'::text, x.additional_info ->> 'lng'::text)::numeric
            ELSE NULL::numeric
        END AS longitude,
    NULL::text AS rega_license_status,
    NULLIF(btrim(COALESCE(x.zip_code, ''::text)), ''::text) AS postal_code,
    NULL::text AS deed_location_text,
    x.car_entrance,
    x.optical_fibers
   FROM october_commercial_listings x
  WHERE x.active$f$;
        EXECUTE 'CREATE OR REPLACE VIEW public.listing_rich_attrs AS ' || base || arm;
        EXECUTE 'GRANT ALL ON public.listing_rich_attrs TO postgres, anon, authenticated, service_role';
        ok := true;
        EXIT;
      EXCEPTION WHEN lock_not_available THEN
        PERFORM pg_sleep(2);
      END;
    END LOOP;
    IF NOT ok THEN
      RAISE EXCEPTION 'could not acquire ACCESS EXCLUSIVE on listing_rich_attrs after 20 short attempts; retry later';
    END IF;
  END IF;
END
$do$;

-- 2. the first COMPLETE Saudi pin in a piece of the source's own text
create or replace function public.pin_from_maps_text(p text)
returns jsonb language sql immutable set search_path to 'public' as $function$
  with a as (
    select regexp_match(coalesce(p, ''), '!3d((?:1[6-9]|2\d|3[0-2])\.\d{4,})!4d((?:3[4-9]|4\d|5[0-6])\.\d{4,})') m3,
           regexp_match(coalesce(p, ''), '(?:maps/place/|maps/search/|maps\?q=|[?&]q=|[?&]query=|[?&]ll=|/@)((?:1[6-9]|2\d|3[0-2])\.\d{4,})\s*(?:,|%2C)\s*((?:3[4-9]|4\d|5[0-6])\.\d{4,})(?![0-9.])') ml)
  select case when m3 is not null then jsonb_build_object('latitude', m3[1]::numeric, 'longitude', m3[2]::numeric)
              when ml is not null then jsonb_build_object('latitude', ml[1]::numeric, 'longitude', ml[2]::numeric) end
    from a
$function$;

-- 3. the save-time reader: TG_ARGV names where THIS site keeps its own map ('description', 'ai:<key>', 'sc:<key>')
create or replace function public.tg_pin_from_source_link()
returns trigger language plpgsql set search_path to 'public' as $function$
declare f text; src text; p jsonb;
begin
  if new.additional_info is not null and jsonb_typeof(new.additional_info) = 'object'
     and (new.additional_info ? 'latitude' or new.additional_info ? 'lat') then
    return new;
  end if;
  foreach f in array TG_ARGV loop
    src := case
      when f = 'description' then new.description
      when f like 'ai:%' and jsonb_typeof(new.additional_info) = 'object' then new.additional_info ->> substr(f, 4)
      when f like 'sc:%' then (regexp_match(coalesce(new.source_capture::text, ''), '"' || substr(f, 4) || '"\s*:\s*"([^"]+)"'))[1]
    end;
    p := public.pin_from_maps_text(src);
    exit when p is not null;
  end loop;
  if p is null then return new; end if;
  if new.additional_info is null then new.additional_info := p;
  elsif jsonb_typeof(new.additional_info) = 'array' then new.additional_info := jsonb_build_object('rows', new.additional_info) || p;
  else new.additional_info := new.additional_info || p;
  end if;
  return new;
end
$function$;

do $t$
declare r record;
begin
  for r in select * from (values
      ('eilmalriyada_residential_listings', 'ai:map_location'), ('eilmalriyada_commercial_listings', 'ai:map_location'),
      ('wslnaa_residential_listings', 'ai:map_url'), ('wslnaa_commercial_listings', 'ai:map_url'),
      ('eaqartabuk_residential_listings', 'ai:address'), ('eaqartabuk_commercial_listings', 'ai:address'),
      ('alshawaf_residential_listings', 'description'), ('alshawaf_commercial_listings', 'description'),
      ('rawasidark_residential_listings', 'description'), ('rawasidark_commercial_listings', 'description'),
      ('alobid_residential_listings', 'sc:virtual_tour_url'), ('alobid_commercial_listings', 'sc:virtual_tour_url'),
      ('azdad_residential_listings', 'sc:map_url'), ('azdad_commercial_listings', 'sc:map_url'),
      ('aljassim_residential_listings', 'ai:maps_url'), ('aljassim_commercial_listings', 'ai:maps_url')) v(tbl, arg) loop
    execute format('drop trigger if exists pin_from_source_link on public.%I', r.tbl);
    execute format('create trigger pin_from_source_link before insert or update on public.%I for each row execute function public.tg_pin_from_source_link(%L)', r.tbl, r.arg);
    -- 4. the ads already stored: re-save the ones with no pin, so the reader runs on them
    execute format($u$update public.%I set additional_info = additional_info
                       where active and not (coalesce(jsonb_typeof(additional_info), '') = 'object'
                                             and (additional_info ? 'latitude' or additional_info ? 'lat'))$u$, r.tbl);
  end loop;
end $t$;

-- 5. an office / default point (one point for many districts) never stands as an ad's pin
select public.strip_shared_default_pins();

do $proof$
declare n int;
begin
  if position('october_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass, true)) = 0 then
    raise exception 'PROOF: october_commercial_listings is not in listing_rich_attrs';
  end if;
  if public.pin_from_maps_text('https://maps.google.com/?q=24.802963812807,46.( رقم الجوال )') is not null
     or public.pin_from_maps_text('https://maps.google.com/?q=24,46') is not null
     or public.pin_from_maps_text('https://www.google.com/maps/place/25.3848950, 49.5952110') is null
     or (public.pin_from_maps_text('maps/place/x/@28.359148,36.5593367,17z/data=!3d28.359148!4d36.557148') ->> 'longitude')::numeric <> 36.557148 then
    raise exception 'PROOF: pin_from_maps_text misreads a measured shape';
  end if;
  select count(*) into n from public.eilmalriyada_residential_listings where active and additional_info ? 'latitude';
  if n < 40 then raise exception 'PROOF: only % eilmalriyada pins after the re-save', n; end if;
end $proof$;
