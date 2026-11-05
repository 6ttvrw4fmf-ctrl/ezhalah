-- WASALT LAND: SHOW THE SELLER'S FIGURE, NOT WASALT'S «TOTAL × AREA» (owner 2026-11-05: «we need to make sure that those
-- listings never ever happen again», then chose «Show the real price»).
--
-- THE TYPO. A seller types the plot's TOTAL into wasalt's per-m² box; wasalt multiplies it by the area and publishes that as
-- the price. wasalt 5893909 (جدة / حي البوادي, 504 m²): salePrice 1,613,001,600, its own «3,200,400 ﷼/sqm»
-- (propertyInfo.averageSalePricePerSqm). aqar, dealapp and muhaysini list the same plot at 3,200,400. Read live 2026-11-05.
--
-- WHY IT REACHED USERS. The owner's 2026-10-28 rule (price_typed_in_meter_box_ar in enforce_price_size_sanity, and
-- src/lib/meterBoxPrice.ts on the card) serves the box figure when the box equals price ÷ area and the price is impossible.
-- It reads `price_per_meter`, and wasalt never filled it: its box figure lives only in the archived detail payload
-- (ar_data.propertyInfo.averageSalePricePerSqm). So the rule could not see 686 served wasalt plots (median 623 M SAR;
-- 417 of them listed by another site, same district and area, at exactly the box figure).
--
-- THE FIX. A BEFORE INSERT/UPDATE trigger on both wasalt tables copies wasalt's OWN per-m² figure into price_per_meter for a
-- LAND sale row when — and only when — the existing rule proves the typo with it. Nothing new is decided here: the rule, its
-- bars (≥100,000 SAR/m² outside Makkah/Madinah and commercial, else impossible), its ±0.2% match and its sane-total check are
-- price_typed_in_meter_box_ar() unchanged. price_total keeps wasalt's figure (PRICE = SOURCE); the index and the card then
-- serve the seller's figure through the rule they already run. LAND ONLY: on the 29 villas/buildings the same arithmetic
-- holds but the evidence points the other way (0 twins at the box figure), so they are never touched.
-- A box figure we filled is dropped again the moment it stops matching the price (the seller corrected it on wasalt).
--
-- NEW ROWS. wasalt's search list does not carry the per-m² figure (checked 2026-11-05); the detail fetch (enrich_ar) does,
-- and it now reads land rows served at ≥100,000 SAR/m² FIRST. The detector below repairs anything that slips past.
-- Guard: scripts/verify-wasalt-land-meter-box-seller-figure.ts. Rule text: docs/ARCHITECTURE.md (meter-box rule).

create or replace function public.wasalt_box_per_meter(p_ar jsonb)
 returns numeric
 language sql
 immutable
as $function$
  select case when (p_ar->'propertyInfo'->>'averageSalePricePerSqm') ~ '^[0-9]+(\.[0-9]+)?$'
              then (p_ar->'propertyInfo'->>'averageSalePricePerSqm')::numeric end
$function$;

-- The seller's figure when wasalt multiplied a total typed into its per-m² box, else null. LAND sale rows only.
-- wasalt rows spell the holy cities in English; price_typed_in_meter_box_ar keeps them on the stricter bar by its Arabic name.
create or replace function public.wasalt_land_typed_total_ar(p_total numeric, p_area integer, p_ar jsonb, p_type text,
                                                             p_deal text, p_city text, p_commercial boolean)
 returns numeric
 language sql
 immutable
as $function$
  select public.price_typed_in_meter_box_ar(p_total, p_area, public.wasalt_box_per_meter(p_ar),
           case when p_city in ('Mecca', 'Medina') then 'مكة المكرمة' else p_city end, p_commercial)
   where p_deal = 'Buy' and (p_type like '%Land' or p_type = 'Agriculture Plot')
$function$;

create or replace function public.wasalt_land_box_figure_from_source()
 returns trigger
 language plpgsql
as $function$
declare v_fix numeric; v_box numeric;
begin
  v_fix := public.wasalt_land_typed_total_ar(NEW.price_total, NEW.area_m2, NEW.ar_data, NEW.property_type,
                                             NEW.transaction_type, NEW.city, TG_TABLE_NAME like '%commercial%');
  if v_fix is not null then
    if NEW.price_per_meter is null then NEW.price_per_meter := round(v_fix); end if;
  else
    -- A box figure that came from wasalt's own field but no longer matches the price (wasalt corrected it): drop it,
    -- or the card would print a total as the per-m² rate. A figure that still matches the price is kept.
    v_box := public.wasalt_box_per_meter(NEW.ar_data);
    if NEW.price_per_meter is not null and v_box is not null and NEW.price_per_meter = round(v_box)
       and NEW.transaction_type = 'Buy' and (NEW.property_type like '%Land' or NEW.property_type = 'Agriculture Plot')
       and NEW.price_total > 0 and NEW.area_m2 > 0
       and abs(NEW.price_total::numeric / NEW.area_m2 - v_box) > greatest(v_box * 0.002, 1) then
      NEW.price_per_meter := null;
    end if;
  end if;
  return NEW;
end
$function$;

-- Named to run after trg_wrl_preserve_detail / trg_wrm_rate_is_not_the_total (they settle price_total first).
drop trigger if exists trg_wrz_land_box_figure on public.wasalt_residential_listings;
create trigger trg_wrz_land_box_figure before insert or update on public.wasalt_residential_listings
  for each row execute function public.wasalt_land_box_figure_from_source();
drop trigger if exists trg_wrz_land_box_figure on public.wasalt_commercial_listings;
create trigger trg_wrz_land_box_figure before insert or update on public.wasalt_commercial_listings
  for each row execute function public.wasalt_land_box_figure_from_source();

-- REPAIR FIRST, THEN RAISE (the meter-box detector's pattern, owner 2026-10-31 «it must be fixed automatically»).
create or replace function public.mon_detect_wasalt_land_box_typo()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; v_src bigint := 0; v_k bigint; v_idx bigint; v_left bigint; v_sample jsonb;
begin
  -- 1. source rows whose own wasalt payload proves the typo but carry no box figure (the trigger was bypassed).
  update public.wasalt_residential_listings w
     set price_per_meter = round(public.wasalt_land_typed_total_ar(w.price_total, w.area_m2, w.ar_data, w.property_type, w.transaction_type, w.city, false))
   where w.active and w.price_per_meter is null and w.transaction_type = 'Buy'
     and public.wasalt_land_typed_total_ar(w.price_total, w.area_m2, w.ar_data, w.property_type, w.transaction_type, w.city, false) is not null;
  get diagnostics v_k = row_count; v_src := v_src + v_k;
  update public.wasalt_commercial_listings w
     set price_per_meter = round(public.wasalt_land_typed_total_ar(w.price_total, w.area_m2, w.ar_data, w.property_type, w.transaction_type, w.city, true))
   where w.active and w.price_per_meter is null and w.transaction_type = 'Buy'
     and public.wasalt_land_typed_total_ar(w.price_total, w.area_m2, w.ar_data, w.property_type, w.transaction_type, w.city, true) is not null;
  get diagnostics v_k = row_count; v_src := v_src + v_k;

  -- 2. served rows still at wasalt's multiplied figure: hand them the box figure; enforce_price_size_sanity() serves it.
  update public.search_listings_ar s set price_per_meter = w.price_per_meter
    from (select 'wasalt_residential_listings'::text st, id, price_total, price_per_meter from public.wasalt_residential_listings
           where active and price_per_meter is not null and transaction_type = 'Buy'
          union all
          select 'wasalt_commercial_listings', id, price_total, price_per_meter from public.wasalt_commercial_listings
           where active and price_per_meter is not null and transaction_type = 'Buy') w
   where s.source_table = w.st and s.listing_id = w.id and s.deal_ar = 'بيع' and s.price_total = w.price_total
     and s.price_per_meter is distinct from w.price_per_meter
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, w.price_per_meter, s.city_ar, w.st like '%commercial%') is not null;
  get diagnostics v_idx = row_count;

  if v_src + v_idx = 0 then
    perform public.mon_resolve_key('wasalt_land_box_typo_self_healed', 'wasalt_land_box_typo_self_healed');
  else
    n := n + public.mon_raise('P2', 'wasalt_land_box_typo_self_healed', 'wasalt', 'wasalt_land_box_typo_self_healed',
      jsonb_build_object('source_rows', v_src, 'index_rows', v_idx,
        'why', 'wasalt land sale rows whose own per-m² box proves the «total × area» typo had no box figure (source) or were still served at wasalt''s multiplied figure (index); this detector repaired them. trg_wrz_land_box_figure should have done it: check it is enabled on both wasalt tables.'));
  end if;

  -- 3. what is STILL served multiplied after the repair: the trigger chain is broken.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('source_table', x.st, 'listing_id', x.id, 'served', x.pt)) filter (where x.rn <= 10), '[]')
    into v_left, v_sample
    from (select w.st, w.id, s.price_total pt, row_number() over () rn
            from public.search_listings_ar s
            join (select 'wasalt_residential_listings'::text st, id, ar_data, property_type, transaction_type, city from public.wasalt_residential_listings
                   where active and transaction_type = 'Buy' and (property_type like '%Land' or property_type = 'Agriculture Plot')
                  union all
                  select 'wasalt_commercial_listings', id, ar_data, property_type, transaction_type, city from public.wasalt_commercial_listings
                   where active and transaction_type = 'Buy' and (property_type like '%Land' or property_type = 'Agriculture Plot')) w
              on s.source_table = w.st and s.listing_id = w.id
           where s.production_ready and s.deal_ar = 'بيع'
             and public.wasalt_land_typed_total_ar(s.price_total, s.area_m2, w.ar_data, w.property_type, w.transaction_type, w.city, w.st like '%commercial%') is not null) x;
  if v_left = 0 then
    perform public.mon_resolve_key('wasalt_land_box_typo_served', 'wasalt_land_box_typo_served');
  else
    n := n + public.mon_raise('P1', 'wasalt_land_box_typo_served', 'wasalt', 'wasalt_land_box_typo_served',
      jsonb_build_object('rows', v_left, 'sample', v_sample,
        'why', 'a served wasalt land sale still shows wasalt''s «total × area» figure after this detector repaired it: trg_wrz_land_box_figure, trg_price_size_sanity or price_typed_in_meter_box_ar() is off or changed.',
        'fix', 'Check both triggers are enabled and enforce_price_size_sanity() still calls price_typed_in_meter_box_ar(). Never hide the rows or widen an exemption to clear this (owner 2026-11-05: show the seller''s figure).'));
  end if;
  return n;
end
$function$;

-- Roster entry in the SAME migration (mon_detect_orphaned_detectors fires on a detector nothing reaches).
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_wasalt_land_box_typo' in d) > 0 then raise exception 'mon_run_all_detectors: already registered'; end if;
  if (select count(*) from regexp_matches(d, '''mon_detect_served_billion_price_unproven'',', 'g')) <> 1 then
    raise exception 'mon_run_all_detectors: roster anchor not found exactly once — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$'mon_detect_served_billion_price_unproven',$x$,
    $x$'mon_detect_served_billion_price_unproven', 'mon_detect_wasalt_land_box_typo',$x$);
  execute d;
end
$mig$;

-- Repair today's rows: one detector run fills the box figure and re-serves them.
select public.mon_detect_wasalt_land_box_typo();

-- PROOF, both directions.
do $proof$
declare v_left bigint; v bigint;
  box3200 constant jsonb := '{"propertyInfo":{"averageSalePricePerSqm":3200400}}';
begin
  -- the rule fires on the proven typo …
  if public.wasalt_land_typed_total_ar(1613001600, 504, box3200, 'Residential Land', 'Buy', 'Jeddah', false) is distinct from 3200400 then
    raise exception 'PROOF: wasalt 5893909 shape not corrected'; end if;
  -- … and never on: a villa, a rent, a sane plot, a corrected price with a stale archive, no box, Makkah below impossible.
  if public.wasalt_land_typed_total_ar(1613001600, 504, box3200, 'Villa', 'Buy', 'Jeddah', false) is not null then raise exception 'PROOF: a villa was touched'; end if;
  if public.wasalt_land_typed_total_ar(1613001600, 504, box3200, 'Residential Land', 'Rent', 'Jeddah', false) is not null then raise exception 'PROOF: a rent was touched'; end if;
  if public.wasalt_land_typed_total_ar(1600000, 504, '{"propertyInfo":{"averageSalePricePerSqm":3175}}', 'Residential Land', 'Buy', 'Jeddah', false) is not null then raise exception 'PROOF: a sane plot was touched'; end if;
  if public.wasalt_land_typed_total_ar(3200400, 504, box3200, 'Residential Land', 'Buy', 'Jeddah', false) is not null then raise exception 'PROOF: a corrected price was touched'; end if;
  if public.wasalt_land_typed_total_ar(1613001600, 504, '{"propertyInfo":{}}', 'Residential Land', 'Buy', 'Jeddah', false) is not null then raise exception 'PROOF: no box, still a guess'; end if;
  if public.wasalt_land_typed_total_ar(1613001600, 504, box3200, 'Residential Land', 'Buy', 'Mecca', false) is not null then raise exception 'PROOF: Makkah lost its stricter bar'; end if;

  -- the real rows are served at the seller's figure …
  select count(*) into v from public.search_listings_ar
   where source_table = 'wasalt_residential_listings'
     and ((listing_id = 9432641 and price_total = 3200400) or (listing_id in (14617508, 22475455) and price_total = 2950000));
  if v <> 3 then raise exception 'PROOF: only % of the 3 حي البوادي rows serve the seller''s figure', v; end if;
  -- … while their platform rows keep wasalt's figure (PRICE = SOURCE).
  select count(*) into v from public.wasalt_residential_listings where id = 9432641 and price_total = 1613001600 and price_per_meter = 3200400;
  if v <> 1 then raise exception 'PROOF: wasalt 9432641 platform row changed its price or lacks the box figure'; end if;
  -- no villa/building got a box figure from this trigger.
  select count(*) into v from public.wasalt_residential_listings
   where active and price_per_meter is not null and property_type in ('Villa', 'Building')
     and price_per_meter = round(public.wasalt_box_per_meter(ar_data)) and price_total::numeric / nullif(area_m2, 0) >= 100000;
  if v <> 0 then raise exception 'PROOF: % villas/buildings carry a box figure', v; end if;
  -- nothing left in the typo shape.
  select count(*) into v_left from public.search_listings_ar s
    join public.wasalt_residential_listings w on s.source_table = 'wasalt_residential_listings' and w.id = s.listing_id
   where s.production_ready and w.active
     and public.wasalt_land_typed_total_ar(s.price_total, s.area_m2, w.ar_data, w.property_type, w.transaction_type, w.city, false) is not null;
  if v_left <> 0 then raise exception 'PROOF: % served wasalt land rows still multiplied', v_left; end if;
  raise notice 'PROOF OK';
end
$proof$;
