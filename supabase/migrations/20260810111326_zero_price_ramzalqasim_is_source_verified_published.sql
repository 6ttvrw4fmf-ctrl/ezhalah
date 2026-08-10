-- ramzalqasim's zeros are SOURCE-VERIFIED PUBLISHED — stop alerting on correct data (2026-08-10).
--
-- mon_detect_zero_price_served was added earlier today on the hypothesis that a 0 price is the
-- source's "no price / السوم" sentinel. For ramzalqasim that hypothesis is now DISPROVEN by direct
-- evidence from the source itself (read-only probe, GitHub Actions run 31382195933, 11:09Z, from a
-- runner that can reach the host — the audit container is egress-blocked):
--
--   Layer 1, the updateMapMarkers payload the scraper parses:
--     ids 226/252/253/200/199/147 → price = the STRING '0.00'. Not null, not absent, not empty.
--     Whole-catalogue distribution: 179 non-zero, 6 zero, 0 null, 0 absent, 0 empty.
--
--   Layer 2, the PUBLIC page a human opens (https://ramzalqasim.com/x/253 and the other five):
--     «… السعر: 0 ر.س للبيع …»  —  "PRICE: 0 SAR", rendered in the very slot where a real price
--     appears. Control listing 251 renders «السعر: 540,000 ر.س» with identical markup, so the two
--     cases are directly comparable and the extraction is sound.
--
-- The site publishes the number. Under the standing owner rule — SOURCE IS TRUTH, a source-published
-- value is preserved at ANY magnitude and never "corrected" for looking implausible — the stored 0
-- is CORRECT and must stay. The listings were therefore NOT modified.
--
-- Leaving the detector as-is would have been the harm: a permanent P2 against data we have proven
-- correct, whose own alert text told the reader these were "almost always" sentinels — an
-- instruction to commit a fidelity violation. That is precisely the false-positive rot behind the
-- extreme_magnitude backlog open since 2026-08-03.
--
-- So: exclude the platform whose zeros are source-verified, and keep the detector armed for every
-- other platform, where an unverified 0 is still worth surfacing FOR VERIFICATION (never for a bulk
-- null). Regression protection for the preservation itself lives in
-- scrapers/common/tests/test_ramzalqasim_zero_price_is_source_published.py, which fails if anyone
-- nulls these values. If ramzalqasim ever stops publishing 0, re-run the probe and revisit — do not
-- infer it from the database.
create or replace function public.mon_detect_zero_price_served()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_cnt bigint; v_platforms text; v_open boolean; n int := 0;
begin
  select count(*), coalesce(string_agg(distinct platform, ',' order by platform), '')
    into v_cnt, v_platforms
    from public.search_listings_ar
   where production_ready
     -- ramzalqasim publishes «السعر: 0 ر.س» verbatim on the public page (verified 2026-08-10,
     -- probe run 31382195933). Its zeros are source truth, not a defect.
     and platform <> 'ramzalqasim'
     and case when deal_ar = 'بيع' then price_total = 0
              else coalesce(price_annual, price_total) = 0
         end;

  v_open := exists (select 1 from public.alert_event
                    where dedup_key = 'zero_price_served' and resolved_at is null);

  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('zero_price_served', 'search_index'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P2', 'zero_price_served', 'search_index', 'zero_price_served',
      jsonb_build_object(
        'count', v_cnt,
        'platforms', v_platforms,
        'why', 'a SEARCHABLE listing shows a price of exactly 0 for its own deal type, on a platform '
               'whose zeros are NOT yet source-verified. VERIFY AGAINST THE LIVE SOURCE PAGE before '
               'touching anything: if the page publishes 0, the 0 is correct and must be preserved '
               '(that is what ramzalqasim turned out to be); if the page shows no price or "on '
               'request", the honest value is NULL. Never bulk-null, never infer a price.'));
  else
    n := n + public.mon_raise('P2', 'zero_price_served', 'search_index', 'zero_price_served',
      jsonb_build_object('count', v_cnt, 'platforms', v_platforms,
        'why', 'a SEARCHABLE listing shows a price of exactly 0 for its own deal type, on a platform '
               'whose zeros are NOT yet source-verified — verify against the live source page first.'));
  end if;
  return n;
end $function$;
