-- CORRECTION (2026-08-10, same day): my own barrier documented a claim that was then DISPROVEN by
-- stronger evidence, and a wrong comment inside a barrier is worse than no comment — it is the thing
-- the next engineer will cite when deciding whether to restore data.
--
-- WHAT I CLAIMED: `mon_price_size_fidelity_barrier` and its retraction migration cited aqar 6594767
-- as the worked example that `area = price` can be SOURCE-REAL, reasoning that «سعر المتر 1» makes
-- total = area × 1 legitimate arithmetic, and that the figure was printed on the page.
--
-- WHAT WAS ACTUALLY PROVEN (migration 20260810202219, concurrent session, workflow wf_9dcdbb5b —
-- per-listing source verification by 3 agents with evidence quoted per row): the «سعر المتر 1»
-- rial-per-meter gimmick makes aqar RENDER area × 1 in the price slot when the seller published NO
-- total at all. The figure being present on the page is therefore NOT evidence that a total exists —
-- it is the artifact itself. 55 of 60 such rows had no seller-published total; 5 were kept, including
-- id 132677 where «المطلوب: 2,000,000» sits on a 2,000,000 m² plot — a LABELLED coincidence, which is
-- what a genuine one looks like. 6594767 carried no such label, so its price is now correctly NULL.
--
-- WHY THIS DOES NOT WEAKEN SOURCE-IS-TRUTH: the rule is "preserve what the source PUBLISHES", not
-- "preserve what the page renders". A rendered figure that the seller never entered as a price is
-- not a published price, exactly as «طلب تسويق» is not a price. The correct discriminator is the one
-- their guard uses — an explicit total label (السعر/المطلوب/قيمة) adjacent to that exact figure —
-- not the magnitude, and not price_per_meter = 1 on its own.
--
-- Nothing is reverted here. Their evidence is per-row and mine was an inference; the artifact being
-- corrected is my comment, not their data.
comment on function public.mon_price_size_fidelity_barrier() is
  'Price/size fidelity barrier (owner rule, 2026-08-10). Flags OUR fabrications only — a weird value '
  'the source really publishes is never a finding. Every row is a QUESTION to verify against source, '
  'never a licence to rewrite. Calibrated against three false-positive classes that fooled the audit '
  'itself: aqar printing a total inside its «سعر المتر» slot, «المساحة» appearing in seller prose and '
  'in «المساحة للقطعة رقم N», and aqar printing the pre-discount price before the current one. '
  'CORRECTED 2026-08-10: do NOT read price_per_meter = 1 as proof that area = price is source-real. '
  'The «سعر المتر 1» gimmick makes aqar RENDER area x 1 in the price slot with no seller-published '
  'total (proven per-row, migration 20260810202219). A rendered figure is not a published price. The '
  'discriminator is an explicit total label (السعر/المطلوب/قيمة) adjacent to that exact figure — see '
  'the AREA-ARTIFACT GUARD in aqar_parse().';

-- The stale P1: mon_detect_search_gate_leak was removed from the roster by
-- 20260810175327_roster_drop_superseded_search_gate_leak, but the crash alert it raised beforehand
-- is still open, so the dashboard shows a P1 for a detector that no longer exists. Resolve it with
-- the reason recorded, rather than leaving a permanently-red row that trains people to ignore P1s.
do $$
declare v_still_referenced int;
begin
  select count(*) into v_still_referenced
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
    and position('mon_detect_search_gate_leak' in pg_get_functiondef(p.oid)) > 0;

  -- Only safe to resolve BECAUSE the roster no longer calls it. If it were still referenced the
  -- alert would be live and resolving it would hide a real hole.
  if v_still_referenced > 0 then
    raise exception 'mon_detect_search_gate_leak is still in the roster — the crash alert is LIVE, not stale';
  end if;

  update public.alert_event
     set resolved_at = now(),
         detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object(
           'resolution', 'STALE, not fixed-by-code: mon_detect_search_gate_leak was dropped from the '
                      || 'roster by 20260810175327 (superseded). Verified at resolve time that '
                      || 'mon_run_all_detectors no longer references it, so the crash cannot recur. '
                      || 'mon_detect_orphaned_detectors covers the inverse case (a detector nothing calls).',
           'resolved_by', 'correct_price_size_barrier_ppm1_claim_and_resolve_stale_crash')
   where resolved_at is null
     and kind = 'detector_crash'
     and dedup_key like 'detector_crash:mon_detect_search_gate_leak%';
end $$;