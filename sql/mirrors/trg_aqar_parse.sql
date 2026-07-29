-- MIRROR of the LIVE production object (audit item 7f). NOT a migration — this
-- object is already applied in production and has no repo migration base.
-- Do not re-apply blindly; to change it, follow the RPC full-body-replace rule
-- (rebuild from pg_get_functiondef of the LIVE object, needle-edit, migrate).
-- Dumped byte-exact via anon REST on 2026-07-27; md5 (no trailing newline): 63ff2da54258adda91313f7c4043d8e6
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
  end if;
  -- price_per_meter is deliberately NOT touched here. It is a SOURCE-PUBLISHED field («سعر المتر»)
  -- parsed by scrapers/aqar/enrich_residential.py:141 parse_price_per_meter() and supplied on the
  -- incoming row. Any assignment in this trigger can only overwrite source truth with arithmetic.
  -- Do not reintroduce one; scripts/verify-aqar-trigger-preserves-source-ppm.ts fails the build.

  NEW.fullparse_done := true;
  return NEW;
end
$function$

