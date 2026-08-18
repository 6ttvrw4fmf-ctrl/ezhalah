-- BARRIER for the class fixed by 20260818_district_bridge_ambiguity_guard: "a حي search returns
-- listings from a different حي because a noisy name bridge injected a foreign token".
--
-- Two independent limbs, because either alone can go quiet:
--   1. STRUCTURAL — if district_name_bridge contains ambiguous names (it does: 68) and the guard is
--      NOT in the live location_search_candidates_ar body, the leak is back. This catches a rewrite
--      of the RPC that drops the guard, which is exactly how the CITY guard's sibling was lost for
--      the district branch in the first place.
--   2. BEHAVIOURAL — actually call the search for up to 3 ambiguous أحياء that exist in the live
--      catalog and count rows whose district is not one the caller asked for. This catches a leak
--      arriving by a route the structural check does not model.
--
-- The behavioural limb drives real RPCs, so it is gated to ~once per 20h via mon_claim_daily_slot,
-- per the expensive-detector convention.

create or replace function public.mon_district_bridge_leak_probe()
returns table (district_ar text, city_ar text, returned bigint, foreign_rows bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record;
begin
  for r in
    select b.district_ar as d, s.city_ar as c
      from public.district_name_bridge b
      join lateral (
        select sl.city_ar
          from public.search_listings_ar sl
         where sl.production_ready
           and public.norm_district_tok(sl.district_ar) = public.norm_district_tok(b.district_ar)
         group by sl.city_ar order by count(*) desc limit 1
      ) s on true
     where public.norm_en_place(b.district_en) in (
             select public.norm_en_place(b2.district_en) from public.district_name_bridge b2
              group by public.norm_en_place(b2.district_en)
             having count(distinct public.norm_district_tok(b2.district_ar)) > 1)
     group by b.district_ar, s.city_ar
     limit 3
  loop
    return query
      select r.d, r.c, count(*)::bigint,
             count(*) filter (where public.norm_district_tok(x.district_ar)
                                    <> public.norm_district_tok(r.d))::bigint
        from public.location_search_candidates_ar(
               p_cities := array[r.c], p_districts := array[r.d], p_limit := 400) x;
  end loop;
end $function$;

create or replace function public.mon_detect_district_bridge_leak()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; v_def text; v_amb int; v_guard boolean; live text[] := '{}'; r record; v_leak int := 0;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'location_search_candidates_ar';
  select count(*) into v_amb from (
    select norm_en_place(district_en) e from public.district_name_bridge
     group by 1 having count(distinct norm_district_tok(district_ar)) > 1) z;
  v_guard := coalesce(position('AMBIGUITY GUARD (2026-08-18' in coalesce(v_def, '')) > 0, false);

  if v_amb > 0 and not v_guard then
    live := live || 'district_bridge_leak:guard_missing';
    n := n + public.mon_raise('P1', 'district_bridge_leak', 'all', 'district_bridge_leak:guard_missing',
      jsonb_build_object(
        'ambiguous_bridge_names', v_amb,
        'why', 'district_name_bridge maps these names to more than one canonical Arabic حي, and the '
            || 'ambiguity guard is NOT present in location_search_candidates_ar — a حي search can '
            || 'return listings from a different حي (found live 2026-08-18: حقروصين -> حي جعرانة).',
        'fix', 'restore the guarded district_tokens CTE (migration district_bridge_ambiguity_guard)'));
  end if;

  -- behavioural limb, ~once per 20h
  if public.mon_claim_daily_slot('district_bridge_leak') then
    for r in select * from public.mon_district_bridge_leak_probe() loop
      if r.foreign_rows > 0 then
        v_leak := v_leak + 1;
        live := live || ('district_bridge_leak:probe:' || r.district_ar);
        n := n + public.mon_raise('P1', 'district_bridge_leak', 'all',
          'district_bridge_leak:probe:' || r.district_ar,
          jsonb_build_object('district', r.district_ar, 'city', r.city_ar,
                             'returned', r.returned, 'foreign_rows', r.foreign_rows,
                             'why', 'a حي search returned listings whose حي the user did not select'));
      end if;
    end loop;
    update public.ops_detector_last_full_run set last_result = n where detector = 'district_bridge_leak';
  end if;

  perform public.mon_resolve_stale_keys('district_bridge_leak', live);
  return n;
end $function$;

comment on function public.mon_detect_district_bridge_leak() is
  'Barrier (Search & Matching QA stress run, 2026-08-18): a حي search must never return a different '
  'حي. Structural limb watches the ambiguity guard in location_search_candidates_ar; behavioural limb '
  'probes real ambiguous أحياء once per ~20h.';

-- Roster wiring via the guarded pg_get_functiondef NEEDLE-EDIT (never a hand-pasted body).
do $$
declare
  v_def text; v_before text;
  fn constant text := 'mon_detect_district_bridge_leak';
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then raise exception 'roster anchor missing'; end if;
  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;
  if v_def <> v_before then execute v_def; end if;
end $$;

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position('''mon_detect_district_bridge_leak''' in v_def) = 0 then
    raise exception 'detector not reachable from the roster';
  end if;
  if position('''mon_detect_orphaned_detectors''' in v_def) = 0
     or position('open_alerts' in v_def) = 0 then
    raise exception 'roster lost pre-existing content';
  end if;
end $$;
