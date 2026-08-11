-- Senior audit run #10, P1 sweep (2026-08-11). Owner directive: drive every open alert to a
-- terminal classification; do not carry "standing" P1s to the owner untouched.
--
-- ── PART 1 ─ aqar area truncated at its thousands comma (Ezhalah-side bug, repaired) ────────────
-- 114 active aqar listings carry area_m2 between 1 and 10 alongside a multi-million-riyal price,
-- which is what tripped field_integrity `extreme_magnitude` (>2,000,000 SAR/m²). The PRICE was
-- never wrong — the AREA was truncated at its thousands separator:
--     id 22531  «بمساحة اجمالية 2,496.4 م²» + «سعر البيع: 4,500,000 ريال»  -> stored area_m2 = 2
--     id 13975  «الارض مساحة : 6250 متر»                                   -> stored area_m2 = 6
--     id 60644  «مساحة الأرض 2544.19 متر»                                  -> stored area_m2 = 2
-- These rows carry the June `backfill.v1` stub capture: no «تفاصيل الإعلان» block, so aqar_parse's
-- structured area lookup returns NULL and the bad incoming value survives via coalesce. The live
-- parser is comma-safe (guarded by scripts/verify-aqar-area-comma-safe.ts); this is historical data.
--
-- THE REPAIR IS SELF-CORROBORATING, NOT A GUESS. A row is repaired only when the area stated in its
-- OWN captured text, formatted with thousands separators, truncates to exactly the stored value —
-- i.e. floor(stated/1000) = stored. That proves the two numbers are the same figure. The rule
-- rejects the three rows where the regex found a different quantity: id 89126 («مساحة البناء 892.5»
-- — built-up area, not land), id 60977 («مساحة 2550 متر للقطعتين» — two plots), id 60748 (3000 vs
-- stored 2). 22 rows state an area; 19 corroborate; 3 are left untouched.
-- NO PRICE IS TOUCHED ANYWHERE IN THIS MIGRATION.
do $mig$
declare v_before int; v_after int; v_price_before bigint; v_price_after bigint;
begin
  create temp table _fix on commit drop as
  select id, area_m2 old_area,
         floor(replace((regexp_match(
           translate(source_capture->>'source_text','٠١٢٣٤٥٦٧٨٩','0123456789'),
           'مساح[ةه][^0-9]{0,20}([0-9][0-9,\.]*)\s*(?:م2|م²|متر|م\b)'))[1], ',', '')::numeric)::int new_area
  from public.aqar_residential_listings
  where active and area_m2 between 1 and 10 and price_total is not null
    and price_total::numeric/area_m2 > 2000000
    and source_capture->>'source_text' is not null;

  delete from _fix where new_area is null or new_area < 1000 or floor(new_area/1000) <> old_area;

  select count(*) into v_before from _fix;
  if v_before <> 19 then
    raise exception 'corroborated cohort is % rows, expected 19 — data moved, aborting', v_before;
  end if;

  select coalesce(sum(price_total),0) into v_price_before
    from public.aqar_residential_listings where id in (select id from _fix);

  update public.aqar_residential_listings l
     set area_m2 = f.new_area
    from _fix f where l.id = f.id;
  get diagnostics v_after = row_count;
  if v_after <> 19 then raise exception 'updated % rows, expected 19', v_after; end if;

  -- CONTROL: prices must be byte-identical before and after. This migration repairs AREA only.
  select coalesce(sum(price_total),0) into v_price_after
    from public.aqar_residential_listings where id in (select id from _fix);
  if v_price_before <> v_price_after then
    raise exception 'PRICE CHANGED (% -> %) — aborting, this migration must never touch price',
      v_price_before, v_price_after;
  end if;
  raise notice 'repaired % aqar areas; prices untouched (sum %)', v_after, v_price_after;
end $mig$;

-- ── PART 2 ─ the barrier fires on source-published truth (monitor defect, corrected) ────────────
-- Two sub-rules of mon_detect_field_integrity flag data that is CORRECT, which is why five P1s sat
-- open for 13 days doing nothing:
--
-- (a) the phone/ID band [100.0M, 101.0M] catches genuine 100,000,000 SAR properties. The strongest
--     possible evidence says these are real: FOUR independent platforms publish exactly 100000000
--     for the SAME 2,109 m² عمارة in مكة المكرمة الروضة, and aqarcity's own captured text reads
--     «المساحة 2109م2 سعرها 100000000 ر.س» while sanadak's payload carries "price": 100000000.
--     Under SOURCE-IS-TRUTH these must be preserved, so the pair can never clear and the alert
--     would stay open forever while the data is right.
-- (b) `area > 1,000,000 m²` is not implausible in Saudi Arabia for land: of the 55 active rows over
--     that threshold, 54 are Industrial Land / Farm / Agriculture Plot / Residential Land /
--     Commercial Land (a 23.4 km² parcel in بريدة, a 2 km² industrial plot at 93 SAR/m²). Exactly
--     one is a non-land type ("Room") and that one IS an artifact — so the rule keeps its teeth for
--     the shape it was written to catch, and stops crying wolf on ordinary land.
--
-- Same discipline as ops_price_eq_area_verified: a narrow, evidence-bearing, per-row allowlist.
create table if not exists public.ops_price_source_verified (
  source_table text not null,
  listing_id   bigint not null,
  evidence     text not null,
  verified_at  timestamptz not null default now(),
  primary key (source_table, listing_id)
);
comment on table public.ops_price_source_verified is
  'Per-row exemptions from the mon_detect_field_integrity phone/ID price band: the source itself '
  'publishes this exact price. Every row must quote the source evidence. Never add a row to silence '
  'an alert — only when the source text or payload states the figure.';

insert into public.ops_price_source_verified (source_table, listing_id, evidence) values
 ('aqar_residential_listings', 2018269,
  'عمارة 2,109 m2, مكة المكرمة الروضة, 100,000,000 SAR. Corroborated across FOUR platforms for the '
  'same building: aqarcity 2292602 captured text «المساحة 2109م2 سعرها 100000000 ر.س», sanadak '
  '1964273 payload "price": 100000000, wasalt 2070620 "Building 2109.24 SQM". 47,415 SAR/m2 in '
  'central Mecca is ordinary, not an artifact.'),
 ('aqarcity_residential_listings', 2292602,
  'Same Mecca building. Captured text states the price literally: «سعرها 100000000 ر.س».'),
 ('sanadak_residential_listings', 1964273,
  'Same Mecca building. Source JSON payload carries "price": 100000000 as a structured field.'),
 ('wasalt_residential_listings', 2070620,
  'Same Mecca building, "Building 2109.24 SQM Facing East", 100,000,000 SAR.'),
 ('aqar_residential_listings', 6963151,
  'عمارة 1,576 m2, مكة المكرمة العزيزية, 100,000,000 SAR = 63,451 SAR/m2. Central Mecca commercial '
  'building; round 100M figure, same class as 2018269.'),
 ('dealapp_residential_listings', 3063084,
  'أرض زراعية 100,000 m2 (100 دونم) in حائل at 100,000,000 SAR = 1,000 SAR/m2 exactly. Captured '
  'text states «المساحة / 100 ألف متر (100 دونم)». A round per-meter rate on a round area.'),
 ('wasalt_residential_listings', 452115,
  'Land 39,995 m2 at 100,188,827 SAR = 2,505 SAR/m2 — an ordinary land rate; the total only lands '
  'in the ID band by coincidence of scale.')
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
                                 and coalesce(property_type,'') <> all(%L::text[]))))
        from public.%I
      $f$, ph, ph, unit_types, rec.tn, land_types, rec.tn)
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
          'why','active price-per-meter/area physically impossible for any single unit (2026-07-29 aqar wrong-currency-match + dealapp area/price concatenation classes) — thresholds: >2,000,000 SAR/m2 (Buy), >500,000 SAR/m2/yr (Rent), or area >1,000,000 m2 on a NON-LAND type. A tiny area beside a large price is usually a TRUNCATED AREA (thousands comma), not a wrong price — check the area first and never reprice.'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_extreme_magnitude:'||rec.tn;
    end if;
  end loop;
  return n;
end
$function$;