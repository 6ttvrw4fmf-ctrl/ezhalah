-- Data Integrity run #29, owner product decision 2026-08-18.
--
-- ops_rent_period_sourceless exists to excuse platforms whose sources publish no rental period, by
-- excluding them from mon_detect_rent_period_unreachable(). The owner's period fallback removes the
-- condition it excused: every confirmed rent listing now carries a canonical period (سنوي unless
-- there is monthly evidence), so no priced rent listing is unreachable by a period chip any more.
--
-- Measured immediately before this migration - all nine surviving waivers suppress ZERO listings:
--   alkhaas 0 · aqar 0 · eastabha 0 · hajer 0 · jurash 0 · mizlaj 0 · raghdan 0 · ramzalqasim 0 ·
--   souq24 0   (they suppressed 296 between them this morning)
-- and mon_detect_rent_period_unreachable() already returns 0.
--
-- The same argument that retired the seven dormant waivers earlier today applies to all nine now: a
-- waiver that waives nothing protects nothing, and only stands by to swallow a future defect
-- silently. With them gone, if any of these platforms ever emits a priced rental the fallback does
-- not reach, the barrier raises it instead of skipping the platform.
--
-- This also satisfies the owner's Eastabha instruction directly - "Fix Eastabha per listing, not
-- with a platform-wide waiver ... Remove/replace any old Eastabha logic that suppresses or overrides
-- valid listing-level period evidence." Eastabha's classification is already per-listing in
-- scrapers/eastabha/run.py: three ordered LISTING-level signals (the price-label qualifier, an
-- explicit «الإيجار الشهري/السنوي» in title/description, then a شهري title marker), storing only
-- 'annual'/'monthly' and otherwise NULL - the hardcoded platform-wide 'annual' was removed by the
-- 2026-08-11 audit after 12 live rows read «شهري». Its waiver row was the last platform-wide
-- artifact, and it is removed here. mon_detect_rent_period_contract() limb 6 now guards the
-- per-listing rule permanently.
--
-- THE EVIDENCE IS NOT DISCARDED. Every probe stays in ops_rent_period_source_probe (102 HTTP-200
-- rows across the nine platforms), which is the permanent record that these sources genuinely
-- publish no period - the fact that justifies classifying them سنوي by fallback rather than
-- guessing. This migration removes the SUPPRESSION, not the truth.

do $$
declare removed int; still_suppressing int; unreachable_after int;
begin
  -- refuse if any waiver is still doing real work
  select count(*) into still_suppressing
    from public.ops_rent_period_sourceless w
   where exists (select 1 from public.search_listings_ar s
                  where s.platform = w.platform and s.deal_ar = 'إيجار'
                    and (s.price_annual is not null or s.price_total is not null)
                    and (s.rent_period_ar is null or s.rent_period_ar not in ('سنوي','شهري')));
  if still_suppressing <> 0 then
    raise exception 'refusing: % waiver(s) are still suppressing listings - the fallback has not reached them', still_suppressing;
  end if;

  -- refuse to drop a waiver whose source evidence was never recorded (the probe must outlive it)
  if exists (
    select 1 from public.ops_rent_period_sourceless w
     where not exists (select 1 from public.ops_rent_period_source_probe p
                        where p.source_table like w.platform || '\_%' and p.http_status = 200)
  ) then
    raise exception 'refusing: a waiver would be removed without its source probe surviving as evidence';
  end if;

  delete from public.ops_rent_period_sourceless;
  get diagnostics removed = row_count;
  if removed <> 9 then
    raise exception 'expected to retire exactly 9 vacuous waivers, removed %', removed;
  end if;

  -- with every waiver gone the barrier now sees ALL platforms - it must still be clean
  unreachable_after := public.mon_detect_rent_period_unreachable();
  if unreachable_after <> 0 then
    raise exception 'refusing: with the waivers removed the unreachable barrier raises (%) - the fallback does not cover everything', unreachable_after;
  end if;
end $$;

comment on table public.ops_rent_period_sourceless is
  'Platform-wide waivers excluding a platform from mon_detect_rent_period_unreachable(). EMPTIED by '
  'the owner product decision of 2026-08-18: every confirmed rent listing now carries a canonical '
  'period (سنوي unless there is monthly evidence), so no platform needs excusing and all nine '
  'waivers suppressed zero listings. The source evidence they rested on survives in '
  'ops_rent_period_source_probe. Adding a row here again means claiming a source publishes no '
  'period AND that the fallback does not reach it - it needs a recorded HTTP-200 probe (owner '
  'permanent rule #2, 2026-08-13) and mon_detect_unprobed_source_waiver will raise until it has one.';;
