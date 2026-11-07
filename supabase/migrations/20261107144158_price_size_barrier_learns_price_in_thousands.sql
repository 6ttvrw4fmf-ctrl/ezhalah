-- 🔧 Quality & Repair 2026-11-07 — alert 13609 (P1 price_size_contamination · index_price_differs_from_raw · aqar, 28
-- rows, 12:59 UTC) is the THIRD detector today lagging the price-in-thousands rule (after the index oracle and the
-- cheap-yearly detector): mon_price_size_fidelity_barrier() compares the served rent with the cheap-«yearly» rule but
-- not with the 11-06 rule that serves a rent typed in thousands as figure × 1000 (search_listings_ar.price_in_thousands).
-- Measured 14:43 UTC: 28 of 28 rows carry the flag and equal exactly 1000 × the rule; 0 real. Needle-edit of the ONE
-- place the barrier holds the per-rule expression; the silent-period judgment reads the scaled figure the trigger
-- judged. The detector is daily-slot gated, so the now-false key is resolved here after the barrier reports 0 rows.
do $$
declare src text; out_def text;
  old_e constant text := '(case when s.rent_period_judged and a.rent_period is null and public.judge_silent_rent_period_ar(coalesce(a.price_annual, a.price_total), s.type_ar) = ''شهري'' then coalesce(a.price_annual, a.price_total) * 12 else public.rent_price_annual_ar(''aqar'', a.rent_period, a.price_annual, a.property_type) end)';
  new_e constant text := '(case when s.price_in_thousands then 1000 else 1 end) * (case when s.rent_period_judged and a.rent_period is null and public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(a.price_annual, a.price_total), s.type_ar) = ''شهري'' then coalesce(a.price_annual, a.price_total) * 12 else public.rent_price_annual_ar(''aqar'', a.rent_period, a.price_annual, a.property_type) end)';
begin
  src := pg_get_functiondef('public.mon_price_size_fidelity_barrier()'::regprocedure);
  if position('price_in_thousands' in src) > 0 then
    raise notice 'mon_price_size_fidelity_barrier already knows price_in_thousands';
    return;
  end if;
  if (length(src) - length(replace(src, old_e, ''))) / length(old_e) <> 1 then
    raise exception 'barrier text is not where it was (expected exactly 1 occurrence of the per-rule expression) — refusing to guess';
  end if;
  out_def := replace(src, old_e, new_e);
  execute out_def;
end $$;

-- PROOF, both directions, no listing row written: (a) the predicate on the flagged shape is durable, the same row without
-- the flag is caught, a flagged row the trigger did not scale is caught; (b) the live barrier reports 0 rows for
-- index_price_differs_from_raw, and only then is the open key resolved (the detector's daily slot would otherwise keep a
-- false P1 open until tomorrow).
do $$
declare v_n bigint; ok boolean; caught_flag_off boolean; caught_unscaled boolean;
begin
  with s as (select true price_in_thousands, false rent_period_judged, 190000::numeric price_annual, 'مستودع'::text type_ar),
       a as (select 'annual'::text rent_period, 190::numeric price_annual, null::numeric price_total, 'Warehouse'::text property_type)
  select
    s.price_annual is not distinct from (case when s.price_in_thousands then 1000 else 1 end) * (case when s.rent_period_judged and a.rent_period is null and public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(a.price_annual, a.price_total), s.type_ar) = 'شهري' then coalesce(a.price_annual, a.price_total) * 12 else public.rent_price_annual_ar('aqar', a.rent_period, a.price_annual, a.property_type) end),
    s.price_annual is distinct from (case when false then 1000 else 1 end) * (case when s.rent_period_judged and a.rent_period is null and public.judge_silent_rent_period_ar((case when false then 1000 else 1 end) * coalesce(a.price_annual, a.price_total), s.type_ar) = 'شهري' then coalesce(a.price_annual, a.price_total) * 12 else public.rent_price_annual_ar('aqar', a.rent_period, a.price_annual, a.property_type) end),
    190::numeric is distinct from (case when s.price_in_thousands then 1000 else 1 end) * (case when s.rent_period_judged and a.rent_period is null and public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(a.price_annual, a.price_total), s.type_ar) = 'شهري' then coalesce(a.price_annual, a.price_total) * 12 else public.rent_price_annual_ar('aqar', a.rent_period, a.price_annual, a.property_type) end)
    into ok, caught_flag_off, caught_unscaled from s, a;
  if not ok then raise exception 'PROOF: a flagged thousands row served × 1000 still reads as contamination'; end if;
  if not caught_flag_off then raise exception 'PROOF: the same row WITHOUT the flag is no longer caught — the rule is too wide'; end if;
  if not caught_unscaled then raise exception 'PROOF: a flagged row the trigger did not scale is no longer caught'; end if;
  select coalesce(sum(b.n), 0) into v_n from public.mon_price_size_fidelity_barrier() b where b.check_name = 'index_price_differs_from_raw';
  if v_n > 0 then
    raise exception 'PROOF: the barrier still reports % index_price_differs_from_raw row(s) — not all explained by the flag', v_n;
  end if;
  perform public.mon_resolve_key('price_size_contamination', 'price_size_contamination:index_price_differs_from_raw:aqar');
  raise notice 'PROOF: predicate durable on the flagged shape, caught without the flag and when unscaled; barrier reports 0 rows; key resolved';
end $$;