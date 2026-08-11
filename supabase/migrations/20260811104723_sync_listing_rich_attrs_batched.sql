-- Batch the rich-attrs sync. The first fleet-wide run updated 40,354 wasalt rows in ONE statement,
-- which breaks this instance's standing limit of <=25k rows per statement. Production stayed healthy
-- (24.2s, anon probes 200, app 200) — but the 2026-08-10 outage that produced that rule was exactly
-- a single oversized UPDATE, so the possibility is removed rather than left to luck.
--
-- Shape: materialise the platform's diff ONCE into a temp table, then write it in <=25k-row batches
-- keyed on listing_id. This is strictly cheaper than a LIMIT loop over the view, which would
-- re-materialise the whole UNION ALL branch on every batch — the failure mode that made an earlier
-- ad-hoc loop run 218 seconds and update nothing.
create or replace function public.sync_listing_rich_attrs(p_source_table text)
returns bigint
language plpgsql
as $fn$
declare n bigint := 0; batch bigint; lo bigint := 0; k constant int := 25000;
begin
  if p_source_table is null or p_source_table !~ '^[a-z0-9_]+_listings$' then
    raise exception 'p_source_table must be a bare <platform>_<kind>_listings identifier, got %', p_source_table;
  end if;

  create temp table if not exists _rich_diff (like public.listing_rich_attrs) on commit drop;
  truncate _rich_diff;

  -- ONE scan. The literal source_table lets the planner prune the other UNION ALL branches.
  execute format($f$
    insert into _rich_diff
    select r.* from public.listing_rich_attrs r
    join public.search_listings_ar s
      on s.source_table = r.source_table and s.listing_id = r.listing_id
    where r.source_table = %L
      and (   s.ac_type is distinct from r.ac_type
           or s.kitchen_status is distinct from r.kitchen_status
           or s.furnishing_level is distinct from r.furnishing_level
           or s.parking_count is distinct from r.parking_count
           or s.parking_type is distinct from r.parking_type
           or s.installment_available is distinct from r.installment_available
           or s.installment_amount is distinct from r.installment_amount
           or s.installment_count is distinct from r.installment_count
           or s.separate_electricity_meter is distinct from r.separate_electricity_meter
           or s.separate_water_meter is distinct from r.separate_water_meter
           or s.electricity is distinct from r.electricity
           or s.water_supply is distinct from r.water_supply
           or s.sanitation is distinct from r.sanitation
           or s.balcony is distinct from r.balcony
           or s.laundry_room is distinct from r.laundry_room
           or s.pool is distinct from r.pool
           or s.gym is distinct from r.gym
           or s.garden is distinct from r.garden
           or s.living_rooms is distinct from r.living_rooms
           or s.majlis_rooms is distinct from r.majlis_rooms
           or s.total_floors is distinct from r.total_floors
           or s.frontage_count is distinct from r.frontage_count
           or s.latitude is distinct from r.latitude
           or s.longitude is distinct from r.longitude
           or s.rega_license_status is distinct from r.rega_license_status
           or s.postal_code is distinct from r.postal_code
           or s.deed_location_text is distinct from r.deed_location_text)
  $f$, p_source_table);

  create index if not exists _rich_diff_id on _rich_diff (listing_id);

  loop
    update public.search_listings_ar s set
      ac_type=d.ac_type, kitchen_status=d.kitchen_status, furnishing_level=d.furnishing_level,
      parking_count=d.parking_count, parking_type=d.parking_type,
      installment_available=d.installment_available, installment_amount=d.installment_amount,
      installment_count=d.installment_count,
      separate_electricity_meter=d.separate_electricity_meter,
      separate_water_meter=d.separate_water_meter,
      electricity=d.electricity, water_supply=d.water_supply, sanitation=d.sanitation,
      balcony=d.balcony, laundry_room=d.laundry_room, pool=d.pool, gym=d.gym, garden=d.garden,
      living_rooms=d.living_rooms, majlis_rooms=d.majlis_rooms, total_floors=d.total_floors,
      frontage_count=d.frontage_count, latitude=d.latitude, longitude=d.longitude,
      rega_license_status=d.rega_license_status, postal_code=d.postal_code,
      deed_location_text=d.deed_location_text
    from _rich_diff d
    where s.source_table = d.source_table and s.listing_id = d.listing_id
      and d.listing_id > lo and d.listing_id <= lo + k;

    get diagnostics batch = row_count;
    n := n + batch;
    lo := lo + k;
    exit when lo > coalesce((select max(listing_id) from _rich_diff), 0);
  end loop;

  return n;
end
$fn$;

comment on function public.sync_listing_rich_attrs(text) is
  'Copies listing_rich_attrs into search_listings_ar for ONE platform table, in <=25k-row batches. '
  'Pass a literal <platform>_<kind>_listings name; the literal is what lets the planner prune the '
  'other UNION ALL branches. Re-running is a no-op (every column is change-detected).';
