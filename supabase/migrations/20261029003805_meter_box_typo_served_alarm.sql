-- A SERVED PER-METER-BOX TYPO IS AN ALARM (owner 2026-10-28: «make sure we never get those mistakes again»).
-- The search index's trigger corrects a sale total typed into the «سعر المتر» box (price_typed_in_meter_box_ar). If a
-- served Buy row ever still matches that shape, the trigger was bypassed, replaced or switched off: raise a P1
-- (meter_box_typo_served). The check lives inside the already-rostered mon_detect_impossible_price_size(), which runs
-- in every detector sweep, so it needs no new roster entry and cannot become an orphaned detector.
create or replace function public.mon_detect_impossible_price_size()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cnt bigint; v_open boolean; n int := 0; v_typo bigint;
begin
  select count(*) into v_cnt
    from public.search_listings_ar s
   where s.production_ready
     and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
     and not exists (select 1 from public.ops_price_source_verified v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id);
  v_open := exists (select 1 from public.alert_event where dedup_key='impossible_price_size_displayed' and resolved_at is null);
  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('impossible_price_size_displayed','search_index'); end if;
  else
    n := n + public.mon_raise('P1','impossible_price_size_displayed','search_index','impossible_price_size_displayed',
      jsonb_build_object('count', v_cnt,
        'why','a SEARCHABLE listing carries a physically-impossible price or size (ppm>5M SAR/m², total/annual>50B, or area>5M m²) AND has no source evidence — data must match the source, never display a fabricated number. Rows PROVEN to carry source-published values (ops_price_source_verified) are exempt: the owner rule is that a source price is never hidden at any magnitude, so counting them here would hold this key permanently red and suppress every genuine re-occurrence.'));
  end if;

  -- The per-meter-box typo (owner 2026-10-28): no served sale row may still match it, verified or not.
  select count(*) into v_typo
    from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'بيع'
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter) is not null;
  if v_typo = 0 then
    perform public.mon_resolve_key('meter_box_typo_served', 'meter_box_typo_served:fleet');
  else
    n := n + public.mon_raise('P1','meter_box_typo_served','search_index','meter_box_typo_served:fleet',
      jsonb_build_object('count', v_typo,
        'why','a served sale listing still shows a total the seller typed into the «سعر المتر» box (the site multiplied it by the area, e.g. 22 trillion SAR). enforce_price_size_sanity() corrects these through price_typed_in_meter_box_ar(); a served one means that trigger was bypassed, replaced or switched off.',
        'fix','Check trg_price_size_sanity is enabled on search_listings_ar and enforce_price_size_sanity() still calls price_typed_in_meter_box_ar() before the verified exemption. Never widen the exemption or hide the row to clear this.'));
  end if;
  return n;
end $function$;

do $proof$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_price_size_sanity' and tgenabled <> 'D') then
    raise exception 'PROOF: the correcting trigger is not enabled';
  end if;
  if exists (select 1 from public.search_listings_ar s where s.production_ready and s.deal_ar = 'بيع'
             and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter) is not null) then
    raise exception 'PROOF: a per-meter-box typo is still served';
  end if;
  raise notice 'PROOF OK: trigger enabled; no typo served';
end $proof$;