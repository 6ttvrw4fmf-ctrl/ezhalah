-- Owner 2026-11-03 «dont hide, show me»: undo 20261103230546. The trigger is back to the verified exemption only;
-- the hourly sync re-serves the rows (it upserts wherever the index production_ready differs from the view).
CREATE OR REPLACE FUNCTION public.enforce_price_size_sanity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_fix numeric;
begin
  -- A sale total typed into the per-meter box (owner 2026-10-28): serve the seller's figure, never a guess.
  -- Checked BEFORE the verified exemption: «verified» only ever proved the site displays the multiplied figure,
  -- which is exactly this typo (10 such rows were served at up to 22 trillion SAR under the exemption).
  if NEW.deal_ar = 'بيع' then
    v_fix := public.price_typed_in_meter_box_ar(NEW.price_total, NEW.area_m2, NEW.price_per_meter, NEW.city_ar, NEW.source_table like '%commercial%');
    if v_fix is not null and not public.price_size_impossible(v_fix, NEW.price_annual, NEW.area_m2) then
      NEW.price_total := v_fix;
      NEW.price_per_meter := round(v_fix / NEW.area_m2);
    end if;
  end if;

  -- Evidence-gated: an extreme value that the SOURCE publishes is never hidden (owner rule).
  -- The predicate itself is untouched; only proven-source rows are exempt from the hide.
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2)
     and not exists (
       select 1 from public.ops_price_source_verified v
        where v.source_table = NEW.source_table
          and v.listing_id  = NEW.listing_id)
  then
    NEW.production_ready := false;
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

drop function public.price_is_source_typo_ar(numeric, numeric, integer);
