-- PRICE_EQ_AREA — adjudicate the two open rows, and stop the waiver registry outliving its proof.
--
-- THE ADJUDICATION (senior run, 2026-08-21). mon_detect_price_eq_area_or_ppm raised P1 with
-- count=2. Both are dealapp Residential Land rows where price_total == area_m2 and
-- price_per_meter == 1 — the SAME class already adjudicated five times (listing_ids 2046807,
-- 5440634, 1039954, 2046809): dealapp itself publishes «سعر المتر» = 1 ريال on these عرعر/غرناطة
-- land plots, so its own structured offers.price equals the area.
--
-- Ezhalah does NOT derive either figure. scrapers/dealapp/run.py:764 reads price_per_meter from
-- the source-published «سعر المتر» spec row ONLY — the old price/area fallback that fabricated a
-- rate was deliberately removed (PR#216/#217). So both values are captured, not computed, and the
-- absolute source-fidelity rule applies: the source published it, we preserve it exactly.
--
-- THE GAP THIS ALSO CLOSES. ops_price_eq_area_verified is an alert-SUPPRESSING registry, and
-- nothing re-checked it: mon_detect_price_eq_area_or_ppm and mon_price_size_fidelity_barrier both
-- only read it as a mute-list. A waiver proven for price X stayed in force even if the stored
-- price later became Y — precisely the "a waiver must not outlive its proof" failure the
-- 2026-08-13 owner rule exists to prevent. Waivers now RECORD the price they were proven for, and
-- a detector re-checks that the price has not moved underneath them.

alter table public.ops_price_eq_area_verified
  add column if not exists verified_price_total numeric,
  add column if not exists verified_area_m2     integer;

comment on column public.ops_price_eq_area_verified.verified_price_total is
  'The stored price this waiver was actually proven against. mon_detect_price_eq_area_waiver_stale re-raises if the served price later moves away from it, so a waiver cannot outlive its evidence.';

-- Backfill the standing waivers with the price they currently cover, so the new detector has a
-- baseline for every row rather than silently ignoring the pre-existing ones.
update public.ops_price_eq_area_verified v
   set verified_price_total = s.price_total,
       verified_area_m2     = s.area_m2
  from public.search_listings_ar s
 where s.source_table = v.source_table
   and s.listing_id  = v.listing_id
   and v.verified_price_total is null;

insert into public.ops_price_eq_area_verified
  (source_table, listing_id, evidence, verified_at, verified_price_total, verified_area_m2)
values
  ('dealapp_residential_listings', 4952759,
   'DA556898 (ارض سكنية للبيع، حي غرناطة، عرعر، بلك ج قطعة 1401، شارع 40م، المساحة 630 م). '
   'price_total(630) == area_m2(630) because dealapp publishes سعر المتر = 1 ريال. '
   'INDEPENDENT LIVE RE-PROBE 2026-08-21 from this container: GET https://dealapp.sa/ar/ad-details/556898 '
   '-> HTTP 200, 160,457 bytes, ad-specific <title>«ارض سكنية للبيع», ng-state carries '
   'real-estate-listing-schema-556898 publishing "price":630 with the spec table showing المساحة 630 م. '
   'Ezhalah stored 630 verbatim. Contemporaneous row capture (raw_captured_at 2026-08-21 02:59 UTC) agrees: '
   'price_evidence = {origin:structured, field:offers.price, found:true, raw:"630", stored:630}. '
   'Source-real, NOT a parser artifact — preserve exactly.',
   now(), 630, 630),
  ('dealapp_residential_listings', 1501421,
   'DA284846 (أرض تجارية، مكة المكرمة، الحسينية، 11066 م²). price_total(11066) == area_m2(11066), price_per_meter=1. '
   'EVIDENCE = Ezhalah''s OWN CONTEMPORANEOUS CAPTURE, raw_captured_at 2026-08-21 02:49 UTC (same morning as this '
   'adjudication): price_evidence = {origin:structured, field:offers.price, found:true, raw:"11066.13", stored:11066} '
   '— dealapp publishes 11066.13 in its structured offers.price, i.e. dealapp has put the AREA in its own price '
   'field. The captured source_text independently confirms the area («بمساحة تقدر بـ(11066)متر مربع») and shows the '
   'advertiser''s real ask is «المطلوب في المتر ١٢٠٠» (~13.28M SAR total) — but that is prose, and the platform''s '
   'STRUCTURED price field is what we mirror. '
   'HONEST PROBE LIMIT: an independent live re-fetch from this container returned dealapp''s GENERIC SSR SHELL '
   '(130,340 bytes, generic site <title>, no real-estate-listing-schema-284846, zero ad content) on 3/3 attempts, '
   'while the control fetch of 556898 rendered fully. That is a DEGRADED FETCH FROM THIS EGRESS, recorded as '
   'INCONCLUSIVE — it is NOT evidence the source stopped publishing (2026-08-13 rule: absence != omission), and it '
   'is NOT counted as confirmation. The scraper itself reached the full ad hours earlier. '
   'Source-real on the contemporaneous structured capture — preserve exactly; re-probe if the price moves.',
   now(), 11066, 11066)
on conflict (source_table, listing_id) do nothing;

-- ── the re-check: a waiver must not outlive the price it was proven for ──────────────────────
create or replace function public.mon_detect_price_eq_area_waiver_stale()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
  r record;
begin
  for r in
    select v.source_table, v.listing_id, v.verified_price_total, v.verified_at,
           s.price_total as current_price_total, s.area_m2 as current_area_m2
      from public.ops_price_eq_area_verified v
      join public.search_listings_ar s
        on s.source_table = v.source_table and s.listing_id = v.listing_id
     where s.production_ready
       and v.verified_price_total is not null
  loop
    if r.current_price_total is distinct from r.verified_price_total then
      v_n := v_n + public.mon_raise('P2', 'price_eq_area_waiver_stale', r.source_table,
        'price_eq_area_waiver_stale:' || r.source_table || ':' || r.listing_id,
        jsonb_build_object(
          'source_table', r.source_table, 'listing_id', r.listing_id,
          'verified_price_total', r.verified_price_total,
          'current_price_total', r.current_price_total,
          'current_area_m2', r.current_area_m2,
          'verified_at', r.verified_at,
          'why', 'This row carries a standing price_eq_area waiver that SUPPRESSES mon_detect_price_eq_area_or_ppm, but the served price has moved away from the price the waiver was actually proven against. The waiver is now unproven and may be hiding a real parser artifact.',
          'fix', 'Re-probe the source ad. Still source-published -> update ops_price_eq_area_verified.verified_price_total (and the evidence text) to the new proven value. Parser artifact -> DELETE the waiver row, NULL the price and fix the writer. Do NOT simply refresh the number to silence this.'));
    else
      perform public.mon_resolve_key('price_eq_area_waiver_stale',
        'price_eq_area_waiver_stale:' || r.source_table || ':' || r.listing_id);
    end if;
  end loop;
  return v_n;
end
$function$;

-- Roster entry, in the SAME migration (mon_detect_orphaned_detectors flags anything the roster
-- cannot reach). GUARDED needle-edit of the LIVE body — never a hand-pasted rebuild.
do $$
declare
  v_def text; v_before text; fn text;
  want text[] := array['mon_detect_price_eq_area_waiver_stale'];
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
    end if;
  end loop;
  if v_def = v_before then
    raise notice 'roster already carries the detector — nothing to do';
    return;
  end if;
  execute v_def;
end $$;

-- Prove reachability in the same migration.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array['mon_detect_price_eq_area_waiver_stale', 'mon_detect_orphaned_detectors'];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster edit lost or failed to add: %', missing;
  end if;
end $$;
