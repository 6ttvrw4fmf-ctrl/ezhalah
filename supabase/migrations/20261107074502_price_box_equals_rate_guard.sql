-- THE SAME FIGURE IN BOTH PRICE BOXES (owner 2026-11-07: «Fix it all make sure it never ever happens»).
--
-- A whole price and a per-metre price are never the same number for more than 1 m², so when the index row carries the
-- same figure in both boxes one of them is a parser's copy. Measured 2026-11-07 07:30 UTC, 38 rows on 5 sites:
--   * the RATE copied into the total box — aqargate 23 land rows after its 11-05 rebuild («40 ﷼» for 106,474 m² in
--     الدلم), aqar 4 (a 10,000 m² farm «600 ﷼», a 2,494 m² rest house «3,500 ﷼», a workshop and a warehouse rented at
--     «200» / «150 ﷼ a year» for 20,000 m²);
--   * the TOTAL copied into the per-metre box — abaad 7 land rows («355,000 ﷼ per m²» beside a 355,000 total), haraj 1,
--     aqar 2 farm rents, aqarcity 1.
-- The rules above it in enforce_price_size_sanity() (meter-box typo, land per-m² typed as total, typed in thousands)
-- all assume the two boxes disagree, so every one of these passed through.
--
-- THE RULE — price_box_equals_rate_ar(deal, figure, per-metre, area), applied LAST of the price rules (after the
-- thousands rule, before the hide), only when figure = per-metre and area > 1:
--   figure ≥ 100,000                        → 'total': the per-metre box is the copy (no Saudi rate is ≥ 100,000/m² —
--                                              the same ceiling as the meter-box typo rule, 20261030235606); empty it.
--   figure < 10,000 and figure × area ≤ 500,000,000, and (a sale, or a rent on ≥ 1,000 m²)
--                                           → 'rate': the total box is the copy; empty it. A sale left with its rate
--                                              shows ≈ rate × area, labelled (price_total_effective, owner 2026-09-03);
--                                              a rent shows «price on request» with its rate line.
--   anything else (10,000–99,999, a small rent) → untouched, and the daily detector raises it for a person.
-- PRICE = SOURCE: nothing is invented and the platform tables keep what the scraper wrote; only the index stops serving
-- the copy. The root parsers are the scraping engineer's (aqargate fixed in #11014).
--
-- WATCHED: mon_detect_price_box_equals_rate() (daily 06:09 UTC, outside the :22–:35 sync) repairs first (a no-op update fires the trigger), then
-- raises P1 for any SHOWN row still carrying one figure in both boxes. Barrier: scripts/verify-price-box-equals-rate.ts.
-- Every live-function edit is ONE exact text replace with a RAISE unless the anchor is found exactly once.

set local lock_timeout = '5s';
set local client_min_messages = warning;

create or replace function public.price_box_equals_rate_ar(p_deal text, p_figure numeric, p_ppm numeric, p_area numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case
    when p_deal is null or p_deal not in ('بيع', 'إيجار') or p_figure is null or p_ppm is null or p_area is null
         or p_area <= 1 or p_figure <= 0 or p_figure <> p_ppm then null
    when p_figure >= 100000 then 'total'
    when p_figure < 10000 and p_figure * p_area <= 500000000 and (p_deal = 'بيع' or p_area >= 1000) then 'rate'
  end
$function$;
revoke execute on function public.price_box_equals_rate_ar(text, numeric, numeric, numeric) from public, anon, authenticated;
comment on function public.price_box_equals_rate_ar(text, numeric, numeric, numeric) is
  'Owner 2026-11-07: the same figure in the price box and the per-metre box (area > 1) — which box is the parser''s copy: ''total'' (empty the per-metre box), ''rate'' (empty the price box), null (not this shape, or unclear). Applied last in enforce_price_size_sanity().';

-- Live-function edits, each ONE exact text replace (RAISE unless the anchor is found exactly once).
do $edit$
declare d text; k int;
  -- 1. the trigger: right after the thousands rule, before the hide
  a_trig text := E'    NEW.price_in_thousands := false;\n  end if;\n';
  b_trig text := E'    NEW.price_in_thousands := false;\n  end if;\n'
    || E'\n  -- THE SAME FIGURE IN BOTH PRICE BOXES (owner 2026-11-07 «make sure it never ever happens»): a whole price and a\n'
    || E'  -- per-metre price are never the same number for more than 1 m², so after the rules above one box is a parser''s copy\n'
    || E'  -- (aqargate 11-06: «40 ﷼» for 106,474 m²). price_box_equals_rate_ar() names the copy and only that box is emptied;\n'
    || E'  -- nothing is invented: a sale left with its rate shows ≈ rate × area, labelled (price_total_effective).\n'
    || E'  case public.price_box_equals_rate_ar(NEW.deal_ar, case when NEW.deal_ar = ''إيجار'' then NEW.price_annual else NEW.price_total end,\n'
    || E'                                       NEW.price_per_meter, NEW.area_m2)\n'
    || E'    when ''rate'' then\n'
    || E'      if NEW.deal_ar = ''إيجار'' then NEW.price_annual := null; else NEW.price_total := null; end if;\n'
    || E'    when ''total'' then\n'
    || E'      NEW.price_per_meter := null;\n'
    || E'    else null;\n'
    || E'  end case;\n';
  -- 2. price_fidelity: an emptied copy is the rule at work, not drift
  a_fid_t text := E's.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform))))\n       or (s.price_annual is distinct from x.src_annual\n';
  b_fid_t text := E's.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform)))\n'
    || E'           -- owner 2026-11-07: the same figure in both boxes serves the rate as a rate (enforce_price_size_sanity)\n'
    || E'           and not (s.price_total is null and public.price_box_equals_rate_ar(s.deal_ar, x.src_total, s.price_per_meter, s.area_m2) = ''rate''))\n'
    || E'       or (s.price_annual is distinct from x.src_annual\n';
  a_fid_a text := E's.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform))))\n  ),\n';
  b_fid_a text := E's.area_m2, s.price_per_meter, s.type_ar, s.city_ar, s.district_ar, s.platform)))\n'
    || E'           and not (s.price_annual is null and public.price_box_equals_rate_ar(s.deal_ar, x.src_annual, s.price_per_meter, s.area_m2) = ''rate''))\n'
    || E'  ),\n';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_price_size_sanity';
  if position('price_box_equals_rate_ar' in d) > 0 then raise exception 'enforce_price_size_sanity: already wired'; end if;
  k := (length(d) - length(replace(d, a_trig, ''))) / length(a_trig);
  if k <> 1 then raise exception 'enforce_price_size_sanity: expected exactly 1 anchor, found %', k; end if;
  execute replace(d, a_trig, b_trig);

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'price_fidelity';
  k := (length(d) - length(replace(d, a_fid_t, ''))) / length(a_fid_t);
  if k <> 1 then raise exception 'price_fidelity: expected exactly 1 total anchor, found %', k; end if;
  k := (length(d) - length(replace(d, a_fid_a, ''))) / length(a_fid_a);
  if k <> 1 then raise exception 'price_fidelity: expected exactly 1 annual anchor, found %', k; end if;
  d := replace(d, a_fid_t, b_fid_t);
  execute replace(d, a_fid_a, b_fid_a);
end
$edit$;

-- THE DAILY DETECTOR: REPAIR FIRST (a no-op update fires the trigger), P1 only for the residue — a SHOWN row that still
-- carries one figure in both boxes (the rule could not say which box is the copy, or the trigger no longer applies it).
create or replace function public.mon_detect_price_box_equals_rate()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare n int := 0; v_healed bigint; v_left bigint; v_sample jsonb;
begin
  update public.search_listings_ar s set price_per_meter = s.price_per_meter
   where s.price_per_meter > 0 and s.area_m2 > 1
     and (s.price_total = s.price_per_meter or s.price_annual = s.price_per_meter)
     and public.price_box_equals_rate_ar(s.deal_ar, case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end,
                                         s.price_per_meter, s.area_m2) is not null;
  get diagnostics v_healed = row_count;
  if v_healed = 0 then
    perform public.mon_resolve_key('price_box_equals_rate_self_healed', 'price_box_equals_rate_self_healed:fleet');
  else
    n := n + public.mon_raise('P2', 'price_box_equals_rate_self_healed', 'search_index', 'price_box_equals_rate_self_healed:fleet',
      jsonb_build_object('count', v_healed,
        'why', 'rows carried the same figure in the price box and the per-metre box and were fixed by this run (the trigger did it on the no-op update). A large count means rows reached the index past enforce_price_size_sanity(), or a scraper started copying one box into the other — find the platform and fix its parser.'));
  end if;

  create temp table pber_left on commit drop as
    select s.platform, s.source_table, s.listing_id, s.deal_ar, s.area_m2, s.price_per_meter
      from public.search_listings_ar s
     where s.production_ready and s.price_per_meter > 0 and s.area_m2 > 1
       and (case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end) = s.price_per_meter;
  select count(*) into v_left from pber_left;
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_sample
    from (select * from pber_left order by platform, listing_id limit 15) q;
  drop table pber_left;
  if v_left = 0 then
    perform public.mon_resolve_key('price_box_equals_rate', 'price_box_equals_rate:fleet');
  else
    n := n + public.mon_raise('P1', 'price_box_equals_rate', 'search_index', 'price_box_equals_rate:fleet',
      jsonb_build_object('count', v_left, 'sample', v_sample,
        'why', 'a shown ad still carries the same figure as its whole price and its per-metre price (area > 1), so one of the two is a parser''s copy and the card shows a wrong number. Either the figure sits between the rule''s bands (10,000–99,999, or a rent under 1,000 m²) or enforce_price_size_sanity() no longer applies price_box_equals_rate_ar().',
        'fix', 'Open the ad on its site: which box is real? Fix the platform''s parser so it stops copying one box into the other. Check trg_price_size_sanity is enabled and the trigger still calls price_box_equals_rate_ar(). Never invent a price.'));
  end if;
  return n;
end
$function$;
revoke execute on function public.mon_detect_price_box_equals_rate() from public, anon, authenticated;

select cron.schedule('mon-price-box-equals-rate', '9 6 * * *',
  $cron$set statement_timeout to '300s'; select public.mon_detect_price_box_equals_rate();$cron$);

-- The backfill (the detector repairs first), then the proof.
select public.mon_detect_price_box_equals_rate();

do $proof$
declare d text; v_left bigint;
begin
  -- aqargate 583449, الدلم land 106,474 m², «40» in both boxes → the rate (≈ 4,258,960 served, labelled)
  if public.price_box_equals_rate_ar('بيع', 40, 40, 106474) is distinct from 'rate' then raise exception 'PROOF: the aqargate rate was not read as a rate'; end if;
  -- abaad 17060146, land 710 m², «355,000» in both boxes → the total
  if public.price_box_equals_rate_ar('بيع', 355000, 355000, 710) is distinct from 'total' then raise exception 'PROOF: the abaad total was not read as a total'; end if;
  -- aqar 1924571, a 20,105 m² workshop rented at «200» in both boxes → the rate
  if public.price_box_equals_rate_ar('إيجار', 200, 200, 20105) is distinct from 'rate' then raise exception 'PROOF: a per-metre rent was not read as a rate'; end if;
  -- aqar 293824, a 3,482 m² farm rented at «100,000» in both boxes → the total
  if public.price_box_equals_rate_ar('إيجار', 100000, 100000, 3482) is distinct from 'total' then raise exception 'PROOF: a farm rent was not read as a total'; end if;
  -- unclear figures, a small rent, different boxes, 1 m², no deal → untouched
  if public.price_box_equals_rate_ar('بيع', 30000, 30000, 500) is not null then raise exception 'PROOF: an unclear figure was guessed'; end if;
  if public.price_box_equals_rate_ar('إيجار', 5000, 5000, 120) is not null then raise exception 'PROOF: a small rent lost its yearly price'; end if;
  if public.price_box_equals_rate_ar('بيع', 1500, 1400, 437) is not null then raise exception 'PROOF: two different boxes were judged'; end if;
  if public.price_box_equals_rate_ar('بيع', 5000, 5000, 1) is not null then raise exception 'PROOF: a 1 m² row was judged'; end if;
  if public.price_box_equals_rate_ar(null, 40, 40, 106474) is not null then raise exception 'PROOF: a row with no deal was judged'; end if;
  -- an absurd product is never served
  if public.price_box_equals_rate_ar('بيع', 9000, 9000, 100000) is not null then raise exception 'PROOF: a > 500,000,000 product was served'; end if;

  select prosrc into d from pg_proc where oid = 'public.enforce_price_size_sanity()'::regprocedure;
  if (length(d) - length(replace(d, 'public.price_box_equals_rate_ar(', ''))) / length('public.price_box_equals_rate_ar(') <> 1 then raise exception 'PROOF: the trigger does not call the rule exactly once'; end if;
  if position('public.price_box_equals_rate_ar(' in d) < position('public.price_in_thousands_served_ar(' in d)
     or position('public.price_box_equals_rate_ar(' in d) > position('price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2)' || E'\n' in d) then raise exception 'PROOF: the rule is not between the thousands rule and the hide'; end if;
  if position('price_typed_in_meter_box_ar(' in d) = 0 or position('rent_now_pay_later' in d) = 0
     or position('public.land_ppm_typed_as_total_served_ar(' in d) = 0 then raise exception 'PROOF: an earlier block of the trigger went missing'; end if;
  select prosrc into d from pg_proc where oid = 'public.price_fidelity()'::regprocedure;
  if position('s.price_total is null and public.price_box_equals_rate_ar(' in d) = 0 or position('s.price_annual is null and public.price_box_equals_rate_ar(' in d) = 0
     or position('s.price_total = x.src_total * 1000' in d) = 0 then raise exception 'PROOF: price_fidelity does not know the rule'; end if;

  select count(*) into v_left from public.search_listings_ar s
   where s.production_ready and s.price_per_meter > 0 and s.area_m2 > 1
     and (case when s.deal_ar = 'إيجار' then s.price_annual else s.price_total end) = s.price_per_meter;
  if v_left <> 0 then raise exception 'PROOF: % shown rows still carry one figure in both boxes', v_left; end if;
  raise notice 'PROOF OK: rates read as rates, totals as totals, unclear figures untouched; wired once after the thousands rule; price_fidelity knows it; 0 shown rows left';
end
$proof$;
