-- listing_rich_attrs was an ORPHAN VIEW: nothing in the database read it. Confirmed three ways
-- (pg_proc, pg_get_viewdef, pg_depend — zero external dependents). Its 27 columns reached
-- search_listings_ar only when a human hand-ran an ad-hoc UPDATE over MCP.
--
-- Two consequences, both live:
--   1. New listings never received rich attributes at all. Adding a branch to the view — which is
--      what this work set out to do for raghdan — would have been decorative without this.
--   2. Existing values are one flap away from vanishing. sync_search_listings_ar() writes 33 of the
--      63 columns via ON CONFLICT DO UPDATE, so the 27 rich columns SURVIVE an update but are reset
--      to NULL by any delete-then-reinsert. prune_inactive_from_search() deletes unguarded.
--
-- This function is the missing link, deliberately kept OUT of sync_search_listings_ar():
--   * Joining the view into the hot-path sync measured +62.6% planner cost (Merge Left Join that
--     sorts the whole rich side), and would also require surgery on that function's incremental
--     change-detection OR-list — miss that and the change is a near no-op.
--   * The view's cost is concentrated in wasalt (95.8% of its buffers, 18.8s of 19.35s) from
--     correlated subplans. A per-platform call sidesteps all of it.
--
-- Dynamic SQL with a LITERAL source_table is the point, not incidental: a constant lets the planner
-- prune the other UNION ALL branches outright. A plpgsql variable would be a runtime parameter and
-- would re-materialise the entire view on every call — that is why an earlier ad-hoc batched loop
-- ran 218 seconds and updated nothing.
--
-- Straight assignment, NOT coalesce(r.col, s.col). An adversarial pass measured every divergence
-- between view and table across all 27 columns and all 185,589 rows: 656 cells on 655 rows, and
-- all 655 resolve in the VIEW's favour (10 wasalt rows whose source panels are genuinely NULL now,
-- 644 sanadak rows that are whitespace-only stale, 1 aqar row contradicted by its own source
-- columns). COALESCE would be wrong in 100% of them, and would not even fix the case it targets
-- since 646 of the 656 have both sides non-null.
create or replace function public.sync_listing_rich_attrs(p_source_table text)
returns bigint
language plpgsql
as $fn$
declare n bigint;
begin
  -- the value is interpolated as a literal, so it must be a bare identifier and nothing else
  if p_source_table is null or p_source_table !~ '^[a-z0-9_]+_listings$' then
    raise exception 'p_source_table must be a bare <platform>_<kind>_listings identifier, got %', p_source_table;
  end if;

  execute format($f$
    update public.search_listings_ar s set
      ac_type                    = r.ac_type,
      kitchen_status             = r.kitchen_status,
      furnishing_level           = r.furnishing_level,
      parking_count              = r.parking_count,
      parking_type               = r.parking_type,
      installment_available      = r.installment_available,
      installment_amount         = r.installment_amount,
      installment_count          = r.installment_count,
      separate_electricity_meter = r.separate_electricity_meter,
      separate_water_meter       = r.separate_water_meter,
      electricity                = r.electricity,
      water_supply               = r.water_supply,
      sanitation                 = r.sanitation,
      balcony                    = r.balcony,
      laundry_room               = r.laundry_room,
      pool                       = r.pool,
      gym                        = r.gym,
      garden                     = r.garden,
      living_rooms               = r.living_rooms,
      majlis_rooms               = r.majlis_rooms,
      total_floors               = r.total_floors,
      frontage_count             = r.frontage_count,
      latitude                   = r.latitude,
      longitude                  = r.longitude,
      rega_license_status        = r.rega_license_status,
      postal_code                = r.postal_code,
      deed_location_text         = r.deed_location_text
    from public.listing_rich_attrs r
    where r.source_table = %L
      and s.source_table = r.source_table
      and s.listing_id   = r.listing_id
      and (   s.ac_type                    is distinct from r.ac_type
           or s.kitchen_status             is distinct from r.kitchen_status
           or s.furnishing_level           is distinct from r.furnishing_level
           or s.parking_count              is distinct from r.parking_count
           or s.parking_type               is distinct from r.parking_type
           or s.installment_available      is distinct from r.installment_available
           or s.installment_amount         is distinct from r.installment_amount
           or s.installment_count          is distinct from r.installment_count
           or s.separate_electricity_meter is distinct from r.separate_electricity_meter
           or s.separate_water_meter       is distinct from r.separate_water_meter
           or s.electricity                is distinct from r.electricity
           or s.water_supply               is distinct from r.water_supply
           or s.sanitation                 is distinct from r.sanitation
           or s.balcony                    is distinct from r.balcony
           or s.laundry_room               is distinct from r.laundry_room
           or s.pool                       is distinct from r.pool
           or s.gym                        is distinct from r.gym
           or s.garden                     is distinct from r.garden
           or s.living_rooms               is distinct from r.living_rooms
           or s.majlis_rooms               is distinct from r.majlis_rooms
           or s.total_floors               is distinct from r.total_floors
           or s.frontage_count             is distinct from r.frontage_count
           or s.latitude                   is distinct from r.latitude
           or s.longitude                  is distinct from r.longitude
           or s.rega_license_status        is distinct from r.rega_license_status
           or s.postal_code                is distinct from r.postal_code
           or s.deed_location_text         is distinct from r.deed_location_text)
  $f$, p_source_table);

  get diagnostics n = row_count;
  return n;
end
$fn$;

comment on function public.sync_listing_rich_attrs(text) is
  'Copies listing_rich_attrs into search_listings_ar for ONE platform table. Pass a literal '
  '<platform>_<kind>_listings name; the literal is what lets the planner prune the other UNION ALL '
  'branches. Re-running is a no-op (every column is change-detected with IS DISTINCT FROM).';
