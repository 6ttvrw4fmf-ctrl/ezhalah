-- PIN DISTRICTS, the two things that must exist before anything is switched on (owner 2026-10-25: «finish Apple Maps»):
--  1) the LABEL's lookup: pin_district_approx_ar(source_tables, listing_ids) answers which of the listings on screen are served a
--     district read from their pin (district_recovery.basis = 'pin'), so the app can print «تقريبي» next to it. Read-only STABLE,
--     at most 1000 keys, no personal data, callable by the public keys through the security-definer allowlist.
--  2) the nightly ALARM: mon_detect_pin_district_unvouched() raises P2 when a pin district is served that no switched-on
--     listing_pin_district row vouches for (same table, listing and district), or that is marked verbatim (a pin row is never attestation).
create or replace function public.pin_district_approx_ar(p_source_tables text[], p_listing_ids bigint[])
returns table (source_table text, listing_id bigint)
language sql stable security definer set search_path to 'public'
as $f$
  select r.source_table, r.listing_id
    from unnest(p_source_tables, p_listing_ids) as k(st, lid)
    join public.district_recovery r on r.source_table = k.st and r.listing_id = k.lid
   where r.basis = 'pin'
     and cardinality(p_source_tables) <= 1000
     and cardinality(p_source_tables) = cardinality(p_listing_ids)
$f$;
revoke all on function public.pin_district_approx_ar(text[], bigint[]) from public;
grant execute on function public.pin_district_approx_ar(text[], bigint[]) to anon, authenticated;
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('pin_district_approx_ar', '{anon,authenticated}', 'result cards and the ad page: which of the listings on screen are served a district read from their map pin, so the app labels it «تقريبي» (lib/pinDistrictApprox). Read-only STABLE, at most 1000 keys, returns only (source_table, listing_id), no personal data.')
on conflict do nothing;

create or replace function public.mon_detect_pin_district_unvouched()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_open boolean; r int := 0;
begin
  select count(*) into v_rows
    from public.district_recovery d
   where d.basis = 'pin'
     and (coalesce(d.verbatim, false)
          or not exists (select 1 from public.listing_pin_district p
                          where p.source_table = d.source_table and p.listing_id = d.listing_id
                            and p.applied and p.district_ar = d.district_ar));
  v_open := exists (select 1 from public.alert_event where dedup_key = 'pin_district_unvouched' and resolved_at is null);
  if v_rows = 0 then
    if v_open then perform public.mon_resolve('pin_district_unvouched', 'location'); end if;
  elsif not v_open then
    r := public.mon_raise('P2', 'pin_district_unvouched', 'location', 'pin_district_unvouched',
      jsonb_build_object('rows', v_rows,
        'examples', (select jsonb_agg(jsonb_build_object('source_table', d.source_table, 'listing_id', d.listing_id))
                       from (select source_table, listing_id from public.district_recovery d
                              where d.basis = 'pin'
                                and (coalesce(d.verbatim, false)
                                     or not exists (select 1 from public.listing_pin_district p
                                                     where p.source_table = d.source_table and p.listing_id = d.listing_id
                                                       and p.applied and p.district_ar = d.district_ar))
                              limit 10) d),
        'why', 'A district read from an ad''s map pin is being served, but no switched-on listing_pin_district row vouches for it (or it is marked verbatim). Pin districts only fill gaps, are labelled «تقريبي», and are never attestation.',
        'action', 'Undo = listing_pin_district.applied = false and delete the basis = pin rows of district_recovery in one transaction; then find why the arm served an unvouched row.'));
  end if;
  return r;
end $function$;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_pin_district_unvouched''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_pin_district_unvouched'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_pin_district_unvouched''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF: a planted unvouched pin row is counted, inside a rolled-back sub-transaction; the lookup answers it; nothing stays.
do $proof$
declare base bigint; planted bigint; looked bigint;
begin
  base := (select count(*) from public.district_recovery d where d.basis = 'pin'
            and (coalesce(d.verbatim, false) or not exists (select 1 from public.listing_pin_district p
                  where p.source_table = d.source_table and p.listing_id = d.listing_id and p.applied and p.district_ar = d.district_ar)));
  begin
    insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at, verbatim, basis)
    values ('proof_pin_table', -1, 'حي اختبار', now(), false, 'pin');
    planted := (select count(*) from public.district_recovery d where d.basis = 'pin'
                 and (coalesce(d.verbatim, false) or not exists (select 1 from public.listing_pin_district p
                       where p.source_table = d.source_table and p.listing_id = d.listing_id and p.applied and p.district_ar = d.district_ar)));
    looked := (select count(*) from public.pin_district_approx_ar(array['proof_pin_table'], array[-1::bigint]));
    if planted <> base + 1 then raise exception 'PROOF: the planted unvouched pin row was not counted (% vs %)', planted, base; end if;
    if looked <> 1 then raise exception 'PROOF: the label lookup did not answer the planted pin row'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select count(*) from public.district_recovery where source_table = 'proof_pin_table') <> 0 then raise exception 'PROOF: the planted row stayed'; end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_pin_district_unvouched') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: % unvouched now; a planted one is counted and found by the lookup; rostered', base;
end $proof$;