-- wasalt cards print «رقم رخصة الإعلان» (🔧 backlog 1521/1526, 🆕 2026-11-08).
-- The REGA ad licence of a wasalt ad lives ONLY in ar_data.regaVerifiedInfo[].fields[key=adLicenseNumber] (the Arabic
-- enrichment payload; listing_extra_attrs_v0 serves it as search_listings_ar.license_number: 74,971 of 92,243 served
-- rows). The card reads the licence from additional_info, and wasalt's additional_info is the LEGACY {key,label,value}
-- array the English sweep writes, which never carries it — so no wasalt card ever showed the licence it has.
-- This BEFORE UPDATE trigger (already wasalt's own preserve-detail trigger, on both tables) now appends the source's
-- own licence, verbatim and only in the 10-digit REGA shape, as {key:'rega_ad_license_number', label:'Ad license
-- number'} when the array does not already carry that key. Every enrichment write and every sweep re-upsert is an
-- UPDATE, so rows gain the row as they are next touched; nothing is invented when the payload has no licence.
CREATE OR REPLACE FUNCTION public.wasalt_preserve_detail()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.detail_enriched AND NOT NEW.detail_enriched THEN
    NEW.additional_info := OLD.additional_info;
    NEW.detail_enriched := true;
  ELSIF OLD.detail_enriched AND NEW.detail_enriched
        AND coalesce(jsonb_array_length(NEW.additional_info), 0)
          < coalesce(jsonb_array_length(OLD.additional_info), 0) THEN
    NEW.additional_info := OLD.additional_info;  -- keep the richer stored panel
  END IF;

  -- price_total must never hold the per-square-metre rate (20260806063329) — but a stale archive whose
  -- own per-metre rate is physically impossible may not veto a corrected price (2026-11-03).
  IF NEW.transaction_type = 'Buy' AND NEW.price_total IS NOT NULL THEN
    DECLARE
      src text := coalesce(NEW.ar_data, OLD.ar_data) -> 'propertyInfo' ->> 'salePrice';
      rate text := coalesce(NEW.ar_data, OLD.ar_data) -> 'propertyInfo' ->> 'averageSalePricePerSqm';
    BEGIN
      IF src ~ '^\d+(\.\d+)?$'
         AND src::numeric >= NEW.price_total::numeric * 10
         AND NOT (rate ~ '^\d+(\.\d+)?$' AND rate::numeric > 2000000) THEN
        NEW.price_total := src::numeric::bigint;
      END IF;
    END;
  END IF;

  -- The card's licence row, from the source's own REGA block (2026-11-08).
  IF jsonb_typeof(NEW.additional_info) = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.additional_info) e(v)
                      WHERE e.v ->> 'key' = 'rega_ad_license_number') THEN
    DECLARE
      ar jsonb := coalesce(NEW.ar_data, OLD.ar_data);
      lic text;
    BEGIN
      SELECT nullif(btrim(f.v ->> 'value'), '') INTO lic
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ar -> 'regaVerifiedInfo') = 'array'
                                       THEN ar -> 'regaVerifiedInfo' ELSE '[]'::jsonb END) s(v),
             LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.v -> 'fields') = 'array'
                                               THEN s.v -> 'fields' ELSE '[]'::jsonb END) f(v)
       WHERE f.v ->> 'key' = 'adLicenseNumber'
       LIMIT 1;
      IF lic ~ '^\d{10}$' THEN
        NEW.additional_info := NEW.additional_info || jsonb_build_array(
          jsonb_build_object('key', 'rega_ad_license_number', 'label', 'Ad license number', 'value', lic));
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;
