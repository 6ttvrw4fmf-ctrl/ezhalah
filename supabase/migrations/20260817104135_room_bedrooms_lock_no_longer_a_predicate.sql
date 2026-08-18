-- The غرفة bedrooms lock is FIXED, so its watch-rule is retired.
--
-- Migration 20260817085146 registered ('room', غرفة, bedrooms, =, 1) in ops_filter_autoapply_rule so
-- that mon_detect_filter_default_suppresses_inventory() would catch the class instead of a human
-- finding it by hand a third time. It measured, correctly: nationwide 2,406 production_ready غرفة
-- rows, only 475 reachable — 1,888 deleted purely because their SOURCE never published a bedroom
-- count, plus 43 with a differing published count. On الرياض/إيجار/سنوي the app's own
-- top_cities_by_deal_ar panel promised 1,172 while the search delivered 1, on the same screen.
--
-- That is now fixed in the client (src/lib/roomBedrooms.ts + src/data/search.ts): نوع=غرفة still
-- DISPLAYS «1 غرفة نوم» — owner rule 2026-07-06 is untouched, a room is still a single room — but the
-- label no longer becomes a bedrooms predicate, so p_beds_exact is null for a Room-only search and
-- all 2,406 rooms are reachable again. Bedrooms stays strict everywhere the user actually picks a
-- count, and an explicit agent-parsed detail still wins. Pinned by
-- scripts/verify-room-bedrooms-not-a-predicate.ts (fails on the pre-fix behaviour).
--
-- The rule row must therefore go: it describes a default that reaches the QUERY, and this one no
-- longer does. Leaving it would make the detector raise a P2 forever for suppression that has
-- stopped happening — a barrier that cries wolf is worse than no barrier.
--
-- The detector, the table and scripts/verify-filter-autoapply-mirror.ts all STAY. An empty mirror is
-- the healthy state: it means no auto-applied default currently reaches a query, and the machinery
-- that would catch the next one is still armed and still roster-wired.

delete from public.ops_filter_autoapply_rule where rule_key = 'room';

-- Resolve the standing alert in the same breath the cause was removed, rather than waiting for the
-- next sweep, so the ops dashboard never shows a P2 for a fixed defect.
do $$
declare v_open int;
begin
  perform public.mon_detect_filter_default_suppresses_inventory();
  select count(*) into v_open from public.alert_event
   where dedup_key = 'filter_default_suppresses_inventory:room' and resolved_at is null;
  if v_open > 0 then
    raise exception 'room alert still open after the rule was retired — the detector did not self-heal';
  end if;
end $$;
