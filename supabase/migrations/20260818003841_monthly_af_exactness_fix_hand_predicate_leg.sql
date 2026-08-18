-- FIX (same session, caught by the barrier's own first live run): the base leg hand-replicated the
-- eligibility predicate as `production_ready AND …` and came up 14/1/3 rows SHORT of the referee —
-- because the shared clause deliberately also admits unresolved-location rows on a COUNTRYWIDE
-- search (the owner-locked "unresolved location ⇒ countrywide" rule). Referee and landed agreed
-- with each other the whole time (30,370 = 30,370): the two real surfaces were exact, my third
-- hand-written leg was the wrong one. Lesson honoured: NEVER replicate the clause by hand — that is
-- the exact drift class this architecture exists to kill. The detector now asserts what the owner
-- actually specified: chip = referee = landed, all three built from the ONE shared clause. Raw-index
-- equality is already proven at exact city scope by mon_detect_trending_cohort_drift (9,164=9,164
-- style probes), where the strict-city semantics make a hand predicate exact.
create or replace function public.mon_detect_monthly_af_exactness()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; bad jsonb := '[]'::jsonb; n int := 0;
  v_ref bigint; v_landed bigint; v_chip bigint; v_unknown bigint;
begin
  for r in select type_ar from af_cohort_registry where enabled and rent_period_ar='شهري' loop
    -- base: referee == landed
    v_ref := af_eligible_count(p_deal:='إيجار', p_rent_period:='شهري',
               p_types:=array[r.type_ar], p_category:='Residential');
    select max(total_count) into v_landed from location_search_candidates_ar(
       p_deal:='إيجار', p_rent_period:='شهري', p_types:=array[r.type_ar],
       p_category:='Residential', p_limit:=1);
    if v_ref <> coalesce(v_landed, 0) then
      bad := bad || jsonb_build_object('cohort', r.type_ar, 'kind', 'base_exactness',
        'referee', v_ref, 'landed', v_landed);
    end if;
    -- rating chip: chip == referee == landed at the 9.5 threshold
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
    -- UNKNOWN safety, behaviourally: no NULL-rated row may ever satisfy a rating answer.
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

select public.mon_detect_monthly_af_exactness() as must_be_zero;