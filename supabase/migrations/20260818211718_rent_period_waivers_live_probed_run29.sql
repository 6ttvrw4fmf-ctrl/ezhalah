-- Data Integrity run #29 follow-up (owner-directed): put live source evidence behind the
-- rent-period waivers, per owner permanent rule #2 (2026-08-13).
--
-- 38 listings across 10 source tables were re-fetched live from this container on 2026-08-18.
-- 37 returned HTTP 200. For every one of them the listing's OWN figure was located and the page was
-- read for a period token anchored to that figure (+/-70 chars), never to page chrome:
--
--   raghdan     11 probes, JSON-LD RealEstateListing/offers = [@type, availability,
--               businessFunction, price, priceCurrency]. price matches ours exactly (55000, 45000,
--               3700, 1500, 120000 ...), businessFunction = LeaseOut, and there is NO period,
--               unitCode, duration or billingPeriod key at all. This independently confirms the
--               note already carried in scrapers/raghdan/run.py, which records that a hardcoded
--               «سنوي» was removed from 127 rent rows on 2026-08-11 because the source never
--               stated it.
--   alkhaas      7 probes. Structured spec block «نوع العقار / قسم العقار / المنطقة / المدينة /
--               المساحة / السعر / السوم» - the price is labelled «السعر» with no period anywhere.
--   eastabha     6 probes. The page DOES carry «شهري»/«سنويا» - but only on OTHER ads in the
--               «إعلانات مشابهة» and «احدث العقارات» rails («شهري 5,000 ريال», «سنويا 220,000
--               ريال»). Beside these listings' own figures there is none. eastabha therefore
--               publishes a period per-advertiser, not never - see the CHANGE verdict below.
--   hajer        4 probes. «السعر : 14,000 ر.س» / «20,000 شامل الماي.» - no period.
--   ramzalqasim  3 probes. «السعر: 50,000 ر.س للاجار» - no period.
--   jurash       1 probe.  raw field dump «[pt_price] => 24000», no period key.
--   souq24       1 probe.  «مكتب للإيجار ... 200,000 ريال» - no period.
--   mizlaj       4 probes, HTTP 200 but the figure is not in the server HTML (client-rendered) and
--               the browser cannot traverse this environment's egress proxy. Recorded as
--               INCONCLUSIVE - it is not evidence, and must not be read as any.
--
-- The detector's exclusion test is tightened accordingly: an inconclusive probe must NOT clear a
-- waiver. A 200 that could not read the field looks identical to a 200 that read an absent field,
-- which is the very confusion owner rule #2 exists to prevent.

insert into public.ops_rent_period_source_probe
  (source_table, listing_id, probed_at, http_status, observed_subtype, method, evidence)
select v.source_table, v.listing_id, now(), v.http_status, null, v.method, v.evidence
from (values
('ramzalqasim_residential_listings',615823,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('ramzalqasim_residential_listings',615827,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('ramzalqasim_residential_listings',615836,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('alkhaas_commercial_listings',645757,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('raghdan_residential_listings',597790,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=55000; NO period/unitCode/duration key'),('raghdan_residential_listings',597803,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=45000; NO period/unitCode/duration key'),('raghdan_residential_listings',597894,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=65000; NO period/unitCode/duration key'),('raghdan_residential_listings',597898,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=70000; NO period/unitCode/duration key'),('raghdan_residential_listings',597899,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=100000; NO period/unitCode/duration key'),('raghdan_commercial_listings',597804,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=3700; NO period/unitCode/duration key'),('raghdan_commercial_listings',597805,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=120000; NO period/unitCode/duration key'),('raghdan_commercial_listings',597926,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=1500; NO period/unitCode/duration key'),('raghdan_commercial_listings',597927,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=3700; NO period/unitCode/duration key'),('raghdan_commercial_listings',597928,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=1500; NO period/unitCode/duration key'),('raghdan_commercial_listings',597973,200,'run29_live_jsonld','jsonld offers=[@type,availability,businessFunction,price,priceCurrency] price=3700; NO period/unitCode/duration key'),('jurash_residential_listings',645411,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('eastabha_residential_listings',595335,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('eastabha_residential_listings',595340,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('eastabha_residential_listings',595387,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('eastabha_residential_listings',595392,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('eastabha_residential_listings',595394,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('eastabha_residential_listings',595396,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('alkhaas_residential_listings',638739,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('alkhaas_residential_listings',638743,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('alkhaas_residential_listings',638744,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('alkhaas_residential_listings',638745,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('alkhaas_residential_listings',638747,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('alkhaas_residential_listings',638748,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('mizlaj_residential_listings',1034061,200,'run29_live_static_inconclusive','HTTP200 but listing figure absent from server HTML (client-rendered); not determinable statically'),('mizlaj_residential_listings',1034062,200,'run29_live_static_inconclusive','HTTP200 but listing figure absent from server HTML (client-rendered); not determinable statically'),('mizlaj_residential_listings',1034063,200,'run29_live_static_inconclusive','HTTP200 but listing figure absent from server HTML (client-rendered); not determinable statically'),('mizlaj_commercial_listings',1962630,200,'run29_live_static_inconclusive','HTTP200 but listing figure absent from server HTML (client-rendered); not determinable statically'),('hajer_residential_listings',584495,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('hajer_residential_listings',584500,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('hajer_residential_listings',584581,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('hajer_residential_listings',584589,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure'),('souq24_commercial_listings',648167,200,'run29_live_static','price on page, no period token within +/-70 chars of the figure')
) as v(source_table, listing_id, http_status, method, evidence);

-- Record the verdict on each waiver that live evidence now supports.
update public.ops_rent_period_sourceless
   set reason = reason || ' || run #29 live re-probe 2026-08-18: HTTP 200, listing''s own figure '
                          'located on the page/JSON-LD, no period token anchored to it. Per-row '
                          'evidence in ops_rent_period_source_probe (method run29_live_*).'
 where platform in ('raghdan','alkhaas','hajer','ramzalqasim','jurash','souq24');

update public.ops_rent_period_sourceless
   set reason = reason || ' || run #29 live re-probe 2026-08-18: 6/6 HTTP 200 with NO period beside '
                          'these listings'' own figures - BUT the same pages carry «شهري»/«سنويا» on '
                          'OTHER ads in the similar/latest rails, so eastabha publishes a period '
                          'per-advertiser rather than never. The platform-wide waiver is too coarse '
                          'here and is flagged for narrowing to per-listing (owner decision).'
 where platform = 'eastabha';

-- An inconclusive probe is not evidence. Tighten the exclusion test so it cannot clear a waiver.
create or replace function public.mon_detect_unprobed_source_waiver()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  total int := 0;
  rows_json jsonb;
begin
  select coalesce(jsonb_agg(x order by x->>'suppressed_rows' desc), '[]'::jsonb), count(*)
    into rows_json, total
  from (
    select jsonb_build_object(
             'platform', w.platform,
             'reason', left(w.reason, 200),
             'decided_at', w.decided_at,
             'suppressed_rows', (
               select count(*) from public.search_listings_ar s
                where s.platform = w.platform
                  and s.deal_ar = 'إيجار'
                  and (s.price_annual is not null or s.price_total is not null)
                  and (s.rent_period_ar is null or s.rent_period_ar not in ('سنوي','شهري'))),
             'inconclusive_probes', (
               select count(*) from public.ops_rent_period_source_probe p
                where p.source_table like w.platform || '\_%'
                  and p.method ilike '%inconclusive%')
           ) as x
      from public.ops_rent_period_sourceless w
     where not exists (
       select 1 from public.ops_rent_period_source_probe p
        where p.source_table like w.platform || '\_%'
          and p.http_status = 200
          -- a 200 that could not READ the field is not evidence that the field is absent
          and p.method not ilike '%inconclusive%')
  ) q;

  if total > 0 then
    n := public.mon_raise('P2', 'unprobed_source_waiver', 'all', 'unprobed_source_waiver',
      jsonb_build_object(
        'unprobed_waivers', total,
        'waivers', rows_json,
        'why', 'These platforms are waived out of mon_detect_rent_period_unreachable() - their priced '
               'Rent listings with no period are excluded from that barrier entirely - without a '
               'CONCLUSIVE HTTP-200 probe in ops_rent_period_source_probe. Owner permanent rule #2 '
               '(2026-08-13): a failed fetch and a source that publishes nothing look identical in our '
               'database, so absence is never self-proving. An inconclusive probe (HTTP 200 but the '
               'figure was not readable, e.g. a client-rendered page) does not count.',
        'do_not', 'Do NOT clear this by deleting the waivers, and do NOT import a period from a field '
                  'that merely looks right - aqar''s payload carries a rent_period_text reading «سنوي» '
                  'on genuinely monthly ads (§22.1). Clear it by probing the source and recording the '
                  'result, one platform at a time.'));
  else
    perform public.mon_resolve_key('unprobed_source_waiver', 'unprobed_source_waiver');
  end if;

  return n;
end
$function$;
