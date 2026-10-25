-- pin_district_approx_ar answered NOTHING for a call over its 1000-key cap, and «nothing» reads to the app as «none of these is a pin district»,
-- i.e. an unlabelled pin district. A call it cannot answer must FAIL (the app then hides those districts), never answer empty.
create or replace function public.pin_district_approx_ar(p_source_tables text[], p_listing_ids bigint[])
returns table (source_table text, listing_id bigint)
language plpgsql stable security definer set search_path to 'public'
as $f$
begin
  if p_source_tables is null or p_listing_ids is null
     or cardinality(p_source_tables) <> cardinality(p_listing_ids)
     or cardinality(p_source_tables) > 1000 then
    raise exception 'pin_district_approx_ar: at most 1000 keys, and the two arrays must match' using errcode = '22023';
  end if;
  return query
    select r.source_table, r.listing_id
      from unnest(p_source_tables, p_listing_ids) as k(st, lid)
      join public.district_recovery r on r.source_table = k.st and r.listing_id = k.lid
     where r.basis = 'pin';
end
$f$;
do $proof$
declare e text := '';
begin
  begin
    perform * from public.pin_district_approx_ar(array_fill('x'::text, array[1001]), array_fill(1::bigint, array[1001]));
  exception when others then e := sqlerrm;
  end;
  if e = '' then raise exception 'PROOF: an oversize call was answered instead of refused'; end if;
  if (select count(*) from public.pin_district_approx_ar(array['proof_pin_table'], array[-1::bigint])) <> 0 then
    raise exception 'PROOF: an unknown key was answered';
  end if;
  raise notice 'PROOF OK: oversize refused (%), a normal call answers', e;
end $proof$;
