-- field_integrity_extreme_magnitude cluster triage (2026-08-12, issues #501 aqargate, #493 sanadak).
--
-- Both flagged rows are genuinely source-published, not parser artifacts:
--
-- aqargate 583435 (شقة, مكة المكرمة المحمدية, 227.2 m2, 820,000,000 SAR = 3,612,335 SAR/m2):
--   THREE independent WordPress/Houzez fields on the SAME captured payload agree byte-for-byte:
--   fave_property_price=["820000000"], advertisement_response.propertyPrice=820000000 (the
--   REGA-linked broker-response block, not template markup), and propertyPrice=820000000 top-level.
--   No internal contradiction anywhere on the page (unlike the dealapp class below) — three
--   independently-populated structured fields, one of them REGA-sourced, all state the same figure.
--
-- sanadak 1039151 (أرض, المدينة المنورة الخضراء, 104,054.38 m2, 1,612,842,890,000 SAR):
--   additional_info["اجمالي سعر بيع الارض"] (labelled TOTAL) = "1612842890000", matching price_total
--   exactly. It also reconciles EXACTLY against the platform's own per-meter rate field: 15,500,000
--   (السعر بيع المتر) x 104,054.38 (source_capture.lotSize, the precise unrounded area) =
--   1,612,842,890,000 to the SAR. The platform's own per-meter figure is implausible, but that is a
--   judgement about the SELLER'S pricing, not evidence our pipeline mis-multiplied anything — sanadak's
--   own structured total and its own rate x area both independently land on the identical number.
--
-- This is the SAME evidentiary bar the 2026-08-11 aqar_area_comma_truncation migration used for the
-- Mecca 100,000,000 SAR building (multi-field/multi-platform corroboration -> ops_price_source_verified,
-- never repriced). ops_price_source_verified already exists and already gates phone_id_price; this
-- migration is the minimal extension of that SAME mechanism to extreme_magnitude, so a proven
-- source-real row stops re-raising a P1 forever while a genuine parser artifact on any OTHER row is
-- untouched (the exemption is per listing_id, never a magnitude cap).
insert into public.ops_price_source_verified (source_table, listing_id, evidence) values
 ('aqargate_residential_listings', 583435,
  'شقة بيع, مكة المكرمة (المحمدية), 227.2 m2, 820,000,000 SAR = 3,612,335 SAR/m2. THREE independent '
  'structured fields on the captured payload agree exactly: fave_property_price=["820000000"], '
  'propertyPrice=820000000, and advertisement_response.propertyPrice=820000000 (the REGA-linked '
  'broker-response block). No internal contradiction on the page. Source-published; preserved under '
  'the source-fidelity rule.'),
 ('sanadak_residential_listings', 1039151,
  'أرض للبيع, المدينة المنورة (الخضراء), 104,054.38 m2, 1,612,842,890,000 SAR. additional_info '
  '["اجمالي سعر بيع الارض"] (labelled TOTAL) = "1612842890000", matching price_total exactly, AND '
  'independently reconciling against the platform''s own rate field: 15,500,000 SAR/m2 '
  '(سعر بيع المتر) x 104,054.38 m2 (source_capture.lotSize, unrounded) = 1,612,842,890,000 to the '
  'SAR. Two independently-populated structured fields on sanadak''s own payload agree exactly; '
  'source-published, preserved under the source-fidelity rule.')
on conflict (source_table, listing_id) do nothing;

create or replace function public.mon_detect_field_integrity()
 returns integer
 language plpgsql
as $function$
declare
  rec record;
  n int := 0;
  ph constant text[] := array['other','unknown','n/a','none','null','undefined','',
                              'غير محدد','اخرى','أخرى'];
  unit_types constant text[] := array['Building','Hotel','Office','Commercial Building'];
  -- Land parcels are legitimately measured in square kilometres in Saudi Arabia. The >1,000,000 m2
  -- arm exists to catch area/price concatenation artifacts, which do not occur on land types.
  land_types constant text[] := array['Residential Land','Commercial Land','Agriculture Plot',
                                      'Industrial Land','Farm'];
  loc_ph bigint; beds_odd bigint; rent_active bigint; rent_tiny bigint; zero_price bigint;
  phone_id_price bigint; extreme_magnitude bigint;
begin
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema = 'public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status = 'active' and pr.kind = 'source'
  loop
    begin
      execute format($f$
        select
          count(*) filter (where active and ((city   is not null and lower(trim(city))   = any(%L::text[]))
                                          or (region is not null and lower(trim(region)) = any(%L::text[])))),
          count(*) filter (where active and (bedrooms > 1000
                                          or (bedrooms > 50 and coalesce(property_type,'') <> all(%L::text[])))),
          count(*) filter (where active and transaction_type = 'Rent'),
          count(*) filter (where active and transaction_type = 'Rent' and price_annual < 500),
          count(*) filter (where active and (price_total = 0 or price_annual = 0)),
          count(*) filter (where active and (price_total  between 100000000 and 101000000
                                          or price_total  between 500000000 and 599999999
                                          or price_annual between 100000000 and 101000000
                                          or price_annual between 500000000 and 599999999)
                            and not exists (select 1 from public.ops_price_source_verified v
                                             where v.source_table = %L and v.listing_id = id)),
          count(*) filter (where active and (
                             (area_m2 is not null and area_m2 > 0
                               and ((price_total  is not null and price_total::numeric/area_m2  > 2000000)
                                 or (price_annual is not null and price_annual::numeric/area_m2 > 500000)))
                             or (area_m2::numeric > 1000000
                                 and coalesce(property_type,'') <> all(%L::text[])))
                            and not exists (select 1 from public.ops_price_source_verified v
                                             where v.source_table = %L and v.listing_id = id))
        from public.%I
      $f$, ph, ph, unit_types, rec.tn, land_types, rec.tn, rec.tn)
      into loc_ph, beds_odd, rent_active, rent_tiny, zero_price, phone_id_price, extreme_magnitude;
    exception when others then continue;  -- shape mismatch → skip table, never block
    end;

    if loc_ph > 0 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_placeholder_loc:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'active_placeholder_location_rows', loc_ph,
          'why','placeholder city/region literal on active rows — pre-guard legacy or a new guard bypass'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_placeholder_loc:'||rec.tn;
    end if;

    if beds_odd > 0 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_bedrooms:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'suspect_bedroom_rows', beds_odd,
          'why','bedrooms>1000, or >50 outside unit-count types (Building/Hotel/Office/Commercial Building) — parse-artifact repair candidates'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_bedrooms:'||rec.tn;
    end if;

    if rent_active >= 20 and rent_tiny::numeric / nullif(rent_active, 0) > 0.20 then
      n := n + public.mon_raise('P1','field_integrity', rec.platform,
        'field_integrity_tiny_rent:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'tiny_rent_rows', rent_tiny, 'active_rent', rent_active,
          'frac', round(rent_tiny::numeric / rent_active, 3),
          'why','>=20% of active Rent under 500 SAR — monthly-as-annual-shaped regression'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_tiny_rent:'||rec.tn;
    end if;

    if zero_price > 20 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_zero_price:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'zero_price_active_rows', zero_price,
          'why','active zero-price rows grew past 20 (faithful-placeholder baseline is 7, all aqar_res) — check for a new ingestion bug'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_zero_price:'||rec.tn;
    end if;

    if phone_id_price > 0 then
      n := n + public.mon_raise('P1','field_integrity', rec.platform,
        'field_integrity_phone_price:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'phone_or_id_shaped_price_rows', phone_id_price,
          'why','active price in a phone/ID artifact band — 05x mobile [500M,600M] or REGA/ID [100.0M,101.0M] captured as a price (2026-07-28 aqar phone-as-price class). Fix the parser; never round. Source-verified rows belong in ops_price_source_verified, never repriced.'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_phone_price:'||rec.tn;
    end if;

    if extreme_magnitude > 0 then
      n := n + public.mon_raise('P1','field_integrity', rec.platform,
        'field_integrity_extreme_magnitude:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'extreme_magnitude_rows', extreme_magnitude,
          'why','active price-per-meter/area physically impossible for any single unit (2026-07-29 aqar wrong-currency-match + dealapp area/price concatenation classes) — thresholds: >2,000,000 SAR/m2 (Buy), >500,000 SAR/m2/yr (Rent), or area >1,000,000 m2 on a NON-LAND type. A tiny area beside a large price is usually a TRUNCATED AREA (thousands comma), not a wrong price — check the area first and never reprice. Source-verified rows belong in ops_price_source_verified, never repriced.'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_extreme_magnitude:'||rec.tn;
    end if;
  end loop;
  return n;
end
$function$;
