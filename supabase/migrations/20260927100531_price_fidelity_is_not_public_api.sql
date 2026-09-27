-- price_fidelity() plans listing_native_location_v2 and was the last v2-reaching maintenance
-- routine anon could EXECUTE. Its only public caller, the live check, now reads
-- public.price_fidelity_snapshot (filled hourly by cron job 42), so the function stops being
-- public API. postgres and service_role keep their explicit grants, so cron keeps working.
-- CREATE OR REPLACE keeps these ACLs; a DROP + CREATE would get the schema's default grants back.
revoke execute on function public.price_fidelity() from public, anon, authenticated;
