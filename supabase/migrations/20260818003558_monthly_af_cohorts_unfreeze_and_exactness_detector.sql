-- MONTHLY ADVANCED FILTER, stage 3: certify the cohorts, replace the freeze with a certified-set
-- guard, and add the Monthly exactness detector.
--
-- OWNER ORDER 2026-08-18 (verbatim): "Start building the Monthly Advanced Filter now. … This is
-- implementation, certification, barriers, deployment, and production verification." This
-- supersedes the 2026-08-15 freeze. The freeze barrier is REPLACED, not removed: the new guard
-- allows EXACTLY the certified Monthly set and still pages P1 on any uncertified شهري row, so a
-- random session still cannot enable a cohort without a reviewed migration.
--
-- Cohort decisions are DATA-DESIGNED from the 2026-08-18 profiling (Monthly = payment_monthly AND
-- NOT rnpl, the live search semantics):
--   شقة  30,356 (24,716 rated) → rating + unit-subtype + amenities(elevator 62%/parking 33%) + bathrooms(56%)
--   غرفة    556 (   446 rated) → rating + amenities(elevator 53%/parking 31%)
--   فيلا    362 (   245 rated) → rating + bathrooms(92%) + amenities(parking 57%)
-- NOT enabled, with reasons the next session can re-check:
--   شاليه   287 — ZERO rated, zero elevator/parking/bathrooms known, 4 bedrooms known. No question
--                 exists to ask. Normal-Filter-only. (0 Gathern; single-platform aqarmonthly.)
--   مكتب    124 / معرض 7 / محل 6 (Commercial Monthly = 137 total) — below any usefulness floor;
--                 owner: "Keep Commercial Monthly Normal-Filter-only."
--   عمارة 40 · مخيم 28 · استراحة 24 · دور 18 · استوديو 16 — inventory floor.
-- Annual-dead fields NOT copied: kitchen (94/30,662), AC (7), age (564), floor (53), furnished
-- (100% true on Gathern — no variation). Fields investigated and rejected: guest_capacity
-- (constant 1), stay_nights (constant 30), booking_count (engagement, not a property fact —
-- neutrality), check_in/out + house_rules (free-prose), nightly_price (monthly basis is the deal).

insert into af_cohort_registry (deal_ar, rent_period_ar, type_ar, enabled, note) values
 ('إيجار','شهري','شقة', true,
  'Certified 2026-08-18 — Apartment/Rent-Monthly (n=30,356; Gathern 94%). Questions: rating (9.5+/9.0+/9.0+&rc10), unit subtype (استديو/شقق مخدومة/شقة), amenities (elevator/parking self-gate), bathrooms. Rating chip counts referee-proven exact (4,982/4,291 Riyadh probes).'),
 ('إيجار','شهري','غرفة', true,
  'Certified 2026-08-18 — Room/Rent-Monthly (n=556; 446 rated). Questions: rating + amenities (elevator 53%, parking 31%). bathrooms dead (0 known) — excluded.'),
 ('إيجار','شهري','فيلا', true,
  'Certified 2026-08-18 — Villa/Rent-Monthly (n=362; 245 rated). Questions: rating + bathrooms (92% known) + amenities (parking 57%; elevator 5% self-gates out).')
on conflict do nothing;

-- Replace the freeze block inside mon_check_filter_parity_legacy via needle-edit of the live body.
do $$
declare src text; newsrc text;
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_check_filter_parity_legacy';
  if src is null then raise exception 'mon_check_filter_parity_legacy not found'; end if;
  if position('af_registry_monthly_uncertified' in src) > 0 then
    raise notice 'already replaced — no-op';
  else
    if position('af_registry_monthly_unfrozen' in src) = 0 then
      raise exception 'freeze block anchor missing';
    end if;
    -- swap the whole freeze IF/ELSE for the certified-set guard
    newsrc := replace(src,
$old$  if (select count(*) from public.af_cohort_registry where rent_period_ar = 'شهري') > 0 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('af_registry_monthly_unfrozen', 1, 'a شهري row appeared in af_cohort_registry — Monthly is owner-FROZEN; no session may enable it.');
    perform public.mon_raise('P1', 'af_registry_monthly_unfrozen', 'search_index',
      'af_registry_monthly_unfrozen', jsonb_build_object('why', 'Monthly Rent is frozen by owner order; a شهري cohort row was inserted.'));
  else
    perform public.mon_resolve_key('af_registry_monthly_unfrozen', 'af_registry_monthly_unfrozen');
  end if;$old$,
$new$  -- Monthly UNFROZEN by owner order 2026-08-18 ("Start building the Monthly Advanced Filter
  -- now") — the freeze is replaced, not removed: only the CERTIFIED Monthly set may exist, and any
  -- other شهري row still pages P1. Certification happens in a reviewed migration, nowhere else.
  if exists (select 1 from public.af_cohort_registry
              where rent_period_ar = 'شهري' and type_ar not in ('شقة','غرفة','فيلا')) then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('af_registry_monthly_uncertified', 1,
            'an UNCERTIFIED شهري cohort row appeared in af_cohort_registry — Monthly cohorts are added only by reviewed migration (certified set 2026-08-18: شقة/غرفة/فيلا).');
    perform public.mon_raise('P1', 'af_registry_monthly_uncertified', 'search_index',
      'af_registry_monthly_uncertified', jsonb_build_object('why',
        'A شهري cohort outside the certified set was inserted without certification.'));
  else
    perform public.mon_resolve_key('af_registry_monthly_uncertified', 'af_registry_monthly_uncertified');
  end if;
  perform public.mon_resolve_key('af_registry_monthly_unfrozen', 'af_registry_monthly_unfrozen');$new$);
    -- floor: 53 certified rows -> 56 with the three Monthly cohorts
    newsrc := replace(newsrc, 'where enabled) < 53', 'where enabled) < 56');
    newsrc := replace(newsrc, $s$'floor', 53$s$, $s$'floor', 56$s$);
    newsrc := replace(newsrc,
      'enabled af_cohort_registry rows fell below the certified floor of 18 — a cohort silently lost barrier protection.',
      'enabled af_cohort_registry rows fell below the certified floor of 56 — a cohort silently lost barrier protection.');
    execute format('create or replace function public.mon_check_filter_parity_legacy() returns integer '
                   'language plpgsql security definer set search_path to ''public'' as %L', newsrc);
  end if;
end $$;

-- Monthly exactness detector: chip = referee = landed, per certified Monthly cohort, including the
-- rating and subtype chips, plus a sampled UNKNOWN-safety leg (no NULL-rated row may ever satisfy a
-- rating answer). All three surfaces are built from the ONE shared clause, so any inequality here
-- means a stale RPC body or index/predicate drift — the exact classes that have shipped before.
create or replace function public.mon_detect_monthly_af_exactness()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; bad jsonb := '[]'::jsonb; n int := 0;
  v_idx bigint; v_ref bigint; v_landed bigint; v_chip bigint; v_unknown bigint;
begin
  for r in select type_ar from af_cohort_registry where enabled and rent_period_ar='شهري' loop
    -- base: index == referee == landed
    select count(*) into v_idx from search_listings_ar s
     where s.production_ready and s.deal_ar='إيجار' and s.payment_monthly
       and not coalesce(s.rent_now_pay_later,false) and s.type_ar = r.type_ar;
    v_ref := af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري',
               p_types:=array[r.type_ar], p_category:='Residential');
    select max(total_count) into v_landed from location_search_candidates_ar(
       p_deal:='إيجار', p_rent_period:='شهري', p_types:=array[r.type_ar],
       p_category:='Residential', p_limit:=1);
    if v_idx <> v_ref or v_ref <> coalesce(v_landed, 0) then
      bad := bad || jsonb_build_object('cohort', r.type_ar, 'kind', 'base_exactness',
        'index', v_idx, 'referee', v_ref, 'landed', v_landed);
    end if;
    -- rating chip: chip == referee == landed at 9.5 threshold
    select cnt_rating95 into v_chip from apartment_guided_counts_ar(
       p_deal:='إيجار', p_rent_period:='شهري', p_types:=array[r.type_ar], p_category:='Residential');
    v_ref := af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري',
               p_types:=array[r.type_ar], p_category:='Residential', p_rating_min:=9.5);
    select max(total_count) into v_landed from location_search_candidates_ar(
       p_deal:='إيجار', p_rent_period:='شهري', p_types:=array[r.type_ar],
       p_category:='Residential', p_rating_min:=9.5, p_limit:=1);
    if v_chip <> v_ref or v_ref <> coalesce(v_landed, 0) then
      bad := bad || jsonb_build_object('cohort', r.type_ar, 'kind', 'rating_chip_exactness',
        'chip', v_chip, 'referee', v_ref, 'landed', v_landed);
    end if;
    -- UNKNOWN safety, behaviorally: sample the landed rating-filtered rows; none may be NULL-rated.
    select count(*) into v_unknown
      from location_search_candidates_ar(p_deal:='إيجار', p_rent_period:='شهري',
             p_types:=array[r.type_ar], p_category:='Residential', p_rating_min:=9.0, p_limit:=200) c
      join search_listings_ar s on s.source_table=c.source_table and s.listing_id=c.listing_id
     where s.rating is null;
    if v_unknown > 0 then
      bad := bad || jsonb_build_object('cohort', r.type_ar, 'kind', 'unrated_served_under_rating_filter',
        'rows', v_unknown);
    end if;
  end loop;

  -- subtype chip exactness (شقة only — the one cohort with a subtype vocabulary)
  select cnt_sub_studio into v_chip from apartment_guided_counts_ar(
     p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'], p_category:='Residential');
  v_ref := af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري', p_types:=array['شقة'],
             p_category:='Residential', p_unit_subtypes:=array['استديو']);
  if v_chip <> v_ref then
    bad := bad || jsonb_build_object('cohort','شقة','kind','subtype_chip_exactness','chip',v_chip,'referee',v_ref);
  end if;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1','monthly_af_exactness','search_index','monthly_af_exactness',
      jsonb_build_object('failures', bad,
        'why','A Monthly Advanced Filter chip, the referee count and the landed results disagree. '
           || 'All three are built from the one shared eligibility clause, so this is a stale RPC '
           || 'body, a template edit that skipped rebuild_af_filter_rpcs(), or index drift. The '
           || 'number on a chip is a promise — fix the predicate path, never the display.'));
  else
    perform public.mon_resolve_key('monthly_af_exactness','monthly_af_exactness');
  end if;
  return n;
end $$;

-- roster wiring, guarded needle-edit (reads live prosrc, anchors, splices one name)
do $$
declare src text; newsrc text;
begin
  select prosrc into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position('mon_detect_monthly_af_exactness' in src) > 0 then
    raise notice 'already on roster'; return; end if;
  if position('''mon_detect_gathern_rating_source_truth''' in src) = 0 then
    raise exception 'anchor mon_detect_gathern_rating_source_truth missing'; end if;
  newsrc := replace(src, '''mon_detect_gathern_rating_source_truth''',
    '''mon_detect_gathern_rating_source_truth'',' || chr(10) || '    ''mon_detect_monthly_af_exactness''');
  execute format('create or replace function public.mon_run_all_detectors() returns jsonb '
    'language plpgsql security definer set search_path to ''public'' as %L', newsrc);
end $$;

select public.mon_detect_monthly_af_exactness() as exactness_fired,
       public.mon_check_filter_parity_legacy() as parity_legacy_fired;