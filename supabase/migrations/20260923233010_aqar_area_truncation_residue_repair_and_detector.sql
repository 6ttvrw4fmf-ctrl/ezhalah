-- Routine #3 DATA INTEGRITY, 2026-09-23. The aqar comma-truncated AREA residue that the
-- 2026-08-11 repair could not reach, plus the detector that makes the residue itself watched.
--
-- WHAT WAS WRONG
-- aqar_commercial_listings 293744 is SERVED (production_ready) as a 1 m2 shop at 1,500,000 SAR/yr.
-- Its own captured text says «للايجار وحدة تجارية بمساحة 1161متر» - the source publishes 1161 m2.
-- At 1161 m2 the rent is 1,292 SAR/m2/yr, an ordinary Riyadh commercial figure. The PRICE was never
-- wrong; the AREA was truncated at its thousands separator, exactly the class repaired on
-- 2026-08-11 (migration 20260811123957) for a different cohort.
--
-- WHY THE 2026-08-11 REPAIR LEFT THESE BEHIND
-- That migration's WHERE clause was `aqar_residential_listings ... price_total is not null and
-- price_total/area_m2 > 2000000`. Two exclusions follow from it by construction:
--     * aqar_COMMERCIAL_listings was never in scope at all;
--     * RENT rows (price_annual) were never in scope, in either table.
-- 293744 is both. No barrier could see it either: scripts/verify-aqar-area-comma-safe.ts pins the
-- live PARSER, and the parser is genuinely comma-safe - all six residue rows carry the retired June
-- `backfill.v1` stub capture (scraped 2026-06-19/20) and no row created since has this shape. The
-- guard over the code read as coverage for the DATA, which is the "a pointer reads as coverage"
-- shape docs/ops/BARRIER_ENGINEER.md PART 1.11 names. Nothing measured the residue, so five served
-- rows sat wrong for six weeks after the class was declared repaired.
--
-- THE REPAIR IS SELF-CORROBORATING, NOT A GUESS
-- Identical rule to 2026-08-11: a row is repaired only when the area stated in its OWN captured
-- text, formatted with thousands separators, truncates to exactly the stored value -
-- floor(stated/1000) = stored. That proves the two numbers are the same figure. Per row:
--     commercial 293744  «مساحة 1161متر»           1 -> 1161   (rent 1,500,000/yr = 1,292/m2)
--     commercial 299818  «مساحة 1480 متر»          1 -> 1480   (rent   296,000/yr =   200/m2)
--     commercial 301049  «المساحه 1200 متر»        1 -> 1200   (rent   225,000/yr =   187/m2)
--     commercial 301430  «مساحه اجماليه 1062 متر»  1 -> 1062   (rent   180,000/yr =   169/m2;
--                                                               text also states «الايجار 180 الف»)
--     residential 59896  «المساحة / 1710 متر»      1 -> 1710   (sale 1,200,420 = 702/m2; text also
--                                                               states «البيع مليون و 200 ألف»)
--
-- WHAT IS DELIBERATELY NOT REPAIRED
-- residential 22422 corroborates arithmetically (stored 2, «مساحة القطع: 2869.74 م²») and is left
-- ALONE: its text is «للبيع 3 قطع أراضٍ» - three plots - so «مساحة القطع» may be the total of the
-- three, not this listing's area. 2026-08-11 rejected the same shape by hand (id 60977,
-- «مساحة 2550 متر للقطعتين»). Here it is rejected BY RULE, so the exclusion cannot be forgotten:
-- the multi-plot predicate below is part of both the repair and the detector. The row carries no
-- price at all, so it distorts nothing while it stays as captured. Unknown stays unknown.
-- NO PRICE IS TOUCHED ANYWHERE IN THIS MIGRATION.

-- PART 1 - repair
do $mig$
declare
  v_rows int; v_price_before bigint; v_price_after bigint;
begin
  create temp table _fix on commit drop as
  with cand as (
    select 'aqar_commercial_listings'::text tbl, id, area_m2,
           translate(source_capture->>'source_text','٠١٢٣٤٥٦٧٨٩','0123456789') t
      from public.aqar_commercial_listings
     where active and area_m2 between 1 and 10 and source_capture->>'source_text' is not null
    union all
    select 'aqar_residential_listings', id, area_m2,
           translate(source_capture->>'source_text','٠١٢٣٤٥٦٧٨٩','0123456789')
      from public.aqar_residential_listings
     where active and area_m2 between 1 and 10 and source_capture->>'source_text' is not null
  ), p as (
    select tbl, id, area_m2 old_area,
           replace((regexp_match(t,'مساح[ةه][^0-9]{0,20}([0-9][0-9,\.]*)\s*(?:م2|م²|متر|م\b)'))[1], ',', '') tok,
           (t ~ 'قطعتين|قطعتان' or t ~ '[0-9]\s*قطع\y' or t ~ 'مساح[ةه]\s*القطع\y') multi_plot
      from cand
  )
  select tbl, id, old_area, floor(tok::numeric)::int new_area
    from p
   where tok is not null and tok ~ '^[0-9]+(\.[0-9]+)?$' and not multi_plot
     and floor(tok::numeric)::int >= 1000
     and floor(floor(tok::numeric)::int / 1000) = old_area;

  select count(*) into v_rows from _fix;
  if v_rows <> 5 then
    raise exception 'corroborated residue is % rows, expected 5 - data moved, aborting', v_rows;
  end if;

  select coalesce(sum(coalesce(price_total,0) + coalesce(price_annual,0)),0) into v_price_before
    from (select price_total, price_annual from public.aqar_commercial_listings
           where id in (select id from _fix where tbl='aqar_commercial_listings')
          union all
          select price_total, price_annual from public.aqar_residential_listings
           where id in (select id from _fix where tbl='aqar_residential_listings')) q;

  update public.aqar_commercial_listings l set area_m2 = f.new_area
    from _fix f where f.tbl='aqar_commercial_listings' and l.id = f.id;
  update public.aqar_residential_listings l set area_m2 = f.new_area
    from _fix f where f.tbl='aqar_residential_listings' and l.id = f.id;

  select coalesce(sum(coalesce(price_total,0) + coalesce(price_annual,0)),0) into v_price_after
    from (select price_total, price_annual from public.aqar_commercial_listings
           where id in (select id from _fix where tbl='aqar_commercial_listings')
          union all
          select price_total, price_annual from public.aqar_residential_listings
           where id in (select id from _fix where tbl='aqar_residential_listings')) q;

  if v_price_before <> v_price_after then
    raise exception 'a price moved (% -> %) - this migration must never touch price, aborting',
      v_price_before, v_price_after;
  end if;

  raise notice 'repaired % truncated areas; price sum unchanged at %', v_rows, v_price_after;
end $mig$;

-- PART 2 - the residue is now WATCHED, not assumed empty
create or replace function public.mon_detect_aqar_area_truncation_residue()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; v_rows int; v_items jsonb;
begin
  with cand as (
    select 'aqar_commercial_listings'::text tbl, id, area_m2,
           translate(source_capture->>'source_text','٠١٢٣٤٥٦٧٨٩','0123456789') t
      from public.aqar_commercial_listings
     where active and area_m2 between 1 and 10 and source_capture->>'source_text' is not null
    union all
    select 'aqar_residential_listings', id, area_m2,
           translate(source_capture->>'source_text','٠١٢٣٤٥٦٧٨٩','0123456789')
      from public.aqar_residential_listings
     where active and area_m2 between 1 and 10 and source_capture->>'source_text' is not null
  ), p as (
    select tbl, id, area_m2 old_area,
           replace((regexp_match(t,'مساح[ةه][^0-9]{0,20}([0-9][0-9,\.]*)\s*(?:م2|م²|متر|م\b)'))[1], ',', '') tok,
           (t ~ 'قطعتين|قطعتان' or t ~ '[0-9]\s*قطع\y' or t ~ 'مساح[ةه]\s*القطع\y') multi_plot
      from cand
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'id', id,
                                               'stored_area_m2', old_area,
                                               'area_stated_in_its_own_capture', floor(tok::numeric)::int)
                            order by tbl, id), '[]'::jsonb)
    into v_rows, v_items
    from p
   where tok is not null and tok ~ '^[0-9]+(\.[0-9]+)?$' and not multi_plot
     and floor(tok::numeric)::int >= 1000
     and floor(floor(tok::numeric)::int / 1000) = old_area;

  if v_rows > 0 then
    n := n + public.mon_raise('P1', 'aqar_area_truncation_residue', 'aqar',
      'aqar_area_truncation_residue:active',
      jsonb_build_object(
        'rows', v_rows,
        'listings', v_items,
        'why', 'An ACTIVE aqar row stores an area that is exactly floor(stated/1000) of the area '
            || 'its OWN captured text publishes - the thousands-comma truncation class repaired on '
            || '2026-08-11 (20260811123957) and again on 2026-09-23. Stored 1 m2 beside a '
            || 'seven-figure price is not a small unit, it is a lost thousands group, and the row '
            || 'is served that way: unreachable by any area filter and nonsense on the card.',
        'adjudicate', 'The PRICE is not the suspect - check the area first and never reprice. '
            || 'Repair only on the self-corroborating rule floor(stated/1000) = stored, and only '
            || 'for a SINGLE unit: a text naming several plots may be stating a combined area, so '
            || 'it is excluded by rule and must stay exactly as captured.'));
  else
    perform public.mon_resolve_key('aqar_area_truncation_residue', 'aqar_area_truncation_residue:active');
  end if;

  return n;
end $function$;

-- PART 3 - roster entry, in the SAME migration (AGENTS.md: a detector nothing reaches is decoration).
-- Surgical append: mon_run_all_detectors() is a ~15.6 KB shared function that several routines edit,
-- so it is amended in place by anchored replacement rather than retyped - which would both risk
-- clobbering a concurrent session's roster entry and burn the tokens AGENTS.md forbids spending
-- retyping something that already exists.
do $roster$
declare
  v_src text; v_anchor constant text := '''mon_detect_detector_dark''';
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_src is null then raise exception 'mon_run_all_detectors() not found'; end if;

  if position('mon_detect_aqar_area_truncation_residue' in v_src) > 0 then
    raise notice 'already on the roster - nothing to do';
    return;
  end if;

  if (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'roster anchor % is not present exactly once - refusing to edit blind', v_anchor;
  end if;

  execute format('create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql as %L',
                 replace(v_src, v_anchor,
                         v_anchor || ', ' || quote_literal('mon_detect_aqar_area_truncation_residue')));

  if (select position('mon_detect_aqar_area_truncation_residue' in prosrc) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='mon_run_all_detectors') = 0 then
    raise exception 'roster append did not take';
  end if;
end $roster$;
