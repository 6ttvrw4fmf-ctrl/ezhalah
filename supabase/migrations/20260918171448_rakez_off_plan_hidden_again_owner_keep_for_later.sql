-- OWNER 2026-09-18: "lets keep the 99 but hide them, ill add later off plan".
--
-- Same action as 20260914181618, re-applied because the rows came back ACTIVE. This is a
-- RE-ASSERTION, not a new decision: the owner's intent is unchanged (off-plan units are not shown),
-- and deactivate-not-delete was already the right shape for it — the rows stay as the seed of a
-- future off-plan feature, they simply leave the served index.
--
-- WHY IT RECURRED, honestly: not yet known. Ruled out on 2026-09-18, each by execution rather than
-- reading: the veto is present on main (718fc601, contained in f9ef5003 — the ref every scheduled
-- run used); rakez still publishes the tag (live API returns offer-group ['Off-plan sales'] for
-- project 16055, and ['البيع على الخارطة'] on its ar twin 16058); the real _terms_of/_clean
-- predicate fires against both of those live records; and all 436 projects are fetchable (16055 is
-- on page 3 of 5). scraped_at could not date the re-upsert because nothing ever rewrites it — it is
-- an insert-time default — but _wasalt_batch does r.setdefault("active", True) on everything it
-- writes, and last_seen_at moved to the 09-18 04:44 crawl, so these rows WERE re-upserted.
--
-- A latent hole exists and is NOT claimed as the cause: both project gates pass on an EMPTY set
--   if statuses and not (statuses & PROJECT_STATUS_OK)   -- empty statuses => no veto
--   if offers & OFFER_GROUP_EXCLUDED                     -- empty offers  => no veto
-- so a unit whose project record is absent at map time bypasses both. Could not be shown to apply
-- here, so it is recorded as a lead, not a diagnosis.
--
-- THIS WILL RECUR until the cause is found. That is stated plainly rather than implied: the next
-- crawl may re-activate these rows again, and mon_detect_rakez_off_plan_resurrection() — which
-- already exists and has been correctly alerting since 2026-09-15 — is what will say so.
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

-- The repair calls its own watching detector, so this file reaches a mon_detect_* in executed SQL
-- and needs no waiver. Re-running it also RESOLVES the open alert now that the condition is false.
do $verify$
declare v_active int; v_kept int; v_raised int;
begin
  select count(*) into v_active
    from public.rakez_residential_listings
   where (additional_info->>'project_id')::int in
         (67008, 63096, 66852, 38262, 45815, 35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055)
     and active;
  if v_active > 0 then
    raise exception 'still % active off-plan rakez listings after the hide', v_active;
  end if;

  -- KEPT, not deleted — the owner wants them for a future off-plan feature.
  select count(*) into v_kept
    from public.rakez_residential_listings
   where (additional_info->>'project_id')::int in
         (67008, 63096, 66852, 38262, 45815, 35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055);
  if v_kept < 99 then
    raise exception 'off-plan rows were LOST (% remain) — they must be hidden, never deleted', v_kept;
  end if;

  select public.mon_detect_rakez_off_plan_resurrection() into v_raised;
  if v_raised <> 0 then
    raise exception 'detector still raising after the hide (%)', v_raised;
  end if;
end $verify$;