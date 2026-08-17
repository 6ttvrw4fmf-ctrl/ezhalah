-- Data Integrity run #26 (2026-08-17). Closes price_gate_withheld, open as P2 since 2026-08-09.
--
-- THE DEFECT: trg_price_size_sanity forces production_ready = false on any row where
-- price_size_impossible() is true, with NO evidence gate. That hides listings from search whose
-- extreme values the SOURCE PLATFORM ITSELF PUBLISHES -- directly contrary to the standing owner
-- rule, which the trigger's own body already states for the sibling sub-1000 gate:
--   "the sub-1000 Buy price gate was deliberately removed upstream (owner rule: a source-published
--    price is never hidden, at any magnitude). Do NOT reinstate it here."
-- The magnitude gate was doing exactly what that comment forbids, one branch above.
--
-- Of the 26 rows currently withheld, 16 are already recorded in ops_price_source_verified -- a
-- prior run fetched the source and PROVED the platform publishes those figures. Those 16 were
-- being hidden from every user despite being verified truth. Weird is not wrong.
--
-- THE FIX is the pattern run #25 established for rate_stored_as_total: honour the recorded
-- evidence table, do not weaken the predicate. price_size_impossible() is unchanged, so detection
-- is fully intact; only a row with PROVEN source evidence is exempted from being hidden. The 10
-- rows without evidence stay withheld, which is correct -- several are obvious parser artifacts
-- (a price_per_meter of 123,456,798; a 22-trillion total) and must not be released on a guess.
--
-- The EXISTS is evaluated ONLY when the gate would otherwise fire, so it costs nothing on the
-- ~196k rows that never trip it, and ops_price_source_verified is keyed (source_table, listing_id).

create or replace function public.enforce_price_size_sanity()
returns trigger
language plpgsql
as $function$
begin
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

  return NEW;
end
$function$;

comment on function public.enforce_price_size_sanity() is
  'Search-index guard. The price/size magnitude gate hides a row from search ONLY when its values are implausible AND no source evidence exists in ops_price_source_verified (run #26, 2026-08-17). price_size_impossible() itself is never weakened: detection stays intact, and only a row whose extreme value has been PROVEN to come from the source is exempted, per the standing owner rule that a source-published price is never hidden at any magnitude.';
