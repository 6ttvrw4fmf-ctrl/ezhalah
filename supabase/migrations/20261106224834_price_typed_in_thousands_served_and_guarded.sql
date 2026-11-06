-- A PRICE TYPED IN THOUSANDS (owner 2026-11-06, option A: «show ≈ figure × 1000 with a small note, keep the source figure
-- visible — the same pattern as the land per-m² guard»).
--
-- Asas Makeen «سنا مكين — حي القيروان» (unit 2994, 98 m², 2 rooms) shows «75 ﷼» on its own page for a yearly flat: it
-- means 75,000. 8 of Asas Makeen's 62 rents sit at 55–85. Haraj land ads write «السوم 750 ألف» and type 750. Customers saw
-- a 75-riyal flat, and a 70k–80k yearly search could never find it.
--
-- PRICE = SOURCE: the platform tables and scrapers keep the source figure. Only the search index (search_listings_ar)
-- serves ≈ figure × 1000, flagged price_in_thousands; the card shows «≈» + «الموقع كتب 75 — قرأناه بالألف». One rule, in
-- the same place as the land guard (enforce_price_size_sanity), so the four count RPCs (location_search_candidates_ar,
-- af_eligible_count, apartment_guided_counts_ar, property_age_option_counts_ar), which all read the index's
-- price_total_effective / price_annual, and the card (effective_price) carry ONE number.
--
-- THE RULE — price_in_thousands_ar() (all must hold):
--   homes, buildings and business units (the judge_silent_rent_period_ar list; never rooms, rest houses, chalets, farms,
--   factories, Gathern / Aqar Monthly):
--     a. implausibly small for the deal: a sale < 10,000, a rent < 300 a year
--     b. figure × 1000 is inside the healthy band of that deal + type in the district (n ≥ 20) or city (n ≥ 30):
--        [0.75 × p10, 1.5 × p90] of healthy rows (sale ≥ 10,000; rent ≥ 1,000 with a period), refreshed daily
--        AND the per-m² reading (figure × area) is NOT also inside the band — both plausible = review, never a guess
--     OR the ad's own text writes «<the same number> ألف/الف» (land_price_unit_text_evidence)
--   land for sale (the land guard's signature: < 20,000, area ≥ 100, < 50/m², the site's box does not agree):
--     b'. the ad's words say «<the same number> ألف», OR figure × 1000 ÷ area is inside the land per-m² band while the
--         figure itself is NOT (the per-metre reading is out) — both inside and no words stays on the review list
--   always: never when the ad's words say per-metre, never price = area, ≤ 500,000,000, and the served figure lands OUTSIDE
--   every rule's own input range (rent ≥ 15,000 so the silent-period judge reads it yearly, never ×12 again; sale ≥ 20,000
--   so neither this rule nor the land rule can fire twice). Rent < 300 does not collide with the 300–7,999 monthly rule.
--
-- ALSO FIXED AT THE ROOT (falcon 2026-11-06, 20261106192129): the hourly sync upserts with ON CONFLICT; its INSERT pass
-- applies the rule, but the UPDATE pass saw an already-multiplied figure and cleared the flag, because the SET list did not
-- carry it. The sync now hands both flags over (ppm_typed_as_total, price_in_thousands) and the trigger keeps a flag the
-- writer handed over, exactly like the rent-period judgment does. The text evidence keeps the ad's words for rows already
-- corrected (it read the INDEX figure, so it dropped the words of every corrected row the next morning).
--
-- Every live-function edit is ONE exact text replace with a RAISE unless the anchor is found exactly once.

set local lock_timeout = '5s';
set local client_min_messages = warning;

alter table public.search_listings_ar add column if not exists price_in_thousands boolean not null default false;
comment on column public.search_listings_ar.price_in_thousands is
  'True when enforce_price_size_sanity() read the source price as written in THOUSANDS (price_in_thousands_served_ar) and serves figure × 1000 (price_total for a sale, price_annual for a rent). The platform table keeps the source figure. Owner 2026-11-06.';

-- Which types the home/business half of the rule covers (the judge_silent_rent_period_ar list).
create or replace function public.price_in_thousands_type_ok_ar(p_type text)
returns boolean
language sql
immutable
as $function$
  select p_type in ('شقة','فيلا','دور','دوبلكس','استوديو','بيت','عمارة','عمارة سكنية','مكتب','محل','مستودع','معرض','مبنى تجاري')
$function$;

-- The total-price band of healthy rows by deal + type + district (n ≥ 20) / city (district_ar = '', n ≥ 30).
create table if not exists public.price_thousands_band (
  deal_ar      text        not null,
  type_ar      text        not null,
  city_ar      text        not null,
  district_ar  text        not null default '',
  lo           numeric     not null,
  hi           numeric     not null,
  n            integer     not null,
  refreshed_at timestamptz not null default now(),
  primary key (deal_ar, type_ar, city_ar, district_ar)
);
alter table public.price_thousands_band enable row level security;
revoke all on public.price_thousands_band from anon, authenticated;

create or replace function public.refresh_price_thousands_band()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare n int;
begin
  delete from public.price_thousands_band where true;
  insert into public.price_thousands_band (deal_ar, type_ar, city_ar, district_ar, lo, hi, n, refreshed_at)
  select deal_ar, type_ar, city_ar, case when g = 1 then '' else d end, lo, hi, cnt, now()
    from (select h.deal_ar, h.type_ar, h.city_ar, h.d, count(*)::int cnt, grouping(h.d) g,
                 0.75 * percentile_cont(0.1) within group (order by h.p) lo,
                 1.5  * percentile_cont(0.9) within group (order by h.p) hi
            from (select s.deal_ar, s.type_ar, s.city_ar, coalesce(s.district_ar, '') d,
                         case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end p
                    from public.search_listings_ar s
                   where s.production_ready and not s.price_in_thousands and s.city_ar is not null
                     and public.price_in_thousands_type_ok_ar(s.type_ar)
                     and s.platform not in ('gathern', 'aqarmonthly')
                     and ((s.deal_ar = 'بيع' and s.price_total between 10000 and 500000000)
                       or (s.deal_ar = 'إيجار' and s.rent_period_ar is not null and s.price_annual between 1000 and 500000000))) h
           group by grouping sets ((h.deal_ar, h.type_ar, h.city_ar, h.d), (h.deal_ar, h.type_ar, h.city_ar))) b
   where (g = 0 and d <> '' and cnt >= 20) or (g = 1 and cnt >= 30);
  get diagnostics n = row_count;
  return n;
end
$function$;
revoke execute on function public.refresh_price_thousands_band() from public, anon, authenticated;

-- The pure rule. Returns figure × 1000, or NULL when the figure must stay as published.
create or replace function public.price_in_thousands_ar(p numeric, is_land boolean, is_rent boolean, area integer, ppm numeric,
                                                       band_lo numeric, band_hi numeric, says_per_m2 boolean, says_thousands boolean)
returns numeric
language sql
immutable
as $function$
  select p * 1000
   where p > 0 and p * 1000 <= 500000000
     and p * 1000 >= case when is_rent then 15000 else 20000 end
     and (area is null or abs(p - area) > 1)
     and not coalesce(says_per_m2, false)
     and case
           when is_land then
             not is_rent and p < 20000 and area >= 100 and p / area < 50
             and not (ppm is not null and abs(ppm * area - p) <= 0.05 * p)
             and (coalesce(says_thousands, false)
                  or (band_lo is not null and band_hi is not null
                      and p * 1000 / area between band_lo and band_hi and not (p between band_lo and band_hi)))
           else
             (case when is_rent then p < 300 else p < 10000 end)
             and (coalesce(says_thousands, false)
                  or (band_lo is not null and band_hi is not null
                      and p * 1000 between band_lo and band_hi
                      and not coalesce(p * area between band_lo and band_hi, false)))
         end
$function$;

-- The rule with its inputs looked up. Cheap exit for every row outside the signature.
create or replace function public.price_in_thousands_served_ar(p_source_table text, p_listing_id bigint, p_deal text, p numeric,
                                                              area integer, ppm numeric, p_type text, p_city text,
                                                              p_district text, p_platform text)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare v_land boolean; v_rent boolean; v_lo numeric; v_hi numeric; v_pm boolean; v_k boolean;
begin
  if p is null or p <= 0 or p >= 20000 or p_type is null or p_city is null or p_deal not in ('بيع', 'إيجار') then
    return null;
  end if;
  v_rent := p_deal = 'إيجار';
  v_land := p_type like 'أرض%' and p_type not like '%زراع%';
  if v_land then
    if v_rent or area is null or area < 100 or p / area >= 50 then return null; end if;   -- land rents stay on review
    select b.lo, b.hi into v_lo, v_hi
      from public.land_sale_ppm_band b
     where b.city_ar = p_city and b.district_ar in (coalesce(p_district, ''), '')
     order by (b.district_ar = '') limit 1;
  elsif public.price_in_thousands_type_ok_ar(p_type) and coalesce(p_platform, '') not in ('gathern', 'aqarmonthly') then
    if (v_rent and p >= 300) or (not v_rent and p >= 10000) then return null; end if;
    select b.lo, b.hi into v_lo, v_hi
      from public.price_thousands_band b
     where b.deal_ar = p_deal and b.type_ar = p_type and b.city_ar = p_city
       and b.district_ar in (coalesce(p_district, ''), '')
     order by (b.district_ar = '') limit 1;
  else
    return null;
  end if;
  select e.says_per_m2, e.says_thousands into v_pm, v_k
    from public.land_price_unit_text_evidence e
   where e.source_table = p_source_table and e.listing_id = p_listing_id;
  return public.price_in_thousands_ar(p, v_land, v_rent, area, ppm, v_lo, v_hi, v_pm, v_k);
end
$function$;
revoke execute on function public.price_in_thousands_served_ar(text, bigint, text, numeric, integer, numeric, text, text, text, text) from public, anon, authenticated;

-- Live-function edits, each ONE exact text replace (RAISE unless the anchor is found exactly once).
do $edit$
declare d text; k int;
  -- 1. the trigger: the land flag keeps a verdict the writer handed over (the sync's INSERT pass) …
  a_land text := E'  elsif TG_OP = ''INSERT'' or NEW.price_total is distinct from OLD.price_total or NEW.deal_ar is distinct from OLD.deal_ar then\n    NEW.ppm_typed_as_total := false;\n  end if;\n';
  b_land text := E'  elsif TG_OP = ''INSERT'' or ((NEW.price_total is distinct from OLD.price_total or NEW.deal_ar is distinct from OLD.deal_ar)\n'
    || E'                             and NEW.ppm_typed_as_total is not distinct from OLD.ppm_typed_as_total) then\n'
    || E'    -- a fresh figure the rule does not read per-metre; a flag the writer handed over (sync_search_listings_ar passes\n'
    || E'    -- its INSERT pass''s verdict) is kept: that pass already multiplied the figure this UPDATE sees (falcon 2026-11-06)\n'
    || E'    NEW.ppm_typed_as_total := false;\n  end if;\n'
  -- … and, right after it, the thousands rule.
    || E'\n  -- A PRICE TYPED IN THOUSANDS (owner 2026-11-06, option A): «75» for a yearly flat, «750» for «السوم 750 ألف». Serve\n'
    || E'  -- figure × 1000 (price_total for a sale, price_annual for a rent); the platform table keeps the figure. Rule, bands\n'
    || E'  -- and the ad''s words: price_in_thousands_served_ar(). Runs before trg_rent_period_judgment, which then reads the\n'
    || E'  -- served yearly figure (≥ 15,000 → سنوي).\n'
    || E'  v_fix := public.price_in_thousands_served_ar(NEW.source_table, NEW.listing_id, NEW.deal_ar,\n'
    || E'              case when NEW.deal_ar = ''إيجار'' then NEW.price_annual else NEW.price_total end,\n'
    || E'              NEW.area_m2, NEW.price_per_meter, NEW.type_ar, NEW.city_ar, NEW.district_ar, NEW.platform);\n'
    || E'  if v_fix is not null then\n'
    || E'    if NEW.deal_ar = ''إيجار'' then NEW.price_annual := v_fix; else NEW.price_total := v_fix; end if;\n'
    || E'    NEW.price_in_thousands := true;\n'
    || E'  elsif TG_OP = ''INSERT'' or ((NEW.price_total is distinct from OLD.price_total or NEW.price_annual is distinct from OLD.price_annual\n'
    || E'                              or NEW.deal_ar is distinct from OLD.deal_ar)\n'
    || E'                             and NEW.price_in_thousands is not distinct from OLD.price_in_thousands) then\n'
    || E'    NEW.price_in_thousands := false;\n'
    || E'  end if;\n';
  -- 2. the sync hands both verdicts over
  a_sync text := E'price_total=excluded.price_total, price_annual=excluded.price_annual,\n';
  b_sync text := E'price_total=excluded.price_total, price_annual=excluded.price_annual,\n'
    || E'    ppm_typed_as_total=excluded.ppm_typed_as_total, price_in_thousands=excluded.price_in_thousands,\n';
  -- 3. price_fidelity: the served figure IS the rule's answer for the source figure (flag or rule, as falcon's land fix)
  a_fid_t text := E's.type_ar, s.city_ar, s.district_ar))))\n';
  b_fid_t text := E's.type_ar, s.city_ar, s.district_ar)))\n'
    || E'           -- owner 2026-11-06: a price typed in thousands is served × 1000 (enforce_price_size_sanity)\n'
    || E'           and not (s.price_total = x.src_total * 1000 and (s.price_in_thousands or s.price_total = public.price_in_thousands_served_ar(s.source_table, s.listing_id, s.deal_ar, x.src_total, s.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform))))\n';
  a_fid_a text := E'           and not (s.rent_period_judged and s.price_annual = x.src_annual * 12))\n';
  b_fid_a text := E'           and not (s.rent_period_judged and s.price_annual = x.src_annual * 12)\n'
    || E'           and not (s.price_annual = x.src_annual * 1000 and (s.price_in_thousands or s.price_annual = public.price_in_thousands_served_ar(s.source_table, s.listing_id, s.deal_ar, x.src_annual, s.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform))))\n';
  -- 4. the ad's words: read for the SOURCE figure (a corrected row keeps its words), and for the thousands signature too
  a_ev text := E'    select s.source_table, s.listing_id, s.price_total\n      from public.search_listings_ar s\n     where s.deal_ar = ''بيع'' and s.type_ar like ''أرض%'' and s.type_ar not like ''%زراع%''\n       and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100 and s.price_total / s.area_m2 < 50\n       and s.price_total = trunc(s.price_total)\n';
  b_ev text := E'    select s.source_table, s.listing_id, f.fig as price_total\n      from public.search_listings_ar s\n'
    || E'      cross join lateral (select case when s.ppm_typed_as_total then s.price_per_meter::numeric\n'
    || E'                                      when s.price_in_thousands then (case when s.deal_ar = ''إيجار'' then s.price_annual else s.price_total end) / 1000\n'
    || E'                                      when s.deal_ar = ''إيجار'' then s.price_annual else s.price_total end as fig) f\n'
    || E'     where f.fig > 0 and f.fig = trunc(f.fig)\n'
    || E'       and ((s.deal_ar = ''بيع'' and s.type_ar like ''أرض%'' and s.type_ar not like ''%زراع%''\n'
    || E'             and f.fig < 20000 and s.area_m2 >= 100 and f.fig / s.area_m2 < 50)\n'
    || E'         or (public.price_in_thousands_type_ok_ar(s.type_ar) and s.platform not in (''gathern'', ''aqarmonthly'')\n'
    || E'             and ((s.deal_ar = ''بيع'' and f.fig < 10000) or (s.deal_ar = ''إيجار'' and f.fig < 300))))\n';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_price_size_sanity';
  if position('price_in_thousands_served_ar' in d) > 0 then raise exception 'enforce_price_size_sanity: already wired'; end if;
  k := (length(d) - length(replace(d, a_land, ''))) / length(a_land);
  if k <> 1 then raise exception 'enforce_price_size_sanity: expected exactly 1 anchor, found %', k; end if;
  execute replace(d, a_land, b_land);

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'sync_search_listings_ar';
  k := (length(d) - length(replace(d, a_sync, ''))) / length(a_sync);
  if k <> 1 then raise exception 'sync_search_listings_ar: expected exactly 1 anchor, found %', k; end if;
  execute replace(d, a_sync, b_sync);

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'price_fidelity';
  k := (length(d) - length(replace(d, a_fid_t, ''))) / length(a_fid_t);
  if k <> 1 then raise exception 'price_fidelity: expected exactly 1 total anchor, found %', k; end if;
  k := (length(d) - length(replace(d, a_fid_a, ''))) / length(a_fid_a);
  if k <> 1 then raise exception 'price_fidelity: expected exactly 1 annual anchor, found %', k; end if;
  d := replace(d, a_fid_t, b_fid_t);
  execute replace(d, a_fid_a, b_fid_a);

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'refresh_land_price_unit_text_evidence';
  k := (length(d) - length(replace(d, a_ev, ''))) / length(a_ev);
  if k <> 1 then raise exception 'refresh_land_price_unit_text_evidence: expected exactly 1 anchor, found %', k; end if;
  execute replace(d, a_ev, b_ev);
end
$edit$;

-- THE REVIEW LIST gains the home/business rows the rule refuses to guess (the land rows it now corrects leave the land arm
-- by themselves: their served total is ≥ 20,000). Appended to the LIVE view definition, never re-typed.
do $view$
declare v text;
begin
  v := pg_get_viewdef('public.land_price_unit_review_ar'::regclass);
  if position('tiny_price_thousands_unclear' in v) > 0 then raise exception 'land_price_unit_review_ar: already extended'; end if;
  v := rtrim(rtrim(v), ';');
  execute 'create or replace view public.land_price_unit_review_ar with (security_invoker = true) as ' || v || $arm$
UNION ALL
 SELECT s.source_table, s.listing_id, s.platform, s.city_ar, s.district_ar, s.type_ar, s.deal_ar, s.area_m2,
        s.price_total, s.price_annual, s.price_per_meter,
        CASE WHEN b.lo IS NULL THEN 'tiny_price_no_band'
             WHEN x.p * 1000 BETWEEN b.lo AND b.hi THEN 'tiny_price_thousands_unclear'
             ELSE 'tiny_price_reads_per_m2' END AS reason
   FROM search_listings_ar s
   CROSS JOIN LATERAL (SELECT CASE WHEN s.deal_ar = 'إيجار' THEN s.price_annual ELSE s.price_total END AS p) x
   LEFT JOIN LATERAL (SELECT bb.lo, bb.hi FROM price_thousands_band bb
                       WHERE bb.deal_ar = s.deal_ar AND bb.type_ar = s.type_ar AND bb.city_ar = s.city_ar
                         AND bb.district_ar = ANY (ARRAY[COALESCE(s.district_ar, ''), ''])
                       ORDER BY (bb.district_ar = '') LIMIT 1) b ON true
  WHERE s.production_ready AND NOT s.price_in_thousands AND price_in_thousands_type_ok_ar(s.type_ar)
    AND s.platform NOT IN ('gathern', 'aqarmonthly')
    AND ((s.deal_ar = 'بيع' AND x.p > 0 AND x.p < 10000) OR (s.deal_ar = 'إيجار' AND x.p > 0 AND x.p < 300))
    AND (s.area_m2 IS NULL OR abs(x.p - s.area_m2) > 1)
    AND (b.lo IS NULL OR x.p * 1000 BETWEEN b.lo AND b.hi OR coalesce(x.p * s.area_m2 BETWEEN b.lo AND b.hi, false))
$arm$;
end
$view$;
revoke all on public.land_price_unit_review_ar from anon, authenticated;

-- THE DAILY DETECTOR: refresh the band + the ad's words, REPAIR FIRST (a no-op update fires the trigger), P1 only for the
-- residue (= the trigger is off, replaced, or no longer calls the rule). The review list is raised by
-- mon_detect_land_ppm_typed_as_total (P2 land_price_unit_review counts every arm of the view).
create or replace function public.mon_detect_price_typed_in_thousands()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare n int := 0; v_healed bigint; v_left bigint; v_sample jsonb;
begin
  perform public.refresh_price_thousands_band();
  perform public.refresh_land_price_unit_text_evidence();

  update public.search_listings_ar s set price_total = s.price_total
   where not s.price_in_thousands
     and ((s.deal_ar = 'بيع' and s.price_total > 0 and s.price_total < 20000)
       or (s.deal_ar = 'إيجار' and s.price_annual > 0 and s.price_annual < 300))
     and public.price_in_thousands_served_ar(s.source_table, s.listing_id, s.deal_ar,
           case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end,
           s.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform) is not null;
  get diagnostics v_healed = row_count;
  if v_healed = 0 then
    perform public.mon_resolve_key('price_typed_in_thousands_self_healed', 'price_typed_in_thousands_self_healed:fleet');
  else
    n := n + public.mon_raise('P2', 'price_typed_in_thousands_self_healed', 'search_index', 'price_typed_in_thousands_self_healed:fleet',
      jsonb_build_object('count', v_healed,
        'why', 'prices typed in thousands («75» for a yearly flat) were served × 1000 by this run (the trigger did it on the no-op update). Expected in small numbers: the bands and the ad''s words refresh daily, so a row that needed them waits for this run. A large count means rows reached the index past enforce_price_size_sanity().'));
  end if;

  create temp table pit_left on commit drop as
    select s.source_table, s.listing_id from public.search_listings_ar s
     where not s.price_in_thousands
       and ((s.deal_ar = 'بيع' and s.price_total > 0 and s.price_total < 20000)
         or (s.deal_ar = 'إيجار' and s.price_annual > 0 and s.price_annual < 300))
       and public.price_in_thousands_served_ar(s.source_table, s.listing_id, s.deal_ar,
             case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end,
             s.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform) is not null;
  select count(*) into v_left from pit_left;
  select coalesce(jsonb_agg(jsonb_build_object('t', source_table, 'id', listing_id)), '[]'::jsonb) into v_sample
    from (select * from pit_left order by source_table, listing_id limit 15) q;
  drop table pit_left;
  if v_left = 0 then
    perform public.mon_resolve_key('price_typed_in_thousands_served', 'price_typed_in_thousands_served:fleet');
  else
    n := n + public.mon_raise('P1', 'price_typed_in_thousands_served', 'search_index', 'price_typed_in_thousands_served:fleet',
      jsonb_build_object('count', v_left, 'sample', v_sample,
        'why', 'a price typed in thousands still shows as its tiny source figure after this detector re-judged it, so enforce_price_size_sanity() did not apply price_in_thousands_served_ar(): the trigger is disabled, replaced, or no longer calls it.',
        'fix', 'Check trg_price_size_sanity is enabled on search_listings_ar and enforce_price_size_sanity() still calls price_in_thousands_served_ar(). Never hide the row or edit the platform table to clear this.'));
  end if;
  return n;
end
$function$;
revoke execute on function public.mon_detect_price_typed_in_thousands() from public, anon, authenticated;

select cron.schedule('mon-price-typed-in-thousands', '46 5 * * *',
  $cron$set statement_timeout to '300s'; select public.mon_detect_price_typed_in_thousands();$cron$);

-- Inputs, then the backfill (a no-op update fires the trigger), then the detector (must find no residue).
select public.refresh_price_thousands_band();
select public.refresh_land_price_unit_text_evidence();
update public.search_listings_ar s set price_total = s.price_total
 where not s.price_in_thousands
   and ((s.deal_ar = 'بيع' and s.price_total > 0 and s.price_total < 20000)
     or (s.deal_ar = 'إيجار' and s.price_annual > 0 and s.price_annual < 300))
   and public.price_in_thousands_served_ar(s.source_table, s.listing_id, s.deal_ar,
         case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end,
         s.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform) is not null;
select public.mon_detect_price_typed_in_thousands();

-- Proof: the pure rule on the real shapes, the wiring, and the welcome-facts floors.
do $proof$
declare d text;
begin
  -- asasmakeen 24218839, الرياض / القيروان, شقة 98 m², rent «75»; band ≈ 22,500–97,500 → ≈ 75,000
  if public.price_in_thousands_ar(75, false, true, 98, null, 22500, 97500, null, null) is distinct from 75000 then raise exception 'PROOF: the Asas Makeen 75 is not read as 75,000'; end if;
  -- haraj 18706322, الرياض / ضاحية نمار, land 1,008 m², «750», text «السوم 750 ألف» → ≈ 750,000
  if public.price_in_thousands_ar(750, true, false, 1008, null, 637, 4033, false, true) is distinct from 750000 then raise exception 'PROOF: the haraj «750 ألف» plot is not read as 750,000'; end if;
  -- the same plot with no words: 750 and 744/m² are BOTH in band → ambiguous → stays on review
  if public.price_in_thousands_ar(750, true, false, 1008, null, 637, 4033, null, null) is not null then raise exception 'PROOF: an ambiguous plot was guessed'; end if;
  -- dealapp 21611873, الرياض, land 400 m², «1,720»: per-metre 1,720 is below the band, 4,300/m² is inside → ≈ 1,720,000
  if public.price_in_thousands_ar(1720, true, false, 400, null, 2213, 9750, null, null) is distinct from 1720000 then raise exception 'PROOF: a thousands-only plot was not read'; end if;
  -- real cheap land: الفوارة 1,158 m² at «15,055», box 13/m² agrees → untouched
  if public.price_in_thousands_ar(15055, true, false, 1158, 13, 100, 200, null, null) is not null then raise exception 'PROOF: real cheap land was touched'; end if;
  -- the ad says per-metre → never thousands
  if public.price_in_thousands_ar(1050, true, false, 550, null, 130, 2535, true, false) is not null then raise exception 'PROOF: a per-metre ad was read in thousands'; end if;
  -- an apartment sale «480» (dealapp 16238468, 200 m²): 480,000 in band, 96,000 not → ≈ 480,000
  if public.price_in_thousands_ar(480, false, false, 200, 2, 391500, 1125000, null, null) is distinct from 480000 then raise exception 'PROOF: the apartment «480» is not read'; end if;
  -- a villa «1,950» on 900 m²: 1,950,000 AND 1,755,000 both in band → review, never a guess
  if public.price_in_thousands_ar(1950, false, false, 900, null, 487500, 3000000, null, null) is not null then raise exception 'PROOF: an ambiguous villa was guessed'; end if;
  -- price = area (360 for 360 m²) → never
  if public.price_in_thousands_ar(360, false, false, 360, null, 100000, 5000000, null, null) is not null then raise exception 'PROOF: price = area was read'; end if;
  -- a «12» rent would serve 12,000 < 15,000 (the silent-period judge would ×12 it again) → never
  if public.price_in_thousands_ar(12, false, true, 100, null, 9000, 75000, false, true) is not null then raise exception 'PROOF: a sub-15,000 rent was served'; end if;
  -- a «1» placeholder → never
  if public.price_in_thousands_ar(1, false, false, 120, null, 300000, 1000000, null, null) is not null then raise exception 'PROOF: a placeholder was read'; end if;
  -- idempotence: the served figure is outside the rule's own input range
  if public.price_in_thousands_ar(75000, false, true, 98, null, 22500, 97500, null, null) is not null
     or public.price_in_thousands_ar(480000, false, false, 200, null, 391500, 1125000, null, null) is not null then raise exception 'PROOF: the rule fires twice'; end if;

  select prosrc into d from pg_proc where oid = 'public.enforce_price_size_sanity()'::regprocedure;
  if (length(d) - length(replace(d, 'public.price_in_thousands_served_ar(', ''))) / length('public.price_in_thousands_served_ar(') <> 1 then raise exception 'PROOF: the trigger does not call the rule exactly once'; end if;
  if position('public.price_in_thousands_served_ar(' in d) < position('public.land_ppm_typed_as_total_served_ar(' in d)
     or position('public.price_in_thousands_served_ar(' in d) > position('price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2)' || E'\n' in d) then raise exception 'PROOF: the rule is not between the land rule and the hide'; end if;
  if position('price_typed_in_meter_box_ar(' in d) = 0 or position('rent_now_pay_later' in d) = 0 then raise exception 'PROOF: the meter-box or RNPL block went missing'; end if;
  if position('price_in_thousands=excluded.price_in_thousands' in (select p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'sync_search_listings_ar')) = 0 then raise exception 'PROOF: the sync does not hand the flag over'; end if;
  select prosrc into d from pg_proc where oid = 'public.price_fidelity()'::regprocedure;
  if position('s.price_total = x.src_total * 1000' in d) = 0 or position('s.price_annual = x.src_annual * 1000' in d) = 0 then raise exception 'PROOF: price_fidelity does not know the rule'; end if;
  -- WELCOME FACTS: a review row's figure (< 10,000 sale, < 300 rent) is under every welcome price floor (sale ≥ 100,000,
  -- rent ≥ 3,000), so it joins no median; a corrected row joins at ≈ figure × 1000 — only where the guard is certain.
  select prosrc into d from pg_proc where oid = 'public.build_welcome_insights()'::regprocedure;
  if position('price_annual between 6000 and 500000' in d) = 0 or position('price_annual between 3000 and 2000000' in d) = 0
     or position('price_total between 100000 and 20000000' in d) = 0 or position('price_total between 200000 and 50000000' in d) = 0 then
    raise exception 'PROOF: a welcome price floor moved — review rows of the thousands rule may join a median';
  end if;
  raise notice 'PROOF OK: thousands read where certain; ambiguous, per-metre, price=area, placeholders, cheap land untouched; wired once; sync hands flags over; welcome floors hold';
end
$proof$;
