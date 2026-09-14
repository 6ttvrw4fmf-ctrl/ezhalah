-- OWNER DECISION 2026-09-14: remove راكز's off-plan units from search.
--
-- «البيع على الخارطة» — literally "selling on the map" — is a unit sold BEFORE it is built: a
-- drawing, a price, and a wait of a year or more. The card showed a photo of a finished building
-- and a ready-to-buy price for something that does not physically exist yet. The owner's standing
-- rule is that completed projects are real listings; this is the other side of that rule.
--
-- HOW THEY GOT IN. rakez publishes TWO independent not-yet-built signals and I honoured only one.
-- property-status «قريبا»/Soon was excluded from the start. The offer-group tag «البيع على الخارطة»
-- was seen during reconnaissance, noted, and then not wired into the gate — and because a project
-- can be «متاح» (available to BUY) and off-plan AT THE SAME TIME, the status gate let them through.
-- 99 units across 7 projects (16055, 17160, 24426, 29683, 29937, 35131, 38262).
--
-- DEACTIVATED, NOT DELETED, on purpose. The rows stay as a record of what was ingested and why it
-- was withdrawn. They cannot come back on their own: scrapers/rakez/run.py now vetoes an off-plan
-- tag on EITHER language's project record, so these units are never upserted again, and an upsert
-- is the only thing that sets active back to true. prune_unseen will find them already inactive and
-- do nothing.
--
-- NOTE FOR LATER: only 13 of rakez's 435 projects carry this tag, and the site publishes no
-- completion field at all (no تسليم / جاهز / مكتمل / قيد الإنشاء / نسبة الإنجاز / سنة البناء
-- anywhere). So this is a FLOOR, not a guarantee: an untagged project means "not stated", never
-- "confirmed built".
update public.rakez_residential_listings
   set active = false,
       deactivated_at = coalesce(deactivated_at, now())
 where (additional_info->>'project_id')::int in
       (67008, 63096, 66852, 38262, 45815, 35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055)
   and active;

update public.rakez_commercial_listings
   set active = false,
       deactivated_at = coalesce(deactivated_at, now())
 where (additional_info->>'project_id')::int in
       (67008, 63096, 66852, 38262, 45815, 35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055)
   and active;

do $verify$
declare v_active_offplan int; v_total_active int;
begin
  select count(*) into v_active_offplan
    from public.rakez_residential_listings
   where (additional_info->>'project_id')::int in
         (67008, 63096, 66852, 38262, 45815, 35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055)
     and active;
  if v_active_offplan > 0 then
    raise exception 'still % active off-plan rakez listings', v_active_offplan;
  end if;

  -- and the rest of the platform must survive: this is a targeted withdrawal, not a purge
  select count(*) into v_total_active from public.rakez_residential_listings where active;
  if v_total_active < 3000 then
    raise exception 'rakez dropped to % active listings — far more than the ~99 off-plan rows was removed', v_total_active;
  end if;
end $verify$;