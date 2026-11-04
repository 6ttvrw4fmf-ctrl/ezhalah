-- THE LAND PER-METRE-IN-TOTAL RULE GOES LIVE, WITH ITS GUARD (owner 2026-11-04: «build the best solution, a strong guard»).
--
-- 1. enforce_price_size_sanity() applies land_ppm_typed_as_total_served_ar() (migration 20261104221247) on every write of a
--    sale row: when it fires, price_total := the figure × area, price_per_meter := the figure, ppm_typed_as_total := true.
--    Edited BY ONE EXACT TEXT REPLACE (anchor = the end of the meter-box block, RAISE unless found exactly once) — never a
--    full-function replace, so a peer's later edit to the trigger cannot be clobbered. The RNPL / Monthly block is not
--    touched: the anchor and the inserted text name neither payment_monthly nor rent_now_pay_later.
--    The four count entry points (location_search_candidates_ar, af_eligible_count, apartment_guided_counts_ar,
--    property_age_option_counts_ar) read price_total_effective, which follows price_total — one value, one count.
-- 2. price_fidelity() stops counting those rows as index↔source drift (the same way it already understands the meter-box
--    and the judged-rent rules): a row is excused only when it is flagged AND its served total is exactly source × area.
-- 3. mon_detect_land_ppm_typed_as_total(), daily: refresh the band + the ad's words, REPAIR FIRST (a no-op update fires the
--    trigger; P2 land_ppm_typed_as_total_self_healed), P1 land_ppm_typed_as_total_served only for rows the rule still
--    fires on afterwards (= the trigger is off/bypassed), P2 land_price_unit_review for the review list (judgment backlog).

set local lock_timeout = '5s';

do $edit$
declare d text; k int;
  a_trig text := E'      NEW.price_per_meter := round(v_fix / NEW.area_m2);\n    end if;\n  end if;\n';
  b_trig text := E'      NEW.price_per_meter := round(v_fix / NEW.area_m2);\n    end if;\n  end if;\n'
    || E'\n  -- A PER-METRE PRICE TYPED INTO THE TOTAL BOX on a land sale (owner 2026-11-04): serve the figure × area and keep the\n'
    || E'  -- figure as the per-metre rate. Rule, band and the ad''s own words: land_ppm_typed_as_total_served_ar(). An UPDATE\n'
    || E'  -- that leaves the price alone (a re-judge, an unrelated column) keeps the flag it already has.\n'
    || E'  if NEW.deal_ar = ''بيع'' then\n'
    || E'    v_fix := public.land_ppm_typed_as_total_served_ar(NEW.source_table, NEW.listing_id, NEW.price_total, NEW.area_m2,\n'
    || E'                                                      NEW.price_per_meter, NEW.type_ar, NEW.city_ar, NEW.district_ar);\n'
    || E'  else\n'
    || E'    v_fix := null;\n'
    || E'  end if;\n'
    || E'  if v_fix is not null then\n'
    || E'    NEW.price_per_meter := NEW.price_total;\n'
    || E'    NEW.price_total := v_fix;\n'
    || E'    NEW.ppm_typed_as_total := true;\n'
    || E'  elsif TG_OP = ''INSERT'' or NEW.price_total is distinct from OLD.price_total or NEW.deal_ar is distinct from OLD.deal_ar then\n'
    || E'    NEW.ppm_typed_as_total := false;\n'
    || E'  end if;\n';
  a_fid text := E'    where s.price_total  is distinct from x.src_total\n';
  b_fid text := E'    where (s.price_total  is distinct from x.src_total\n'
    || E'           -- owner 2026-11-04: a land per-metre price typed into the total box is served × area (enforce_price_size_sanity)\n'
    || E'           and not (s.ppm_typed_as_total and s.price_total = x.src_total * s.area_m2))\n';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_price_size_sanity';
  k := (length(d) - length(replace(d, a_trig, ''))) / length(a_trig);
  if k <> 1 then raise exception 'enforce_price_size_sanity: expected exactly 1 anchor, found %', k; end if;
  if position('land_ppm_typed_as_total_served_ar' in d) > 0 then raise exception 'enforce_price_size_sanity: already wired'; end if;
  execute replace(d, a_trig, b_trig);

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'price_fidelity';
  k := (length(d) - length(replace(d, a_fid, ''))) / length(a_fid);
  if k <> 1 then raise exception 'price_fidelity: expected exactly 1 anchor, found %', k; end if;
  execute replace(d, a_fid, b_fid);
end
$edit$;

create or replace function public.mon_detect_land_ppm_typed_as_total()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare n int := 0; v_healed bigint; v_left bigint; v_review bigint; v_by jsonb; v_sample jsonb;
begin
  perform public.refresh_land_sale_ppm_band();
  perform public.refresh_land_price_unit_text_evidence();

  -- REPAIR FIRST (owner 2026-10-31). A no-op update fires enforce_price_size_sanity(), which applies the rule.
  update public.search_listings_ar s set price_total = s.price_total
   where s.deal_ar = 'بيع' and not s.ppm_typed_as_total
     and s.type_ar like 'أرض%' and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100
     and public.land_ppm_typed_as_total_served_ar(s.source_table, s.listing_id, s.price_total, s.area_m2, s.price_per_meter,
                                                  s.type_ar, s.city_ar, s.district_ar) is not null;
  get diagnostics v_healed = row_count;
  if v_healed = 0 then
    perform public.mon_resolve_key('land_ppm_typed_as_total_self_healed', 'land_ppm_typed_as_total_self_healed:fleet');
  else
    n := n + public.mon_raise('P2', 'land_ppm_typed_as_total_self_healed', 'search_index', 'land_ppm_typed_as_total_self_healed:fleet',
      jsonb_build_object('count', v_healed,
        'why', 'land sale rows whose total is really a per-metre price were served × area by this run (the trigger did it on the no-op update). Expected in small numbers: the ad''s own words and the price band are refreshed daily, so a row that needed them waits for this run. A large count means rows reached the index past enforce_price_size_sanity().'));
  end if;

  select count(*) into v_left
    from public.search_listings_ar s
   where s.deal_ar = 'بيع' and not s.ppm_typed_as_total
     and s.type_ar like 'أرض%' and s.price_total > 0 and s.price_total < 20000 and s.area_m2 >= 100
     and public.land_ppm_typed_as_total_served_ar(s.source_table, s.listing_id, s.price_total, s.area_m2, s.price_per_meter,
                                                  s.type_ar, s.city_ar, s.district_ar) is not null;
  if v_left = 0 then
    perform public.mon_resolve_key('land_ppm_typed_as_total_served', 'land_ppm_typed_as_total_served:fleet');
  else
    n := n + public.mon_raise('P1', 'land_ppm_typed_as_total_served', 'search_index', 'land_ppm_typed_as_total_served:fleet',
      jsonb_build_object('count', v_left,
        'why', 'a land sale still shows a per-metre price as its TOTAL after this detector re-judged it, so enforce_price_size_sanity() did not apply land_ppm_typed_as_total_served_ar(): the trigger is disabled, replaced, or no longer calls it.',
        'fix', 'Check trg_price_size_sanity is enabled on search_listings_ar and enforce_price_size_sanity() still calls land_ppm_typed_as_total_served_ar(). Never hide the row or edit the platform table to clear this.'));
  end if;

  select count(*), coalesce(jsonb_object_agg(reason, c), '{}'::jsonb) into v_review, v_by
    from (select reason, count(*) c from public.land_price_unit_review_ar group by reason) q;
  if v_review = 0 then
    perform public.mon_resolve_key('land_price_unit_review', 'land_price_unit_review:fleet');
  else
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_sample
      from (select * from public.land_price_unit_review_ar order by reason, platform, listing_id limit 15) t;
    n := n + public.mon_raise('P2', 'land_price_unit_review', 'search_index', 'land_price_unit_review:fleet',
      jsonb_build_object('count', v_review, 'by_reason', v_by, 'sample', v_sample,
        'why', 'land prices the rule refuses to guess: per-metre OR thousands (both readings plausible), the ad''s words say «الف», the area copied into the price box, outside the district/city band, no band, tiny land rents for an urban-size plot, and Property Finder offices whose area dwarfs the rent (square feet). They stay as the source wrote them. Full list: select * from land_price_unit_review_ar.'));
  end if;
  return n;
end
$function$;
revoke execute on function public.mon_detect_land_ppm_typed_as_total() from public, anon, authenticated;

select cron.schedule('mon-land-ppm-typed-as-total', '36 5 * * *',
  $cron$set statement_timeout to '300s'; select public.mon_detect_land_ppm_typed_as_total();$cron$);

-- Proof: the trigger now carries the rule exactly once, before the impossible-price hide, and price_fidelity excuses only flagged rows.
do $proof$
declare d text;
begin
  select prosrc into d from pg_proc where oid = 'public.enforce_price_size_sanity()'::regprocedure;
  if (length(d) - length(replace(d, 'public.land_ppm_typed_as_total_served_ar(', ''))) / length('public.land_ppm_typed_as_total_served_ar(') <> 1 then raise exception 'PROOF: the trigger does not call the rule exactly once'; end if;
  if position('public.land_ppm_typed_as_total_served_ar(' in d) > position('price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2)' || E'\n' in d) then raise exception 'PROOF: the rule runs after the impossible-price hide'; end if;
  if position('price_typed_in_meter_box_ar(' in d) = 0 or position('rent_now_pay_later' in d) = 0 then raise exception 'PROOF: the meter-box or RNPL block went missing'; end if;
  select prosrc into d from pg_proc where oid = 'public.price_fidelity()'::regprocedure;
  if position('s.ppm_typed_as_total and s.price_total = x.src_total * s.area_m2' in d) = 0 then raise exception 'PROOF: price_fidelity does not know the rule'; end if;
  raise notice 'PROOF OK: trigger wired once, before the hide; meter-box + RNPL intact; price_fidelity excuses only flagged rows';
end
$proof$;
