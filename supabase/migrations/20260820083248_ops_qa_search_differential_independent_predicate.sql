-- QA differential oracle (Search & Matching QA engineer, docs/ops/SEARCH_MATCH_QA_ENGINEER.md §40.5).
-- An INDEPENDENT reimplementation of location_search_candidates_ar's MATCHING predicate, written from
-- the product contract rather than by calling the RPC, so that comparing (count, id-set md5) against the
-- RPC's own answer proves  missing = extra = duplicates = count-mismatch = 0  over the FULL searchable
-- inventory — not just the first page. It deliberately does NOT reimplement ordering, limit/offset,
-- per-platform diversity or the price gate: those are not matching, and an oracle that copied the RPC's
-- structure would prove nothing. Read-only, STABLE, no side effects.
create or replace function public.ops_qa_search_differential(
  p_tables     text[],
  p_types      text[],
  p_tables2    text[]   default null,
  p_types2     text[]   default null,
  p_deal       text     default null,
  p_period     text     default null,
  p_cat        text     default null,
  p_cities     text[]   default null,
  p_districts  text[]   default null,
  p_region_ids int[]    default null,
  p_amin       int      default null,
  p_amax       int      default null,
  p_beds       int[]    default null,
  p_bmin       int      default null,
  p_pmin       numeric  default null,
  p_pmax       numeric  default null
) returns table(n bigint, h text)
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
         where s.production_ready
           and s.deal_ar is not null
           and s.city_id is not null and s.region_id is not null
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
comment on function public.ops_qa_search_differential(text[],text[],text[],text[],text,text,text,text[],text[],int[],int,int,int[],int,numeric,numeric)
 is 'Independent matching oracle for the Search & Matching QA engineer (§40.5). Returns (count, md5 of the sorted source_table:listing_id set) for a search''s eligible set, computed WITHOUT calling location_search_candidates_ar, so a differential against the RPC proves missing=extra=duplicates=count-mismatch=0.';
grant execute on function public.ops_qa_search_differential(text[],text[],text[],text[],text,text,text,text[],text[],int[],int,int,int[],int,numeric,numeric) to authenticated, service_role;
