-- THE METER-BOX TYPO ALARM REPAIRS BEFORE IT SHOUTS (owner 2026-10-31: «it must be fixed automatically, most importantly»).
--
-- enforce_price_size_sanity() corrects a total typed into the «سعر المتر» box on every insert/update, so a served row
-- that still matches means the trigger was bypassed (a rule change, a disabled trigger, a direct write). Until now the
-- half-hourly detector only raised P1 and waited for a person to run the re-judge by hand (2026-10-30: 414 rows).
-- Now the detector re-judges those rows itself (a no-op UPDATE fires the trigger, which applies the rule), records
-- that it healed them (P2, self-resolving), and raises P1 only for rows the trigger could NOT correct — the real
-- «trigger is off» signal. Full CREATE OR REPLACE from the body read 2026-10-31 00:45 UTC; nobody else edits it.
create or replace function public.mon_detect_impossible_price_size()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cnt bigint; v_open boolean; n int := 0; v_typo bigint; v_healed bigint;
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
  -- Owner 2026-10-31: REPAIR FIRST. A no-op update fires enforce_price_size_sanity(), which applies the rule.
  update public.search_listings_ar s set price_total = s.price_total
   where s.production_ready and s.deal_ar = 'بيع'
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter, s.city_ar, s.source_table like '%commercial%') is not null;
  get diagnostics v_healed = row_count;
  if v_healed = 0 then
    perform public.mon_resolve_key('meter_box_typo_self_healed', 'meter_box_typo_self_healed:fleet');
  else
    n := n + public.mon_raise('P2','meter_box_typo_self_healed','search_index','meter_box_typo_self_healed:fleet',
      jsonb_build_object('count', v_healed,
        'why','served sale rows matched the «سعر المتر» typo shape and were re-judged by this detector (the trigger corrected them). They should never reach the index uncorrected: find what wrote them past enforce_price_size_sanity() (a rule change without a re-judge, a direct write, a disabled trigger).'));
  end if;

  select count(*) into v_typo
    from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'بيع'
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter, s.city_ar, s.source_table like '%commercial%') is not null;
  if v_typo = 0 then
    perform public.mon_resolve_key('meter_box_typo_served', 'meter_box_typo_served:fleet');
  else
    n := n + public.mon_raise('P1','meter_box_typo_served','search_index','meter_box_typo_served:fleet',
      jsonb_build_object('count', v_typo,
        'why','a served sale listing still shows a total the seller typed into the «سعر المتر» box AFTER this detector re-judged it — enforce_price_size_sanity() did not correct it, so the trigger is disabled, replaced, or no longer calls price_typed_in_meter_box_ar().',
        'fix','Check trg_price_size_sanity is enabled on search_listings_ar and enforce_price_size_sanity() still calls price_typed_in_meter_box_ar() before the verified exemption. Never widen the exemption or hide the row to clear this.'));
  end if;
  return n;
end $function$;

-- Proof: the trigger is on, one run leaves 0 rows in the typo shape, and the detector's body carries the repair.
do $proof$
declare v_left bigint; v_def text;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.search_listings_ar'::regclass and tgname = 'trg_price_size_sanity' and tgenabled <> 'D') then
    raise exception 'PROOF: trg_price_size_sanity is not enabled';
  end if;
  perform public.mon_detect_impossible_price_size();
  select count(*) into v_left from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'بيع'
     and public.price_typed_in_meter_box_ar(s.price_total, s.area_m2, s.price_per_meter, s.city_ar, s.source_table like '%commercial%') is not null;
  if v_left <> 0 then raise exception 'PROOF: % served rows still match the typo shape after a detector run', v_left; end if;
  select pg_get_functiondef('public.mon_detect_impossible_price_size'::regproc) into v_def;
  if position('get diagnostics v_healed = row_count' in v_def) = 0 then raise exception 'PROOF: the detector lost its repair step'; end if;
  raise notice 'PROOF OK: trigger on, detector repairs then counts, 0 rows left';
end $proof$;