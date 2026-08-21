-- The §40.5 differential oracle reimplemented only HALF of the search RPC's row gate, so it
-- reported a false COUNT_MISMATCH on every location-less search.
--
-- location_search_candidates_ar admits a row when:
--     s.production_ready
--  OR ( no p_cities AND no p_districts AND no p_region_ids
--       AND NOT search_row_price_gated(s.deal_ar, s.price_total)
--       AND (s.region_id IS NULL OR s.city_id IS NULL) )   -- the "unlocated search contract"
--  AND (NOT s.production_ready OR (s.city_id IS NOT NULL AND s.region_id IS NOT NULL))
--
-- i.e. a listing whose location could not be resolved stays discoverable on a nationwide search,
-- but disappears the moment the user picks a city/حي/region — so it can never claim to be
-- somewhere the user filtered for. ops_qa_search_differential asserted the stricter
-- `production_ready AND city_id IS NOT NULL AND region_id IS NOT NULL` unconditionally.
--
-- Measured on production 2026-08-21 (daily Search & Matching QA run): 19 of 78 nationwide cells
-- mismatched, ALWAYS with rpc_total > sql_total, and every city-scoped search matched exactly.
-- The unlocated-row arithmetic reproduces the RPC's own totals exactly on 7/7 cross-checkable
-- cohorts (أرض سكنية 10,934 · فيلا 27,341 · دور 12,417 · فندق 75 · مكتب 63 · معرض 90 ·
-- دوبلكس 111). The RPC is CORRECT; the oracle was incomplete. The contract itself is not new —
-- see 20260810122326_unlocated_fallback_must_only_rescue_unlocated_rows.sql.
--
-- This is a barrier-integrity fix, not a product change and not a loosened test: a barrier that
-- cries wolf on every nationwide search is one a future major certification would learn to
-- explain away (§27/§40.7). The gate still EXCLUDES a non-production_ready row that HAS a
-- resolved location, and still excludes every non-production_ready row as soon as any location
-- filter is present.
--
-- Proven both directions on production after applying:
--   nationwide أرض سكنية/بيع 10,677 -> 10,934 = RPC (was COUNT_MISMATCH, now EXACT_SET_MATCH)
--   nationwide فندق/بيع hash 5821d7fade46d1e2c32b69b791160542 == the RPC's own set hash
--   city-scoped الرياض/أرض سكنية 2,246 and جدة/فيلا 3,684 BIT-IDENTICAL hashes before and after
--   10 located-but-not-ready rows stay excluded; 412 genuinely unlocated rows are admitted
--   (0 of those 412 are price-gated), so the branch discriminates rather than blanket-admits
--   ledger re-adjudication: 19 COUNT_MISMATCH + 5 SET_MISMATCH -> 0, 153/153 pass
create or replace function public.ops_qa_search_differential(
  p_tables text[],
  p_types text[],
  p_tables2 text[] default null,
  p_types2 text[] default null,
  p_deal text default null,
  p_period text default null,
  p_cat text default null,
  p_cities text[] default null,
  p_districts text[] default null,
  p_region_ids integer[] default null,
  p_amin integer default null,
  p_amax integer default null,
  p_beds integer[] default null,
  p_bmin integer default null,
  p_pmin numeric default null,
  p_pmax numeric default null)
returns table(n bigint, h text)
language sql stable as $$
  with ctok as (select normalize_ar(x) tok from unnest(coalesce(p_cities,'{}')) x),
       cids as (
         select cc.city_id from loc_catalog_city cc join ctok on cc.city_norm = ctok.tok
         union
         select a.city_id from loc_catalog_city_alias a join ctok on a.alias_norm = ctok.tok
       ),
       dtok as (select norm_district_tok(x) tok from unnest(coalesce(p_districts,'{}')) x),
       m as (
         select s.source_table||':'||s.listing_id as k
         from public.search_listings_ar s
         where
           -- EXACT mirror of the RPC's row gate, including the unlocated-search contract.
           (s.production_ready
            or ((p_cities is null or cardinality(p_cities) = 0)
                and (p_districts is null or cardinality(p_districts) = 0)
                and p_region_ids is null
                and not public.search_row_price_gated(s.deal_ar, s.price_total)
                and (s.region_id is null or s.city_id is null)))
           and s.deal_ar is not null
           -- a production_ready row must have a resolved location (RPC's own invariant)
           and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
           and (p_deal is null or s.deal_ar = p_deal)
           -- rent period, as the product defines it (RNPL monthly rows are annual-basis listings)
           and (p_period is null or s.deal_ar <> 'إيجار'
                or (p_period = 'شهري'   and s.payment_monthly and not coalesce(s.rent_now_pay_later,false))
                or (p_period = 'سنوي'   and (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false))))
                or (p_period = 'كلاهما' and (s.payment_monthly or s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))))
           -- the two (tables,types) scopes the client asked for
           and ( (s.source_table = any(p_tables) and (p_types is null or s.type_ar = any(p_types)))
                 or (p_tables2 is not null and p_types2 is not null
                     and s.source_table = any(p_tables2) and s.type_ar = any(p_types2)) )
           -- category purity against the canonical taxonomy
           and (p_cat is null or exists (
                 select 1 from known_type_ar k where k.type_ar = s.type_ar
                  and (k.macro = p_cat
                       or (k.macro='both' and case p_cat
                             when 'Residential' then s.source_table like '%\_residential\_listings'
                             when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                             else true end))))
           and (p_cities is null or cardinality(p_cities)=0
                or normalize_ar(s.city_ar) in (select tok from ctok)
                or s.city_id in (select city_id from cids)
                or s.match_city_ids && array(select city_id from cids))
           and (p_districts is null or cardinality(p_districts)=0
                or norm_district_tok(s.district_ar) in (select tok from dtok))
           and (p_region_ids is null or s.region_id = any(p_region_ids))
           and (p_amin is null or (s.area_m2 is not null and s.area_m2 >= p_amin))
           and (p_amax is null or (s.area_m2 is not null and s.area_m2 <= p_amax))
           and (p_beds  is null or s.bedrooms = any(p_beds))
           and (p_bmin  is null or (s.bedrooms is not null and s.bedrooms >= p_bmin))
           -- price on the correct basis: total for بيع, annual for إيجار (monthly bounds ×12)
           and ((p_pmin is null and p_pmax is null)
                or (s.deal_ar='بيع' and s.price_total is not null and s.price_total > 0
                    and s.price_total >= coalesce(p_pmin,0)
                    and s.price_total <= coalesce(p_pmax,1e15))
                or (s.deal_ar='إيجار' and s.price_annual is not null and s.price_annual > 0
                    and s.price_annual >= coalesce(p_pmin,0)*(case when p_period='شهري' then 12 else 1 end)
                    and s.price_annual <= coalesce(p_pmax,1e15)*(case when p_period='شهري' then 12 else 1 end)))
       )
  select count(*)::bigint, md5(string_agg(k, ',' order by k)) from m;
$$;
