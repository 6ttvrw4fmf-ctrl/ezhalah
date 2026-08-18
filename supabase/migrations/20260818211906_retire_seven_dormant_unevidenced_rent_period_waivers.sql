-- Data Integrity run #29 follow-up (owner: "I do not want unsupported exceptions sitting
-- permanently in the architecture").
--
-- After the live probing, ops_rent_period_sourceless split cleanly in two:
--
--   9 waivers that actually suppress listings - raghdan 128, aqar 113, alkhaas 20, eastabha 17,
--     mizlaj 7, hajer 6, ramzalqasim 3, jurash 1, souq24 1 (296 rows) - ALL now backed by a
--     conclusive HTTP-200 probe recorded per row in ops_rent_period_source_probe.
--
--   7 waivers that suppress NOTHING - abeea, aldarim, alhoshan, dealapp, eaqartabuk, mustqr, sadin.
--     Each was decided by inspection on 2026-08-11, none was ever probed, and every one of these
--     platforms' priced rent listings currently carries a proper «سنوي»/«شهري» (dealapp 2,729 rent
--     rows, mustqr 162, eaqartabuk 117, abeea 49, sadin 9, aldarim 8, alhoshan 6 - zero period-less
--     among them).
--
-- A waiver that waives nothing is not protecting anything; it is only standing by to swallow a
-- future defect silently. Removing these seven changes NO listing today and restores barrier
-- coverage: if any of these platforms ever emits a priced rental with no period,
-- mon_detect_rent_period_unreachable() will now raise it instead of skipping the platform.
--
-- This is deliberately NOT applied to the nine evidenced waivers - those record a real, proven
-- source limitation and removing them would flood the barrier with rows whose answer is already
-- known and honest.

do $$
declare removed int; still_suppressing int;
begin
  -- refuse to remove any waiver that is currently suppressing a listing
  select count(*) into still_suppressing
    from public.ops_rent_period_sourceless w
   where w.platform in ('abeea','aldarim','alhoshan','dealapp','eaqartabuk','mustqr','sadin')
     and exists (select 1 from public.search_listings_ar s
                  where s.platform = w.platform and s.deal_ar = 'إيجار'
                    and (s.price_annual is not null or s.price_total is not null)
                    and (s.rent_period_ar is null or s.rent_period_ar not in ('سنوي','شهري')));
  if still_suppressing <> 0 then
    raise exception 'refusing: % of the seven waivers is/are actually suppressing listings', still_suppressing;
  end if;

  delete from public.ops_rent_period_sourceless
   where platform in ('abeea','aldarim','alhoshan','dealapp','eaqartabuk','mustqr','sadin');
  get diagnostics removed = row_count;
  if removed <> 7 then raise exception 'expected to retire exactly 7 dormant waivers, removed %', removed; end if;

  -- every surviving waiver must be probe-backed
  if exists (
    select 1 from public.ops_rent_period_sourceless w
     where not exists (select 1 from public.ops_rent_period_source_probe p
                        where p.source_table like w.platform || '\_%'
                          and p.http_status = 200 and p.method not ilike '%inconclusive%')
  ) then
    raise exception 'a surviving waiver still has no conclusive probe - refusing to leave that state';
  end if;
end $$;
