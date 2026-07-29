-- P0 fidelity fix (2026-07-29): the 2026-07-28 phone/ID-band guard (trg_aqar_parse, migration
-- 20260728191518) only fires when aqar_parse() did NOT confirm a §/ريال/﷼ price. But aqar_parse()'s
-- own price regex has NO cap at all (`(\d[\d,]*(?:\.\d+)?)\s*(?:§|ريال|﷼)`, `where v > 0` is the
-- only guard) and scans the WHOLE pre-«تفاصيل الإعلان» header — when that header contains more than
-- one currency-tagged number, it can pick the WRONG one even though the pick WAS §-confirmed, so the
-- existing guard never fires for this failure mode.
--
-- Proven live, 2026-07-29: aqar_residential_listings.id=1339672 (Industrial Land) — real price
-- 55,000 SAR for 398 m², live source page confirmed via direct fetch. Stored price_total was
-- 125,628,140,704. Replaying aqar_parse()'s own regex against the row's real source_capture text
-- shows exactly why: TWO §/ريال/﷼-tagged numbers appear in the header, "125,628,140,704" first and
-- "55,000" second — aqar_parse() took prices[1] (no discount marker found), the wrong one. Not an
-- isolated case: replaying the same regex against every aqar Buy row with an implausible price
-- (>50M SAR or >50k SAR/m², 25 sampled rows with multiple candidates) shows this mechanism is real,
-- though most large-price rows in this dataset ARE genuine (large land/commercial parcels) — this
-- migration does NOT attempt to pick the "right" candidate when several exist (that risks nulling
-- genuinely large real listings; empirically, "prefer the last/smallest candidate" is NOT a safe
-- general rule — see the 25-row sample in this investigation, most of which correctly took the first,
-- larger candidate and it was right). Instead this adds a hard PLAUSIBILITY ceiling as a backstop,
-- calibrated against the full triggered set to be far above anything in this project's real data
-- (max verified-real price-per-meter seen across the whole dataset is ~340,000 SAR/m²; the triggered
-- set here starts at 2,000,000 SAR/m² and the median is 3.5M-13.3M, cleanly separated).
--
-- Built from the LIVE trg_aqar_parse definition (= migration 20260728191518, unchanged since). Two
-- changes only: (1) the AREA block is moved BEFORE the Buy block so the new Buy guard can use the
-- FINAL area_m2, not the pre-trigger incoming value; (2) a new extreme-magnitude guard is added to
-- the Buy block, plus a new (separate, independent) Rent-side backstop — price_annual is untouched
-- elsewhere in this trigger, so nulling an impossible value there needs no root-cause tie-in, same
-- "honest NULL beats a fabricated/wrong value" philosophy as every other guard in this function.
-- Nothing else in the function body changes — direction/last_update/license/…/fullparse_done and the
-- untouched-price_per_meter comment are byte-identical to the committed 20260728191518 body.
CREATE OR REPLACE FUNCTION public.trg_aqar_parse()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare p jsonb; parsed_price bigint;
begin
  if NEW.source_capture->>'source_text' is null then return NEW; end if;
  if TG_OP='UPDATE' and NEW.source_capture is not distinct from OLD.source_capture and NEW.fullparse_done then
    return NEW;
  end if;
  begin
    p := aqar_parse(NEW.source_capture->>'source_text');
  exception when others then
    return NEW;
  end;

  NEW.direction       := p->>'direction';
  NEW.last_update     := coalesce(p->>'last_update', NEW.last_update);
  NEW.date_added      := coalesce(p->>'date_added', NEW.date_added);
  NEW.license_number  := p->>'license_number';
  NEW.license_expiry  := p->>'license_expiry';
  NEW.ad_source       := p->>'ad_source';
  NEW.plan_parcel     := p->>'plan_parcel';
  NEW.deed_area_m2    := public.safe_numeric(p->>'deed_area_m2');
  NEW.views_count     := public.safe_int(p->>'views_count');
  NEW.tenant_category := p->>'tenant_category';
  NEW.num_apartments  := public.safe_int(p->>'num_apartments');
  NEW.floor_number    := public.safe_int(p->>'floor_number');
  NEW.furnished       := public.safe_bool(p->>'furnished');
  NEW.discount_pct    := public.safe_int(p->>'discount_pct');
  NEW.price_original  := public.safe_bigint(p->>'price_original');

  -- AREA (2026-07-28, P0): prefer aqar_parse's STRUCTURED «المساحة» (region after «تفاصيل الإعلان»)
  -- over the incoming value — the Python enrich scanned the WHOLE page, so a seller's free-text could
  -- override the official area. Fall back to the incoming value only when the structured block has none.
  -- Moved BEFORE the Buy/Rent price blocks (2026-07-29) so the extreme-magnitude price guards below can
  -- read the FINAL area_m2, not the pre-trigger incoming value.
  NEW.area_m2 := coalesce(public.safe_int(p->>'area_m2'), NEW.area_m2);

  if NEW.transaction_type='Buy' then
    parsed_price := public.safe_bigint(p->>'price');
    if parsed_price is not null then
      NEW.price_total := parsed_price;         -- trigger fully owns Buy total (source-parsed)
    end if;
    -- FIDELITY GUARD (2026-07-28, P0): when aqar_parse did NOT confirm a §/ريال/﷼ price (parsed_price
    -- null) AND the surviving value sits in a proven non-price band — a broker mobile (05x -> 5xxxxxxxx
    -- = [500M,600M]) or the REGA/ID artifact cluster [100.0M,101.0M] — it is garbage, never a real SAR
    -- total -> drop it (an honest NULL beats a fabricated price). §-confirmed prices stay exempt.
    if parsed_price is null
       and (NEW.price_total between 100000000 and 101000000
         or NEW.price_total between 500000000 and 599999999) then
      NEW.price_total := null;
    end if;
    -- EXTREME-MAGNITUDE GUARD (2026-07-29, P0): see migration header. Applies even to a §-confirmed
    -- price, unlike the guard above. The raw-total branch is a backstop for when area is unknown ONLY
    -- — it must not fire independently when area IS known and the implied per-meter price is plausible
    -- (a legitimately large parcel priced sanely per meter can still have a large total; verified live
    -- against id 1155063, a 17,185 m² Mecca land parcel at ~337,646 SAR/m² — total 5.8B, ppm well under
    -- the 2M ceiling — an earlier draft of this guard wrongly nulled it via an unconditional raw ceiling).
    if NEW.price_total is not null
       and (
         (NEW.area_m2 is not null and NEW.area_m2 > 0
          and NEW.price_total::numeric / NEW.area_m2 > 2000000)
         or (coalesce(NEW.area_m2, 0) = 0 and NEW.price_total::numeric > 5000000000)
       ) then
      NEW.price_total := null;
    end if;
  end if;

  if NEW.transaction_type='Rent' then
    -- EXTREME-MAGNITUDE GUARD, Rent side (2026-07-29, P0): price_annual is not touched anywhere else
    -- in this trigger (it stays whatever the incoming row already had) — a pure backstop, independent
    -- of root cause. 85 live rows found above 200,000 SAR/m²/year; ceiling set well clear of that
    -- (500,000) to stay conservative — this migration only traced the Buy-side aqar_parse() mechanism,
    -- Rent's own extraction path is a separate, not-yet-root-caused follow-up.
    if NEW.price_annual is not null
       and NEW.area_m2 is not null and NEW.area_m2 > 0
       and NEW.price_annual::numeric / NEW.area_m2 > 500000 then
      NEW.price_annual := null;
    end if;
  end if;

  -- price_per_meter is deliberately NOT touched here. It is a SOURCE-PUBLISHED field («سعر المتر»)
  -- parsed by scrapers/aqar/enrich_residential.py:141 parse_price_per_meter() and supplied on the
  -- incoming row. Any assignment in this trigger can only overwrite source truth with arithmetic.
  -- Do not reintroduce one; scripts/verify-aqar-trigger-preserves-source-ppm.ts fails the build.

  NEW.fullparse_done := true;
  return NEW;
end
$function$;
