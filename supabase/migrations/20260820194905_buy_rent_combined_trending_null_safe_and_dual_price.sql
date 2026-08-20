-- BUY + RENT COMBINED MODE, stage 1 (owner order 2026-08-19).
--
-- VERIFIED FIRST (dry run in BEGIN/ROLLBACK, 2026-08-20): combined_count(29354) = buy_only(10584) +
-- rent_only(18770) exactly. combined_buy_priced_only(25846) = buy_only_priced(7076) + rent_only
-- unfiltered(18770) exactly -- proves the two price ranges are independent per-deal, never mixed.
-- trending_combined_rows=380 (was 0 before the null-safety fix). Single-deal regression calls
-- (buy_only_priced_regression, rent_only_priced_regression) use the byte-identical original branches.
--
-- Two backend gaps fixed here, using SERVER-SIDE replace() with an occurrence-count assertion
-- (raises if the anchor snippet isn't found EXACTLY once) instead of retransmitting the full ~8KB
-- function bodies through a base64 round-trip -- a prior attempt corrupted one character of a 2.4KB
-- base64 blob in transit and produced a "coalese" typo; this technique makes any transcription slip
-- fail loudly (occurrence count != 1) instead of silently creating broken SQL.
--   1. top_cities_by_deal_ar had a HARD 's.deal_ar = p_deal' equality -- NULL = anything is always
--      false in SQL, so combined mode would have silently returned ZERO trending cities.
--      district_options_ar was ALREADY null-safe on p_deal; mirrored that exact pattern here.
--   2. af_eligibility_clause()'s price predicate gains p_price_min_rent/p_price_max_rent (owner
--      decision, asked and answered: TWO independent ranges shown together, never one naive shared
--      range). Existing p_price_min/p_price_max are BYTE-IDENTICAL in every single-deal call shape --
--      zero regression, proven above. In combined mode (p_deal is null) a Buy row is checked against
--      p_price_min/max (price_total), a Rent row against the NEW p_price_min_rent/max_rent
--      (price_annual, ANNUAL basis -- reusing the already-shipped rentPeriod='both' precedent:
--      search.ts "explicitBoth = q.rentPeriod === 'both'; // annual basis").
do $$
declare
  old_snip text := $oldp$and ((nullif(p_price_min,0) is null and nullif(p_price_max,0) is null)
           or (s.deal_ar = ''بيع''
               and s.price_total is not null and s.price_total > 0
               and s.price_total >= coalesce(p_price_min,0) and s.price_total <= coalesce(nullif(p_price_max,0),1e15))
           or (s.deal_ar = ''إيجار''
               and s.price_annual is not null and s.price_annual > 0
               and s.price_annual >= coalesce(p_price_min,0)*(case when p_rent_period=''شهري'' then 12 else 1 end)
               and s.price_annual <= coalesce(nullif(p_price_max,0),1e15)*(case when p_rent_period=''شهري'' then 12 else 1 end)))$oldp$;
  new_snip text := $newp$and (
            (p_deal is null and s.deal_ar = ''بيع''
             and (nullif(p_price_min,0) is null and nullif(p_price_max,0) is null
                  or (s.price_total is not null and s.price_total > 0
                      and s.price_total >= coalesce(p_price_min,0) and s.price_total <= coalesce(nullif(p_price_max,0),1e15))))
         or (p_deal is null and s.deal_ar = ''إيجار''
             and (nullif(p_price_min_rent,0) is null and nullif(p_price_max_rent,0) is null
                  or (s.price_annual is not null and s.price_annual > 0
                      and s.price_annual >= coalesce(p_price_min_rent,0)
                      and s.price_annual <= coalesce(nullif(p_price_max_rent,0),1e15))))
         or (p_deal is not null and nullif(p_price_min,0) is null and nullif(p_price_max,0) is null)
         or (p_deal is not null and s.deal_ar = ''بيع''
               and s.price_total is not null and s.price_total > 0
               and s.price_total >= coalesce(p_price_min,0) and s.price_total <= coalesce(nullif(p_price_max,0),1e15))
         or (p_deal is not null and s.deal_ar = ''إيجار''
               and s.price_annual is not null and s.price_annual > 0
               and s.price_annual >= coalesce(p_price_min,0)*(case when p_rent_period=''شهري'' then 12 else 1 end)
               and s.price_annual <= coalesce(nullif(p_price_max,0),1e15)*(case when p_rent_period=''شهري'' then 12 else 1 end)))$newp$;
  cur text;
  occurrences int;
begin
  select prosrc into cur from pg_proc where proname='af_eligibility_clause' and pronamespace='public'::regnamespace;
  occurrences := (length(cur) - length(replace(cur, old_snip, ''))) / length(old_snip);
  if occurrences <> 1 then
    raise exception 'af_eligibility_clause: expected 1 occurrence of old price snippet, found %', occurrences;
  end if;
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $afc$%s$afc$', replace(cur, old_snip, new_snip));
end $$;

do $$
declare
  old_snip text := 'WHERE s.production_ready = true AND s.deal_ar = p_deal';
  new_snip text := 'WHERE s.production_ready = true AND (p_deal IS NULL OR s.deal_ar = p_deal)';
  cur text;
  occurrences int;
begin
  select prosrc into cur from pg_proc where proname='top_cities_by_deal_ar' and pronamespace='public'::regnamespace;
  occurrences := (length(cur) - length(replace(cur, old_snip, ''))) / length(old_snip);
  if occurrences <> 1 then
    raise exception 'top_cities_by_deal_ar: expected 1 occurrence of old deal predicate, found %', occurrences;
  end if;
  execute format(
    'create or replace function public.top_cities_by_deal_ar('
    || '  p_deal text, p_rent_period text default null, p_category text default null, p_types text[] default null'
    || ') returns table(city_id integer, city_ar text, region_id integer, region_ar text, '
    || '  listing_count integer, total_in_cohort integer) '
    || 'language sql stable as $tcbd$%s$tcbd$', replace(cur, old_snip, new_snip));
end $$;

-- Add the two new price params to all 4 AF template signatures (default null -- zero call-shape change).
update af_rpc_templates set template = replace(template,
  'p_rating_min numeric DEFAULT NULL::numeric, p_reviews_min integer DEFAULT NULL::integer, p_unit_subtypes text[] DEFAULT NULL::text[])',
  'p_rating_min numeric DEFAULT NULL::numeric, p_reviews_min integer DEFAULT NULL::integer, p_unit_subtypes text[] DEFAULT NULL::text[], p_price_min_rent numeric DEFAULT NULL::numeric, p_price_max_rent numeric DEFAULT NULL::numeric)')
where position('p_price_min_rent' in template) = 0;

select fn_name, left(def_md5,8) md5 from rebuild_af_filter_rpcs() as r(o_fn_name, o_def_md5), lateral (select r.o_fn_name fn_name, r.o_def_md5 def_md5) x;
