-- Senior Production Engineer run #32 (2026-08-20). Regression barrier for the defect class fixed by
-- the two migrations applied immediately before this one.
--
-- THE CLASS, not today's example: listing_native_location_v2 is a 5-branch UNION. Every branch must
-- restate all 34 columns, so a branch added or rewritten for some unrelated reason (a location
-- overlay, a new platform arm) satisfies the column list with NULL literals and silently strips
-- every advanced-filter attribute from the listings it serves -- attributes the database already
-- holds, canonical and source-captured, in listing_extra_attrs / listing_age_resolved. Nothing
-- errors. The listing stays searchable, keeps its price and location, and simply becomes unreachable
-- by the elevator / parking / furnished / direction / age / floor / licence filters. It has now
-- happened at least three times: souq24 property_age (2026-07-17), souq24 direction and the
-- catch-all branch's full 14-column strip (both today, the latter costing 170 production_ready
-- gathern listings their amenities).
--
-- WHY THIS LAYER. The oracle compares listing_extra_attrs / listing_age_resolved against
-- listing_native_location_v2 -- both live, evaluated in one snapshot. There is deliberately NO
-- comparison against search_listings_ar: that is an hourly snapshot, so an index-layer oracle would
-- flag ordinary propagation lag as a defect and, per the mon_raise dedup rule, a false P1 sitting
-- open would swallow the real one. This oracle has no race: a value present on one side and NULL on
-- the other is always a view-logic defect.
--
-- Raise and resolve share ONE predicate (run #31's lesson: a detector that cannot stay RED, or
-- cannot go GREEN, cannot be audited by its own output). Reads 0 at install time on live data --
-- and per AGENTS.md 24c a standing 0 is the healthy reading; it guards the branch/attribute contract.

create or replace function public.mon_detect_v2_discards_captured_attrs()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; v_rows bigint; v_sample jsonb; v_open text;
begin
  with discarded as (
    select v.platform, v.source_method, v.source_table, v.listing_id,
           case when ea.elevator         is not null and v.elevator         is null then 'elevator'
                when ea.parking          is not null and v.parking          is null then 'parking'
                when ea.kitchen          is not null and v.kitchen          is null then 'kitchen'
                when ea.air_conditioner  is not null and v.air_conditioner  is null then 'air_conditioner'
                when ea.maid_room        is not null and v.maid_room        is null then 'maid_room'
                when ea.driver_room      is not null and v.driver_room      is null then 'driver_room'
                when ea.private_entrance is not null and v.private_entrance is null then 'private_entrance'
                when ea.furnished        is not null and v.furnished        is null then 'furnished'
                when ea.direction        is not null and v.direction        is null then 'direction'
                when ea.street_width_m   is not null and v.street_width_m   is null then 'street_width_m'
                when ea.floor_number     is not null and v.floor_number     is null then 'floor_number'
                when ea.tenant_category  is not null and v.tenant_category  is null then 'tenant_category'
                when ea.license_number   is not null and v.license_number   is null then 'license_number'
           end as field
      from public.listing_native_location_v2 v
      join public.listing_extra_attrs ea
        on ea.source_table = v.source_table and ea.listing_id = v.listing_id
     where (ea.elevator is not null and v.elevator is null)
        or (ea.parking is not null and v.parking is null)
        or (ea.kitchen is not null and v.kitchen is null)
        or (ea.air_conditioner is not null and v.air_conditioner is null)
        or (ea.maid_room is not null and v.maid_room is null)
        or (ea.driver_room is not null and v.driver_room is null)
        or (ea.private_entrance is not null and v.private_entrance is null)
        or (ea.furnished is not null and v.furnished is null)
        or (ea.direction is not null and v.direction is null)
        or (ea.street_width_m is not null and v.street_width_m is null)
        or (ea.floor_number is not null and v.floor_number is null)
        or (ea.tenant_category is not null and v.tenant_category is null)
        or (ea.license_number is not null and v.license_number is null)
    union all
    select v.platform, v.source_method, v.source_table, v.listing_id, 'property_age'
      from public.listing_native_location_v2 v
      join public.listing_age_resolved car
        on car.source_table = v.source_table and car.listing_id = v.listing_id
     where car.property_age is not null and v.property_age is null
  )
  select count(*),
         (select jsonb_agg(to_jsonb(t)) from (select * from discarded limit 5) t)
    into v_rows, v_sample
    from discarded;

  select severity into v_open from public.alert_event
   where dedup_key = 'v2_discards_captured_attrs' and resolved_at is null
   order by created_at desc limit 1;

  if v_rows = 0 then
    if v_open is not null then
      perform public.mon_resolve_key('v2_discards_captured_attrs', 'v2_discards_captured_attrs');
    end if;
    return 0;
  end if;

  n := public.mon_raise('P1', 'v2_discards_captured_attrs', 'all', 'v2_discards_captured_attrs',
    jsonb_build_object(
      'rows', v_rows,
      'sample', v_sample,
      'why', 'listing_native_location_v2 is serving NULL for an advanced-filter attribute that '
          || 'listing_extra_attrs / listing_age_resolved already holds for the SAME listing. The '
          || 'value was captured from the source and canonicalised correctly; a branch of the v2 '
          || 'UNION is throwing it away, so those listings are unreachable by that Advanced Filter '
          || 'while every other listing on the same platform is reachable.',
      'adjudicate', 'Read source_method in the sample: it names the branch. Fix the BRANCH (attach '
          || 'listing_extra_attrs / listing_age_resolved on its own key, as the v1 branch does) -- '
          || 'never repair the rows, and never silence this by nulling the upstream value. '
          || 'Precedents: 20260717_v2_souq24_branches_attach_age_resolved, and run #32 (2026-08-20) '
          || 'for the catch-all branch and souq24 direction. Verify with a test view first: row '
          || 'counts equal, 0 non-target column diffs, 0 value->NULL losses.'));
  return n;
end
$function$;

comment on function public.mon_detect_v2_discards_captured_attrs() is
  'P1. Fires when listing_native_location_v2 discards an advanced-filter attribute that '
  'listing_extra_attrs/listing_age_resolved holds for the same listing (the UNION-branch NULL-literal '
  'class). Race-free by construction: both sides are live, compared in one snapshot. Senior run #32.';

-- Roster wiring: GUARDED NEEDLE-EDIT of mon_run_all_detectors (never a wholesale rewrite -- a stale
-- full body silently drops entries; verify-detector-roster-edits-are-guarded.ts rejects that, and
-- mon_detect_orphaned_detectors fires on any detector nothing reaches).
do $$
declare v_def text; v_new text; v_anchor text; n_anchor int; n_before int; n_after int;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'mon_run_all_detectors';

  if position('mon_detect_v2_discards_captured_attrs' in v_def) > 0 then
    raise notice 'already on roster; no-op';
    return;
  end if;

  v_anchor := '    ''mon_detect_discarded_location_resolution'',
';
  n_anchor := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if n_anchor <> 1 then
    raise exception 'REFUSED: roster anchor not found exactly once (found %)', n_anchor;
  end if;

  n_before := (length(v_def) - length(replace(v_def, '''mon_detect_', ''))) / length('''mon_detect_');

  v_new := replace(v_def, v_anchor, v_anchor || '    ''mon_detect_v2_discards_captured_attrs'',
');

  n_after := (length(v_new) - length(replace(v_new, '''mon_detect_', ''))) / length('''mon_detect_');
  if n_after <> n_before + 1 then
    raise exception 'REFUSED: roster entry count moved % -> % (expected +1)', n_before, n_after;
  end if;

  execute v_new;
end $$;
