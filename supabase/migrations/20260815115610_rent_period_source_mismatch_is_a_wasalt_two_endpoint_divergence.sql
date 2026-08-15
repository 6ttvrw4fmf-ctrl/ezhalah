-- rent_period_source_mismatch (alert 500, open since 2026-08-13) — the detector keeps firing and
-- keeps being mis-read. Run #22 traced what it is actually comparing. The BEHAVIOUR is unchanged:
-- it still fires on all 11 rows. Only its message changes, from a claim that is false to the one
-- fact that matters. Never silence a barrier to make it green (§11) — make it say the true thing.
--
-- WHAT IT COMPARES. `rent_period` / `price_annual` and `ar_data` come from TWO DIFFERENT wasalt
-- endpoints, in two different languages, written by two different jobs:
--   * scrapers/wasalt/run.py     — the ENGLISH SEARCH-LIST __NEXT_DATA__ (/en/{sale,rent}/search).
--                                  Writes rent_period and price_annual. NEVER writes ar_data.
--   * scrapers/wasalt/enrich_ar.py — the ARABIC DETAIL page (/ar/...). Writes ar_data (and location
--                                  fields). NEVER writes rent_period or price_annual.
-- So "stored period vs ar_data.rentFreq" is list-endpoint vs detail-endpoint. When they disagree,
-- that is not per se an Ezhalah defect — it is wasalt publishing two different things, and this
-- detector cannot tell which one wasalt considers authoritative.
--
-- PROOF THAT REPAIRING FROM ar_data ALONE DOES NOT HOLD. 20260813064929 repaired listing 4334897 to
-- annual / 60,000 from ar_data, and argued the repair was stable because "run.py:248-256 ... would
-- write the same values". That check applied run.py's logic to ar_data — a payload run.py never
-- reads. Verified 2026-08-15: the row is back to monthly / 66,000 in BOTH legs (canonical and
-- search_listings_ar: «شهري», 66,000, payment_monthly=true), while its ar_data still says
-- rentFreq={yearly:{amount:60000,default_freq:true}}, expectedRent=60000, expectedRentType=«/سنة».
-- 205 `wasalt` run.py runs executed between the repair and now. The repair lasted hours.
-- (scraped_at is NOT evidence either way here: run.py never writes it, so it has read 2026-07-23
-- since insert regardless of how many times the row was re-parsed.)
--
-- THE COHORT'S SHAPE, all 11 measured against their OWN current ar_data on 2026-08-15: every one
-- disagrees with what run.py's rule would compute from ar_data, and in 9 of them the stored
-- implied monthly figure (price_annual/12) appears NOWHERE in ar_data — 12,000 / 4,500 / 2,400 /
-- 4,000 / 6,000 / 2,000 / 5,500. Where ar_data does carry a monthly amount it is consistently
-- HIGHER than the stored implied monthly (5,500 vs 4,500; 4,500 vs 4,000; 2,500 vs 2,000), which is
-- what a stale list-side capture against a fresher detail-side capture looks like.
--
-- WHAT IS NOT SETTLED, and why this run did not repair. Which endpoint wasalt treats as
-- authoritative cannot be established from captured data, and wasalt.sa is unreachable from the
-- audit runner (it geo-blocks datacenter IPs; production uses a Saudi residential proxy via
-- WASALT_PROXY_URL, and the agent egress proxy additionally denies CONNECT to wasalt.com). Picking
-- the detail endpoint would move served prices by up to 12x on rows whose list-side value may be
-- current. That is §16 stop condition 1 (source truth cannot be established) plus 5 (external
-- access unavailable) — NOT a licence to guess.
--
-- THE NEXT STEP THAT WOULD ACTUALLY SETTLE IT: capture the list-side rentFreq alongside the
-- detail-side one (a `list_rent_freq` column or a probe table) so the two are comparable per row and
-- over time, from a runner that can reach wasalt. Then the detector can say which side moved.

create or replace function public.mon_detect_rent_period_source_mismatch()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_bad bigint; v_checked bigint; n int := 0;
begin
  select count(*) filter (where stored_period is distinct from source_period), count(*)
    into v_bad, v_checked
    from public.mon_rent_period_source_corroboration
   where source_period is not null;

  if v_bad > 0 then
    n := public.mon_raise('P1', 'rent_period_source_mismatch', 'wasalt', 'rent_period_source_mismatch',
      jsonb_build_object(
        'mismatched', v_bad, 'corroborated', v_checked,
        'sample', (select jsonb_agg(jsonb_build_object('listing_id', listing_id, 'stored', stored_period,
                                                       'source', source_period, 'price_annual', price_annual,
                                                       'source_amount', source_amount))
                     from (select * from public.mon_rent_period_source_corroboration
                            where source_period is not null and stored_period is distinct from source_period
                            order by listing_id limit 20) x),
        'why', 'The stored rent period disagrees with the period in this row''s ar_data. Those are TWO '
               'DIFFERENT wasalt endpoints: rent_period/price_annual come from the ENGLISH SEARCH-LIST '
               'payload (scrapers/wasalt/run.py), ar_data comes from the ARABIC DETAIL page '
               '(scrapers/wasalt/enrich_ar.py), and neither job writes the other''s columns. A '
               'disagreement means wasalt published two different things — it does NOT by itself mean '
               'Ezhalah corrupted anything. It still matters: a yearly rent stored as monthly is '
               'annualised x12, so the served price can be 12x wrong in either direction.',
        'adjudicate', 'DO NOT repair these from ar_data alone — that has already been tried and it '
                      'regressed. 20260813064929 set listing 4334897 to annual/60000 from ar_data and '
                      'argued it was stable by applying run.py''s rule to ar_data, which run.py never '
                      'reads; 205 run.py runs later the row is back to monthly/66000 in both legs '
                      '(re-verified 2026-08-15). Settle it at the SOURCE: from a runner that can reach '
                      'wasalt.sa (it geo-blocks datacenter IPs — production uses WASALT_PROXY_URL), '
                      'capture the LIST-side rentFreq next to the DETAIL-side one and compare per row. '
                      'Only then is it knowable which side is current. Note scraped_at proves nothing '
                      'here: run.py never writes it.',
        'blocked_on', 'which wasalt endpoint is authoritative — source truth not establishable from '
                      'captured data alone (owner decision or a proxied re-probe)'));
  else
    perform public.mon_resolve_key('rent_period_source_mismatch', 'rent_period_source_mismatch');
  end if;
  return n;
end $$;

comment on function public.mon_detect_rent_period_source_mismatch() is
'Fires when a wasalt row''s stored rent_period disagrees with its ar_data rentFreq default. Run #22 '
'(2026-08-15) established these are two different wasalt endpoints — English search-list (run.py, '
'writes rent_period/price_annual) vs Arabic detail (enrich_ar.py, writes ar_data) — so a disagreement '
'is an endpoint divergence, not proof of an Ezhalah defect. Repairing from ar_data alone regresses: '
'20260813064929 did exactly that to listing 4334897 and it was back to its pre-repair monthly/66000 '
'within hours, across 205 run.py runs. Settling it needs a LIST-side rentFreq capture from a runner '
'that can reach wasalt.sa. 11 rows open at the time of writing.';

-- Behaviour must be unchanged: still fires, still on the same cohort.
do $$
declare v_rows bigint;
begin
  select count(*) into v_rows from public.mon_rent_period_source_corroboration
   where source_period is not null and stored_period is distinct from source_period;
  if v_rows <> 11 then
    raise exception 'expected the 11-row cohort this migration documents, found % — re-audit before trusting the text', v_rows;
  end if;
end $$;