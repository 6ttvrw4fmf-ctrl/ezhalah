-- MIRROR of the LIVE production object. NOT a migration — see the full-body-replace rule.
-- Refreshed 2026-08-03 (senior run #3 continuation): fidelity guard gains the unconfirmed
-- token band (parsed_price NULL + price_total 1–9999 → NULL).
-- Verified byte-exact; md5 of everything below this header block: 4ac2b9680be6b3ed9d6dcbd30d84f7fa
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

  if NEW.transaction_type='Buy' then
    parsed_price := public.safe_bigint(p->>'price');
    if parsed_price is not null then
      NEW.price_total := parsed_price;         -- trigger fully owns Buy total (source-parsed)
    end if;
    -- FIDELITY GUARD (2026-07-28, P0): the Python enrich fallback pattern `(\d{6,9})` before a bare
    -- «ر» can capture a broker PHONE (05x -> 5xxxxxxxx) or a REGA/ID artifact (~100.2M) as a "price".
    -- aqar_parse only accepts §/ريال/﷼-marked prices, so when it did NOT confirm one (parsed_price
    -- null) AND the surviving value sits in a proven non-price band, it is garbage, never a real SAR
    -- total -> drop it (an honest NULL beats a fabricated price). §-confirmed prices stay exempt
    -- (parsed_price not null). See scripts/verify-no-phone-shaped-price.ts.
    if parsed_price is null
       and (NEW.price_total between 100000000 and 101000000
         or NEW.price_total between 500000000 and 599999999
         or NEW.price_total between 1 and 9999) then
      NEW.price_total := null;
    end if;
  end if;

  -- AREA (2026-07-28, P0): prefer aqar_parse's STRUCTURED «المساحة» (region after «تفاصيل الإعلان»)
  -- over the incoming value — the Python enrich scanned the WHOLE page, so a seller's free-text
  -- description could override the official area. Fall back to the incoming value only when the
  -- structured details block has no area.
  NEW.area_m2 := coalesce(public.safe_int(p->>'area_m2'), NEW.area_m2);

  -- price_per_meter is deliberately NOT touched here. It is a SOURCE-PUBLISHED field («سعر المتر»)
  -- parsed by scrapers/aqar/enrich_residential.py:141 parse_price_per_meter() and supplied on the
  -- incoming row. Any assignment in this trigger can only overwrite source truth with arithmetic.
  -- Do not reintroduce one; scripts/verify-aqar-trigger-preserves-source-ppm.ts fails the build.

  NEW.fullparse_done := true;
  return NEW;
end
$function$
