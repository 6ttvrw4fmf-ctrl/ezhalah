-- Switch on pin districts batch 2 (owner 2026-10-25: «do that make sure it's live»). The owner decided there is NO «تقريبي»
-- label: the district Apple Maps names (same city, already on our list, home in the middle of it) is shown as the district.
-- Live safety: the DB guards (20261025203753) and the nightly alarm mon_detect_pin_district_unvouched. Batch-1 rows that
-- are edge homes stay off and wait for Google Maps. Undo = applied = false for this run_id and delete the basis = 'pin'
-- rows of district_recovery, in one transaction.
update public.listing_pin_district set applied = true where run_id = 'apple-ring-2026-10-25' and not applied;

do $proof$
declare n_on bigint := (select count(*) from public.listing_pin_district where run_id = 'apple-ring-2026-10-25' and applied);
begin
  if n_on = 0 then raise exception 'PROOF: nothing switched on'; end if;
  if exists (select 1 from public.listing_pin_district where run_id = 'apple-pin-2026-10-24' and applied) then
    raise exception 'PROOF: a batch-1 edge row was switched on';
  end if;
  raise notice 'PROOF OK: % batch 2 rows switched on; batch-1 edge rows stay off', n_on;
end $proof$;
