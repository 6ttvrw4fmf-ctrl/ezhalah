-- "Never again" watchdog (2026-07-28): flag any active listing whose price sits in a phone/ID artifact
-- band — a broker mobile (05x -> 5xxxxxxxx = [500M,600M]) or the REGA/ID cluster [100.0M,101.0M] —
-- captured as a price. Cross-platform (runs over every active source table, resolves when clean). Built
-- from the LIVE mon_detect_field_integrity def; ONLY the phone_id_price aggregate + its raise/resolve
-- block are added. field_integrity is already registered in mon_run_all_detectors (cron), so this runs
-- every monitoring cycle with no extra wiring. Positive-tested live: injecting a synthetic 05x price
-- raised a P1 alert; clean data => 0.
CREATE OR REPLACE FUNCTION public.mon_detect_field_integrity()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec record;
  n int := 0;
  ph constant text[] := array['other','unknown','n/a','none','null','undefined','',
                              'غير محدد','اخرى','أخرى'];
  unit_types constant text[] := array['Building','Hotel','Office','Commercial Building'];
  loc_ph bigint; beds_odd bigint; rent_active bigint; rent_tiny bigint; zero_price bigint;
  phone_id_price bigint;
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
                                          or price_annual between 500000000 and 599999999))
        from public.%I
      $f$, ph, ph, unit_types, rec.tn)
      into loc_ph, beds_odd, rent_active, rent_tiny, zero_price, phone_id_price;
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
          'why','active price in a phone/ID artifact band — 05x mobile [500M,600M] or REGA/ID [100.0M,101.0M] captured as a price (2026-07-28 aqar phone-as-price class). Fix the parser; never round.'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_phone_price:'||rec.tn;
    end if;
  end loop;
  return n;
end $function$;
