-- 🔧 Quality & Repair 2026-11-07 — alert 13535 (P1 search_index_diverges_from_sync_source, 04:59 UTC, 19 rows on
-- asasmakeen / gomenassat / ksaaqar) is the ORACLE lagging a rule, not the index: all 19 rows carry
-- price_in_thousands = true and rent_period_judged = true. Since 20261106224834 enforce_price_size_sanity() reads a
-- source rent typed in thousands (asasmakeen 24218832: «63» → served 63,000) BEFORE trg_rent_period_judgment labels it
-- «سنوي» with rent_period_judged. The oracle still judged the RAW figure (63 → no label) and compared the raw annual
-- (63) with the served one (63,000), so every judged thousands row read as «not durable» although the next sync
-- re-writes exactly the same values through the same triggers. Measured 13:29 UTC: 19 divergent, 19 in_thousands,
-- 19 judged. Needle-edit of the live oracle in both places it holds the expression (the sample and the predicate),
-- raising if the text is not where it was (the 10-30 lesson: edit in place, never retype).
do $$
declare src text; out_def text;
  old1 constant text := 'public.judge_silent_rent_period_ar(coalesce(public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type), a.price_total), s.type_ar)';
  new1 constant text := 'public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type), a.price_total), s.type_ar)';
  old2 constant text := 'public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type) is not distinct from s.price_annual';
  new2 constant text := '(case when s.price_in_thousands then 1000 else 1 end) * public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type) is not distinct from s.price_annual';
begin
  src := pg_get_functiondef('public.mon_detect_search_index_diverges_from_sync_source()'::regprocedure);
  if position('price_in_thousands' in src) > 0 then
    raise notice 'oracle already knows price_in_thousands';
    return;
  end if;
  if (length(src) - length(replace(src, old1, ''))) / length(old1) <> 2
     or (length(src) - length(replace(src, old2, ''))) / length(old2) <> 2 then
    raise exception 'oracle text is not where it was (expected 2 + 2 occurrences) — refusing to guess';
  end if;
  out_def := replace(replace(src, old1, new1), old2, new2);
  execute out_def;
end $$;

-- PROOF, both directions, without writing a listing row (the connector holds an UPDATE for a human at night):
-- (a) the live rows: the 19 judged thousands rows no longer read as divergence — the detector returns 0 and closes its key;
-- (b) the predicate itself on the real asasmakeen 24218832 shape, served «سنوي» (must be durable) and served «شهري»
--     (must be divergence), evaluated as a plain SELECT.
do $$
declare r int; v_open int; v_ok boolean; v_bad boolean;
begin
  r := public.mon_detect_search_index_diverges_from_sync_source();
  select count(*) into v_open from public.alert_event
   where dedup_key = 'search_index_diverges_from_sync_source' and resolved_at is null;
  if r <> 0 or v_open <> 0 then
    raise exception 'PROOF: the oracle still reads the judged thousands rows as divergence (returned %, open %)', r, v_open;
  end if;
  with a as (select 'asasmakeen'::text platform, null::text rent_period, 63::numeric price_annual, null::numeric price_total, 'Apartment'::text property_type),
       s as (select 'asasmakeen'::text platform, true price_in_thousands, true rent_period_judged, 63000::numeric price_annual, 'شقة'::text type_ar)
  select
    ('سنوي' is distinct from coalesce(public.rent_pool_ar(s.platform, a.rent_period), case when public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type), a.price_total), s.type_ar) is not null then 'سنوي' when s.rent_period_judged and (case when s.price_in_thousands then 1000 else 1 end) * public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type) is not distinct from s.price_annual then 'سنوي' end)),
    ('شهري' is distinct from coalesce(public.rent_pool_ar(s.platform, a.rent_period), case when public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type), a.price_total), s.type_ar) is not null then 'سنوي' when s.rent_period_judged and (case when s.price_in_thousands then 1000 else 1 end) * public.rent_price_annual_ar(s.platform, a.rent_period, a.price_annual, a.property_type) is not distinct from s.price_annual then 'شهري' end))
    into v_ok, v_bad from a, s;
  if v_ok then raise exception 'PROOF: the served «سنوي» on a judged thousands row still reads as divergence'; end if;
  if not v_bad then raise exception 'PROOF: a flipped period on a judged thousands row is NOT caught'; end if;
  raise notice 'PROOF: oracle clean on the judged thousands rows; a flipped period is still caught';
end $$;
