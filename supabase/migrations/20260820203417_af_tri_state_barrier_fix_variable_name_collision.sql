-- Fix an ambiguous column reference in mon_detect_af_tri_state_violations that only manifests
-- when the function is invoked (the per_seg CTE aliases count(*)-filter-false to `f`, which
-- collides with the outer PL/pgSQL loop variable `f text` from limb A). Rename that column to
-- `nfalse` and use `t` -> `ntrue` for symmetry; caught by mutation-testing the barrier live
-- rather than by reading the code (§24e).
create or replace function public.mon_detect_af_tri_state_violations()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; total_leaks int := 0; total_stuck int := 0;
  leaks jsonb := '[]'::jsonb; stuck jsonb := '[]'::jsonb;
  fld text; sample jsonb;
  boolean_fields constant text[] := array[
    'furnished','elevator','parking','kitchen','air_conditioner',
    'maid_room','driver_room','private_entrance'];
begin
  foreach fld in array boolean_fields loop
    execute format($q$
      select coalesce(jsonb_agg(x order by x->>'source_table', x->>'listing_id'), '[]'::jsonb)
      from (
        select jsonb_build_object('source_table', s.source_table, 'listing_id', s.listing_id) x
        from public.search_listings_ar s
        join public.listing_extra_attrs e using (source_table, listing_id)
        where s.production_ready
          and public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar)
          and s.%I is false and e.%I is null
        limit 10) q$q$, fld, fld) into sample;
    if jsonb_array_length(sample) > 0 then
      leaks := leaks || jsonb_build_object('field', fld, 'sample', sample);
      total_leaks := total_leaks + jsonb_array_length(sample);
    end if;
  end loop;
  if total_leaks > 0 then
    n := n + public.mon_raise('P1', 'af_null_to_false_conversion', 'search_index',
      'af_null_to_false_conversion',
      jsonb_build_object(
        'leaks_by_field', leaks,
        'why', 'A listing whose Advanced-Filter boolean is NULL in listing_extra_attrs became FALSE '
            || 'in search_listings_ar. That is the tri-state law being broken: the pipeline '
            || 'manufactured a negative from an unknown. Never leave standing.',
        'do_not', 'Do NOT flip search rows to NULL by hand. Fix the sync/writer that manufactured '
                 || 'the FALSE, then re-run sync_search_listings_ar to let the correct NULL propagate.'));
  else
    perform public.mon_resolve_key('af_null_to_false_conversion', 'af_null_to_false_conversion');
  end if;

  with per_seg as (
    select s.source_table, s.deal_ar, s.rent_period_ar, s.type_ar, u.field,
      count(*) filter (where val is true)  as ntrue,
      count(*) filter (where val is false) as nfalse
    from public.search_listings_ar s
    cross join lateral (values
      ('furnished'::text,        s.furnished),
      ('elevator',               s.elevator),
      ('parking',                s.parking),
      ('kitchen',                s.kitchen),
      ('air_conditioner',        s.air_conditioner),
      ('maid_room',              s.maid_room),
      ('driver_room',            s.driver_room),
      ('private_entrance',       s.private_entrance)) u(field, val)
    where s.production_ready
      and public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar)
    group by 1,2,3,4,5),
  peer as (
    select deal_ar, rent_period_ar, type_ar, field,
      max(case when ntrue>=5 and nfalse>=5 then 1 else 0 end) peer_variance
    from per_seg group by 1,2,3,4)
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_table', p.source_table, 'field', p.field,
           'deal', p.deal_ar, 'period', p.rent_period_ar, 'type', p.type_ar,
           'true_count', p.ntrue, 'false_count', p.nfalse)
         order by p.nfalse+p.ntrue desc), '[]'::jsonb),
         count(*)::int
    into stuck, total_stuck
  from per_seg p join peer x using (deal_ar, rent_period_ar, type_ar, field)
  where p.ntrue + p.nfalse >= 30 and (p.ntrue = 0 or p.nfalse = 0) and x.peer_variance = 1
    and not exists (
      select 1 from public.ops_amenity_capture_verified w
      where w.source_table = p.source_table and w.field = p.field
        and w.deal_ar = p.deal_ar
        and (w.rent_period_key = coalesce(p.rent_period_ar, '') or w.rent_period_key = '*')
        and w.type_ar = p.type_ar);

  if total_stuck > 0 then
    n := n + public.mon_raise('P2', 'af_field_stuck_no_variance', 'search_index',
      'af_field_stuck_no_variance',
      jsonb_build_object(
        'stuck_pairs', stuck,
        'why', 'For this (platform x field x cohort segment) with >=30 known values, the field '
            || 'is 100% one value, while another platform in the same (deal, period, type) '
            || 'reports meaningful variance. Either this platform''s parser is asserting a '
            || 'constant, or the source itself only publishes one value -- adjudicate against '
            || 'the source and either fix the parser or acknowledge in ops_amenity_capture_verified.',
        'do_not', 'Do NOT waive without live source evidence. Cross-platform variance is the '
                 || 'signal that this cohort segment CAN vary; the burden is on the source to '
                 || 'prove it does not.'));
  else
    perform public.mon_resolve_key('af_field_stuck_no_variance', 'af_field_stuck_no_variance');
  end if;

  return n;
end
$function$;
