-- TWO DEFECTS IN ONE DETECTOR, both measured against production 2026-09-25 06:2xZ.
--
-- D1 — THE FLOOD. mon_detect_located_row_unreachable() raised 151 P1 alerts at 00:59 today
-- (sadin 83, souq24 44, alsidra 24), taking the open-alert queue from ~280 to 494. Every one of
-- those 151 rows is hidden ON PURPOSE, by the owner rule of 2026-09-24 that landed hours earlier
-- (migrations 20260925005252 / 20260925005642 / 20260925005730): "if a website goes down and it's
-- the problem there, we immediately hide their listings, and we include their name and logo in the
-- animation". The mechanism IS production_ready=false for a platform_registry.status='dormant'
-- platform — precisely the cohort this detector reads — so the intended fix and the alarm are the
-- same predicate, and the detector called the remedy a defect.
--
-- The payload makes it worse, and this is the part that wastes a responder's night: its 'adjudicate'
-- text sends every reader to the price/size gate ("If the price/size gate did it..."). Measured on
-- all 151: price_size_impossible() is FALSE. The one instruction the alert gives is provably the
-- wrong path for every row it gave it to. That is the same shape as the defect 20260924001500 and
-- 20260925xxxx (routine #2, yesterday) both fixed for sibling detectors: a monitor turning a
-- RECORDED, KNOWN cause into a wrong certainty about Ezhalah's side.
--
-- D2 — THE DANGEROUS ONE: THIS DETECTOR CAN MARK A REAL FINDING "RESOLVED" BY OVERFLOWING.
-- The cohort scan is `order by source_table, listing_id limit 200`, and the sweep ends with
-- mon_resolve_stale_keys(), which resolves EVERY open key of this kind absent from live_keys:
--     update alert_event set resolved_at = now()
--      where kind = p_kind and resolved_at is null and not (dedup_key = any (p_live_keys))
-- A row cut off by the LIMIT is absent from live_keys for a reason that is not "it was fixed", and
-- the sweep cannot tell those two apart. Measured today: cohort 154 of a 200 window — and the ONLY
-- genuine finding in it, wasalt_residential_listings 12915861 (trips_price_gate = true), sorts at
-- row 154 of 154. Forty-six more dormant rows — one more small platform going down — and a real
-- unreachable listing is not merely unreported, it is actively declared RESOLVED. Silence would
-- have been bad; a false all-clear is worse.
--
-- THE FIX, and what it deliberately does NOT do.
--   * The dormant cohort is EXCLUDED, not silenced: the join is LEFT and the test is
--     coalesce(status,'') <> 'dormant', so a platform missing from the registry still raises, and a
--     platform that answers again (status back to 'active') re-enters the cohort on the next sweep
--     with no migration. Nothing about the raise predicate, severity, dedup key or payload changes
--     for any row that is NOT dormant — the three genuine findings raise exactly as before.
--   * The truncation case now ALARMS instead of resolving. mon_resolve_stale_keys() is called only
--     when the whole cohort fit inside the window; when it does not, the sweep raises
--     located_row_unreachable_truncated and touches no existing alert. A checker that cannot see
--     its whole cohort must say so (LISTING_LIVENESS.md §9: a checker's silence must be an alarm).
--   * The new kind is born with a resolver, so it cannot become the ratchet
--     mon_detect_unresolvable_alert_kinds() exists to catch: the clean branch calls
--     mon_resolve_key() on the same key it raises, so it self-heals the moment the cohort fits.
--   * The window is left at 200. Raising it would trade one silent truncation point for a higher
--     one; the guard makes the boundary VISIBLE, which is the property that was missing.
--
-- PROVEN AGAINST REAL PRODUCTION, not inferred (all four executed 2026-09-25 06:2x-06:3xZ):
--   before  154 open located_row_unreachable (151 dormant, 3 genuine)
--   after   151 resolved, 3 genuine STILL OPEN (aqar 12710, raghdan 12586145, wasalt 12915861);
--           queue P1 321 -> 170
--   mutation proof of the guard: an identical clone with window_limit = 2 against the real cohort
--           of 3 raised located_row_unreachable_truncated and left all 3 genuine alerts OPEN, where
--           the old code would have resolved row 3 of 3
--   self-heal: the shipped function's next real sweep resolved that truncation alert (0 open), so
--           the new kind cannot become an unresolvable ratchet. Clone dropped.

create or replace function public.mon_detect_located_row_unreachable()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record; n int := 0; live_keys text[] := '{}';
  window_limit constant int := 200;
  cohort_total int;
begin
  -- The cohort, counted WITHOUT the window, so truncation is detectable at all. A dormant
  -- platform's rows are hidden by owner rule (2026-09-24) and are not a defect in this cohort.
  select count(*) into cohort_total
    from public.search_listings_ar s
    left join public.platform_registry pr on pr.platform = s.platform
   where s.city_id is not null
     and not s.production_ready
     and coalesce(pr.status, '') <> 'dormant';

  for rec in
    select s.source_table, s.listing_id, s.platform, s.city_ar, s.deal_ar,
           s.price_total, s.price_annual, s.area_m2,
           public.price_size_impossible(s.price_total, s.price_annual, s.area_m2) as trips_price_gate
      from public.search_listings_ar s
      left join public.platform_registry pr on pr.platform = s.platform
     where s.city_id is not null
       and not s.production_ready
       and coalesce(pr.status, '') <> 'dormant'
     order by s.source_table, s.listing_id
     limit window_limit
  loop
    live_keys := live_keys || ('located_row_unreachable:' || rec.source_table || ':' || rec.listing_id::text);
    n := n + public.mon_raise('P1', 'located_row_unreachable', rec.platform,
      'located_row_unreachable:' || rec.source_table || ':' || rec.listing_id::text,
      jsonb_build_object(
        'why', 'This row carries a city_id, so it fails the unlocated-search fallback (which '
             || 'requires city_id IS NULL); and it is not production_ready, so it fails the located '
             || 'branch. It is therefore unreachable by EVERY Normal Filter combination while still '
             || 'counting as present in search_listings_ar. Found twice in 8 hours on 2026-08-28/29.',
        'adjudicate', 'Ask WHY production_ready is false. If the price/size gate did it '
             || '(trips_price_gate = true), go to the SOURCE: an extreme value the source itself '
             || 'publishes belongs in ops_price_source_verified with a real evidence string, never '
             || 'repriced and never left hidden. If the source cannot be established, leave it '
             || 'hidden and say so — do NOT widen or bypass the gate, and do NOT register on a hunch. '
             || 'If trips_price_gate = false the gate is NOT the cause and that sentence does not '
             || 'apply: find what else cleared production_ready before proposing any repair. Rows '
             || 'hidden because their platform is dormant (source down, owner rule 2026-09-24) are '
             || 'excluded from this cohort and never appear here.',
        'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'city_ar', rec.city_ar, 'deal_ar', rec.deal_ar,
        'trips_price_gate', rec.trips_price_gate,
        'price_total', rec.price_total, 'price_annual', rec.price_annual, 'area_m2', rec.area_m2));
  end loop;

  if cohort_total <= window_limit then
    -- Evaluated path only (section 23a): the cohort that raises is the same cohort that resolves, so
    -- a cleared row goes GREEN and a genuine re-occurrence can raise again instead of being
    -- swallowed by an already-open dedup key. Safe ONLY because the whole cohort was in the window.
    perform public.mon_resolve_stale_keys('located_row_unreachable', live_keys);
    perform public.mon_resolve_key('located_row_unreachable_truncated',
                                   'located_row_unreachable_truncated:fleet');
  else
    -- The cohort outgrew the window. Resolving now would declare every row past row 200 fixed
    -- without looking at it. Raise instead, and leave every open alert exactly as it stands.
    n := n + public.mon_raise('P1', 'located_row_unreachable_truncated', 'all',
      'located_row_unreachable_truncated:fleet',
      jsonb_build_object(
        'why', 'mon_detect_located_row_unreachable() found more unreachable located rows than its '
             || 'scan window, so it cannot see its whole cohort. The stale-key sweep was SKIPPED '
             || 'this run on purpose: a row past the window is missing from live_keys for a reason '
             || 'that is not "it was fixed", and resolving on that would turn a real open finding '
             || 'into a false all-clear.',
        'fix', 'Work the located_row_unreachable alerts down below the window, or establish why the '
             || 'cohort grew. Do NOT raise window_limit to clear this — that moves the blind spot '
             || 'instead of removing it. This alert self-resolves on the next sweep in which the '
             || 'cohort fits.',
        'cohort_total', cohort_total, 'window_limit', window_limit,
        'not_resolved_this_run', true));
  end if;

  return n;
end $function$;
