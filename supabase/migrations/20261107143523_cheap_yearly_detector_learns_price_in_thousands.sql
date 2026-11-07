-- 🔧 Quality & Repair 2026-11-07 — alert 13534 (P1 cheap_yearly_rent_served, 04:59 UTC, 67 rows) is the same class as
-- 13535 this morning: the DETECTOR lags the price-in-thousands rule (the 11-06 migration that serves a rent typed in
-- thousands as figure × 1000 and flags search_listings_ar.price_in_thousands). Measured 14:35 UTC: 67 off-rule rows,
-- 65 carry price_in_thousands = true and every one of the 65 equals 1000 × the rule's figure; 2 are real and stay named.
-- Needle-edit of the live detector in BOTH places it holds the per-rule expression (the sample and the predicate):
-- the served figure is compared with (1000 if flagged else 1) × the rule, and the silent-period judgment reads the same
-- scaled figure the trigger judged. Raises if the text is not where it was (edit in place, never retype).
do $$
declare src text; out_def text;
  old_e constant text := '(case when s.rent_period_judged and v.platform not in (''gathern'', ''aqarmonthly'') and v.rent_period is null and public.judge_silent_rent_period_ar(coalesce(v.price_annual, v.price_total), s.type_ar) = ''شهري'' then coalesce(v.price_annual, v.price_total) * 12 else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end)';
  new_e constant text := '(case when s.price_in_thousands then 1000 else 1 end) * (case when s.rent_period_judged and v.platform not in (''gathern'', ''aqarmonthly'') and v.rent_period is null and public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(v.price_annual, v.price_total), s.type_ar) = ''شهري'' then coalesce(v.price_annual, v.price_total) * 12 else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end)';
begin
  src := pg_get_functiondef('public.mon_detect_cheap_yearly_rent_served()'::regprocedure);
  if position('price_in_thousands' in src) > 0 then
    raise notice 'mon_detect_cheap_yearly_rent_served already knows price_in_thousands';
    return;
  end if;
  if (length(src) - length(replace(src, old_e, ''))) / length(old_e) <> 2 then
    raise exception 'detector text is not where it was (expected exactly 2 occurrences of the per-rule expression) — refusing to guess';
  end if;
  out_def := replace(src, old_e, new_e);
  execute out_def;
end $$;

-- PROOF, both directions, without writing a listing row:
-- (a) the predicate on the real shape of the 65 (aqar warehouse, «annual» 190, served 190,000, flagged): durable;
--     the same row with the flag off: caught; a flagged row served 190 (the trigger did not scale it): caught;
-- (b) the live detector no longer names the 65 flagged rows: its open alert's rows ≤ 2 and none of them is flagged.
do $$
declare r int; d jsonb; v_rows int; v_flagged int;
  ok boolean; caught_flag_off boolean; caught_unscaled boolean;
begin
  with s as (select 'aqar'::text platform, true price_in_thousands, false rent_period_judged, 190000::numeric price_annual, 'مستودع'::text type_ar),
       v as (select 'aqar'::text platform, 'annual'::text rent_period, 190::numeric price_annual, null::numeric price_total, 'Warehouse'::text property_type)
  select
    s.price_annual is not distinct from (case when s.price_in_thousands then 1000 else 1 end) * (case when s.rent_period_judged and v.platform not in ('gathern', 'aqarmonthly') and v.rent_period is null and public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(v.price_annual, v.price_total), s.type_ar) = 'شهري' then coalesce(v.price_annual, v.price_total) * 12 else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end),
    s.price_annual is distinct from (case when false then 1000 else 1 end) * (case when s.rent_period_judged and v.platform not in ('gathern', 'aqarmonthly') and v.rent_period is null and public.judge_silent_rent_period_ar((case when false then 1000 else 1 end) * coalesce(v.price_annual, v.price_total), s.type_ar) = 'شهري' then coalesce(v.price_annual, v.price_total) * 12 else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end),
    190::numeric is distinct from (case when s.price_in_thousands then 1000 else 1 end) * (case when s.rent_period_judged and v.platform not in ('gathern', 'aqarmonthly') and v.rent_period is null and public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(v.price_annual, v.price_total), s.type_ar) = 'شهري' then coalesce(v.price_annual, v.price_total) * 12 else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end)
    into ok, caught_flag_off, caught_unscaled from s, v;
  if not ok then raise exception 'PROOF: a flagged thousands row served × 1000 still reads as off the rule'; end if;
  if not caught_flag_off then raise exception 'PROOF: the same row WITHOUT the flag is no longer caught — the rule is too wide'; end if;
  if not caught_unscaled then raise exception 'PROOF: a flagged row the trigger did not scale is no longer caught'; end if;
  r := public.mon_detect_cheap_yearly_rent_served();
  select detail into d from public.alert_event where dedup_key = 'cheap_yearly_rent_served' and resolved_at is null;
  v_rows := coalesce((d->>'rows')::int, 0);
  select count(*) into v_flagged from jsonb_array_elements(coalesce(d->'sample', '[]'::jsonb)) e
    join public.search_listings_ar s on s.platform = e->>'platform' and s.listing_id = (e->>'listing_id')::bigint
   where s.price_in_thousands;
  if v_rows > 2 or v_flagged > 0 then
    raise exception 'PROOF: the detector still names flagged thousands rows (rows %, flagged in sample %)', v_rows, v_flagged;
  end if;
  raise notice 'PROOF: predicate durable on the flagged shape, caught without the flag and when unscaled; live detector now names % row(s), none flagged', v_rows;
end $$;