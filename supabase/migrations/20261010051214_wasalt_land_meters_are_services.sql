-- Backlog 326 (owner, 2026-10-09): a wasalt LAND's own «electricityMeter» / «waterMeter» (Yes/No, in
-- its additionalAttributes panel = additional_info) are its electricity / water_supply. Both columns
-- were NULL on every wasalt land although ~6,200 publish the meters, so the index could not tell a
-- serviced plot from a raw one. scrapers/wasalt/run.py + enrich.py now write them on every read
-- (land_service_fields, LAND ONLY: on an apartment «No» is a shared meter, not «no electricity»).
-- This repairs the rows already stored, from the SAME source field, same rule:
--   yes -> true, no -> false, absent / anything else -> left NULL (silent is not «no»).
-- The same pass fills separate_*_meter where the panel states it and the column is still NULL (the
-- wasalt_meter_parse_gap class: 413 active lands measured 2026-10-10). Never overwrites a known value.
-- The index picks the change up through sync_listing_rich_attrs (diff-based) on the next hourly sync.
do $m$
declare t text; n int;
begin
  foreach t in array array['wasalt_residential_listings','wasalt_commercial_listings'] loop
    execute format($f$
      with src as (
        select r.id,
          (select lower(trim(e->>'value')) from jsonb_array_elements(r.additional_info) e
            where e->>'key' = 'electricityMeter' limit 1) as ae,
          (select lower(trim(e->>'value')) from jsonb_array_elements(r.additional_info) e
            where e->>'key' = 'waterMeter' limit 1) as aw
        from public.%I r
        where r.property_type like '%%Land' and jsonb_typeof(r.additional_info) = 'array'
      ), v as (
        select id,
               case ae when 'yes' then true when 'no' then false end as e,
               case aw when 'yes' then true when 'no' then false end as w
          from src
      )
      update public.%I r
         set electricity = coalesce(r.electricity, v.e),
             water_supply = coalesce(r.water_supply, v.w),
             separate_electricity_meter = coalesce(r.separate_electricity_meter, v.e),
             separate_water_meter = coalesce(r.separate_water_meter, v.w)
        from v
       where r.id = v.id
         and ((r.electricity is null and v.e is not null) or (r.water_supply is null and v.w is not null)
              or (r.separate_electricity_meter is null and v.e is not null)
              or (r.separate_water_meter is null and v.w is not null))
    $f$, t, t);
    get diagnostics n = row_count;
    raise notice '% lands repaired: %', t, n;
  end loop;
end $m$;

-- Check: no active wasalt land states a meter while its service column is still NULL.
do $c$
declare bad int;
begin
  select count(*) into bad
    from public.wasalt_residential_listings r
   where r.active and r.property_type like '%Land' and jsonb_typeof(r.additional_info) = 'array'
     and r.electricity is null
     and exists (select 1 from jsonb_array_elements(r.additional_info) e
                  where e->>'key' = 'electricityMeter' and lower(trim(e->>'value')) in ('yes','no'));
  if bad > 0 then raise exception 'backlog 326 check: % lands still state a meter with electricity NULL', bad; end if;
end $c$;
