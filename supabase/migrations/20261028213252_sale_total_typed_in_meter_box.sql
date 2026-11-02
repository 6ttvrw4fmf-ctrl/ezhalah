-- A SALE PRICE TYPED INTO THE «سعر المتر» BOX IS SERVED AS THE SELLER'S PRICE (owner 2026-10-28: «fix it … make sure we
-- never get those mistakes again»). Shown the ads, the owner overrode the 2026-08-03 «copy whatever they display» rule for
-- this one proven case.
--
-- Measured 2026-10-28: 43 located listings on live sites were hidden by the price/size gate, e.g. dealapp 582750 at
-- 12.4 trillion SAR. For 26 of them the site's OWN «سعر المتر» field equals price ÷ area to within 0.1%: the seller typed
-- the TOTAL into the per-meter box and the site multiplied it by the area. The ad text agrees where it states a price
-- (dealapp 17548552: box 25,132,140, text «إجمالي السعر التقريبي: 25,128,000»; 17550460: box 5,858,132, text «إجمالي
-- القيمة: 5,858,132»; 18987884: box 7,350,000 over 525,000 m², text «14 ريال للمتر»).
--
-- Rule, Buy only: when the served total trips price_size_impossible() and is not source-verified, AND the site's per-meter
-- figure equals total ÷ area (±0.2%), AND that figure is itself a sane total for the area (0.1–150,000 SAR/m², not
-- impossible), serve the figure as price_total and recompute price_per_meter. Anything else stays hidden as before:
-- no guess is ever served (haraj 19673799 and 20640528, which have no per-meter field, stay hidden). The SOURCE tables are
-- untouched (PRICE = SOURCE still holds there); only the search index serves the corrected figure, like rent_pool_ar().
create or replace function public.price_typed_in_meter_box_ar(p numeric, area integer, ppm numeric)
 returns numeric
 language sql
 immutable
as $function$
  select ppm
   where p is not null and ppm is not null and ppm >= 1000
     and area between 1 and 50000000
     and public.price_size_impossible(p, null, area)
     and abs(p / area - ppm) <= greatest(ppm * 0.002, 1)
     and ppm / area between 0.1 and 150000
     and not public.price_size_impossible(ppm, null, area)
$function$;

create or replace function public.enforce_price_size_sanity()
 returns trigger
 language plpgsql
as $function$
declare
  v_fix numeric;
begin
  -- Evidence-gated: an extreme value that the SOURCE publishes is never hidden (owner rule).
  -- The predicate itself is untouched; only proven-source rows are exempt from the hide.
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2)
     and not exists (
       select 1 from public.ops_price_source_verified v
        where v.source_table = NEW.source_table
          and v.listing_id  = NEW.listing_id)
  then
    -- A sale total typed into the per-meter box (owner 2026-10-28): serve the seller's figure, never a guess.
    v_fix := case when NEW.deal_ar = 'بيع'
                  then public.price_typed_in_meter_box_ar(NEW.price_total, NEW.area_m2, NEW.price_per_meter) end;
    if v_fix is not null and not public.price_size_impossible(v_fix, NEW.price_annual, NEW.area_m2) then
      NEW.price_total := v_fix;
      NEW.price_per_meter := round(v_fix / NEW.area_m2);
    else
      NEW.production_ready := false;
    end if;
  end if;

  if NEW.type_ar is not null and not exists (select 1 from public.known_type_ar k where k.type_ar = NEW.type_ar) then
    NEW.type_ar := 'غير معروف';
  end if;

  -- NOTE: the sub-1000 Buy price gate was deliberately removed upstream (owner rule: a
  -- source-published price is never hidden, at any magnitude). Do NOT reinstate it here.
  --
  -- RNPL = an ANNUAL contract paid in instalments; it must NEVER become Monthly, on any platform.
  -- Identical predicate to sync_payment_monthly() and to the شهري bucket in the search/counts RPCs,
  -- so writer, trigger and reader can never disagree. (owner PERMANENT rule 2026-08-09.)
  if NEW.rent_period_ar = 'شهري' then
    NEW.payment_monthly := not coalesce(NEW.rent_now_pay_later, false);
  elsif NEW.rent_period_ar = 'سنوي' then
    NEW.payment_monthly := false;
  end if;

  -- "not applicable" is NULL, never 0. A Buy listing has no annual rent and a Rent
  -- listing has no sale total; a 0 in the inapplicable column is a placeholder we
  -- invented, not a figure any source published. (2026-08-10 Filter audit.)
  -- A source-published 0 in the APPLICABLE column is left untouched and stays
  -- searchable — see feedback_no-hiding-source-published-prices-rule.
  if NEW.deal_ar = 'بيع' and NEW.price_annual = 0 then NEW.price_annual := null; end if;
  if NEW.deal_ar = 'إيجار' and NEW.price_total = 0 then NEW.price_total := null; end if;

  -- An EXACT duplicate of the applicable price sitting in the inapplicable column carries no
  -- source figure of its own, so dropping it loses nothing (routine #3, 2026-09-27,
  -- ops_incident #840). A column holding a DIFFERENT value is deliberately left alone: it may
  -- be source-published, and only source adjudication may decide.
  case public.price_inapplicable_mirror(NEW.deal_ar, NEW.price_total, NEW.price_annual)
    when 'price_annual' then NEW.price_annual := null;
    when 'price_total'  then NEW.price_total  := null;
    else null;
  end case;

  return NEW;
end
$function$;

do $proof$
begin
  -- the proven typo: dealapp 17548552 (5,585 m², served 140,360,991,328, box 25,132,140) → the box
  if public.price_typed_in_meter_box_ar(140360991328, 5585, 25132140) is distinct from 25132140 then
    raise exception 'PROOF: the proven typo is not corrected';
  end if;
  -- the farm: 525,000 m², 3,858,750,000,000, box 7,350,000 (14 SAR/m²) → the box
  if public.price_typed_in_meter_box_ar(3858750000000, 525000, 7350000) is distinct from 7350000 then
    raise exception 'PROOF: the 14 SAR/m² farm is not corrected';
  end if;
  -- no per-meter field (haraj 19673799) → no guess
  if public.price_typed_in_meter_box_ar(6666666667, 450, null) is not null then
    raise exception 'PROOF: a row with no per-meter field was guessed';
  end if;
  -- the box does not match price ÷ area → no guess
  if public.price_typed_in_meter_box_ar(3000000000150, 450, 900000) is not null then
    raise exception 'PROOF: a non-matching box was used';
  end if;
  -- a sane price is never touched
  if public.price_typed_in_meter_box_ar(1500000, 600, 2500) is not null then
    raise exception 'PROOF: a sane price was rewritten';
  end if;
  -- the box itself is absurd for the area (muhaysini-like: 100M for 62 m² = 1.6M/m²) → no guess
  if public.price_typed_in_meter_box_ar(6200990767, 62, 100015980) is not null then
    raise exception 'PROOF: an absurd per-meter box was served';
  end if;
  raise notice 'PROOF OK: proven typos corrected; no-field, mismatched, sane and absurd cases untouched';
end $proof$;