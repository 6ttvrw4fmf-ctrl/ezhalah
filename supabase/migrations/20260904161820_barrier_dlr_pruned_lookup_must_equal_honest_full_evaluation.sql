-- PERMANENT REGRESSION BARRIER for the 2026-09-04 optimisation of
-- mon_detect_discarded_location_resolution (p90 87.9s / max 690.9s -> 646 ms).
--
-- That speed-up rests on exactly ONE assumption: that filtering listing_native_location_v2 by a
-- literal source_table constant -- which prunes the ~60-branch UNION to a single branch -- returns
-- byte-identical rows to evaluating the whole view honestly and filtering afterwards. That is true
-- today (verified on souq24 42/42 and wasalt 50,272/50,272, diff 0 in both directions), but it is
-- a property of the VIEW, not of the detector. If someone later adds a v2 branch that aggregates
-- or window-functions ACROSS source_tables, early filtering silently starts returning different
-- rows -- and the detector would go on reporting a confident, WRONG limb classification. Nothing
-- else in the system would notice, because the fast path would still be fast and still return a
-- number.
--
-- So this barrier re-proves the assumption against live data. It samples real keys spread across
-- every source_table (up to 10 each, so many branches are exercised, plus every genuine current
-- candidate), computes the same rows TWICE -- once the pruned way the detector now uses, once with
-- the full view forced to evaluate completely behind an `OFFSET 0` optimisation fence and filtered
-- afterwards -- and compares with EXCEPT ALL in BOTH directions. EXCEPT ALL rather than EXCEPT, so
-- a duplicate-row difference is caught too, not just set membership.
--
-- It is gated to ~20h by mon_claim_daily_slot because the honest side costs a full v2 evaluation
-- (measured 46.8s for 197,559 rows) and this is a structural property that cannot change between
-- half-hourly sweeps. Gating here is the sanctioned pattern, it is exempt from
-- mon_detect_ungated_expensive_detector by design, and a gated detector that stops running is
-- caught by mon_detect_stalled_daily_detector (30h) -- so it cannot go dark quietly.
--
-- The COST half of the regression is already barriered and needs nothing here: if the detector
-- ever reverts to the whole-view join, its p90 climbs back over the 45s ceiling and
-- mon_detect_ungated_expensive_detector names it.

create or replace function public.mon_detect_dlr_lookup_equivalence()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  v_pruned_only bigint;
  v_full_only   bigint;
  v_sample_n    bigint;
  v_sample      jsonb;
begin
  if not public.mon_claim_daily_slot('dlr_lookup_equivalence') then return 0; end if;

  -- Sample: a spread across every source_table (branch coverage), plus every real candidate.
  drop table if exists pg_temp._dlreq_keys;
  create temp table _dlreq_keys (source_table text, listing_id bigint) on commit drop;

  insert into pg_temp._dlreq_keys (source_table, listing_id)
  select s.source_table, s.listing_id
    from (select source_table, listing_id,
                 row_number() over (partition by source_table order by listing_id) as rn
            from public.search_listings_ar) s
   where s.rn <= 10;

  insert into pg_temp._dlreq_keys (source_table, listing_id)
  select c.source_table, c.listing_id from public.mon_discarded_location_candidates c
   where not exists (select 1 from pg_temp._dlreq_keys k
                      where k.source_table = c.source_table and k.listing_id = c.listing_id);

  select count(*) into v_sample_n from pg_temp._dlreq_keys;

  -- SIDE 1 -- the pruned lookup the detector actually uses (literal source_table via %L).
  drop table if exists pg_temp._dlreq_pruned;
  create temp table _dlreq_pruned (source_table text, listing_id bigint, city_id integer) on commit drop;

  for r in select distinct k.source_table from pg_temp._dlreq_keys k loop
    execute format(
      'insert into pg_temp._dlreq_pruned (source_table, listing_id, city_id)
         select v.source_table, v.listing_id, v.city_id
           from public.listing_native_location_v2 v
          where v.source_table = %L
            and v.listing_id in (select k.listing_id from pg_temp._dlreq_keys k
                                  where k.source_table = %L)',
      r.source_table, r.source_table);
  end loop;

  -- SIDE 2 -- the honest baseline: full evaluation behind an OFFSET 0 fence, filtered afterwards.
  drop table if exists pg_temp._dlreq_full;
  create temp table _dlreq_full on commit drop as
  select x.source_table, x.listing_id, x.city_id
    from (select source_table, listing_id, city_id
            from public.listing_native_location_v2 offset 0) x
    join pg_temp._dlreq_keys k
      on k.source_table = x.source_table and k.listing_id = x.listing_id;

  select count(*) into v_pruned_only from (
    select source_table, listing_id, city_id from pg_temp._dlreq_pruned
    except all
    select source_table, listing_id, city_id from pg_temp._dlreq_full) a;

  select count(*) into v_full_only from (
    select source_table, listing_id, city_id from pg_temp._dlreq_full
    except all
    select source_table, listing_id, city_id from pg_temp._dlreq_pruned) b;

  if coalesce(v_pruned_only, 0) > 0 or coalesce(v_full_only, 0) > 0 then
    select jsonb_agg(x) into v_sample from (
      select 'pruned_only' as side, source_table, listing_id, city_id from (
        select source_table, listing_id, city_id from pg_temp._dlreq_pruned
        except all
        select source_table, listing_id, city_id from pg_temp._dlreq_full) a
      union all
      select 'full_only', source_table, listing_id, city_id from (
        select source_table, listing_id, city_id from pg_temp._dlreq_full
        except all
        select source_table, listing_id, city_id from pg_temp._dlreq_pruned) b
      limit 20) x;

    n := n + public.mon_raise('P1', 'dlr_lookup_equivalence', 'monitoring', 'dlr_lookup_equivalence',
      jsonb_build_object(
        'pruned_only', v_pruned_only,
        'full_only', v_full_only,
        'sample_keys', v_sample_n,
        'sample', v_sample,
        'why', 'mon_detect_discarded_location_resolution looks listings up in '
            || 'listing_native_location_v2 one PRUNED branch at a time (source_table inlined as a '
            || 'literal) instead of evaluating the whole UNION. That is only valid while early '
            || 'filtering by source_table returns exactly what honest full evaluation returns. It '
            || 'no longer does. Until this is resolved the discarded-location limbs '
            || '(not_in_v2 / pipeline_discard / sync_not_propagated) may be WRONG, not merely '
            || 'stale, and a listing unreachable by every Filter can be reported as fine.',
        'adjudicate', 'Almost certainly a NEW v2 branch that aggregates or windows ACROSS '
            || 'source_tables, so restricting to one table changes its own result. Find it by '
            || 'diffing the sample keys branch by branch. Fix the BRANCH so it is per-listing, or '
            || 'if the cross-table dependency is genuinely intended, revert the detector to the '
            || 'whole-view join and re-cost the sweep budget deliberately.',
        'do_not', 'Do NOT silence this by shrinking the sample or by removing the OFFSET 0 fence '
            || '-- the fence is what makes the second side an INDEPENDENT oracle rather than a '
            || 'copy of the first.'));
  else
    perform public.mon_resolve_key('dlr_lookup_equivalence', 'dlr_lookup_equivalence');
  end if;

  drop table if exists pg_temp._dlreq_pruned;
  drop table if exists pg_temp._dlreq_full;
  drop table if exists pg_temp._dlreq_keys;
  return n;
end
$function$;

-- Roster entry in the SAME migration (AGENTS.md): a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on exactly that. Needle edit with an anchor assertion so
-- the existing roster is preserved byte-for-byte.
do $mig$
declare
  v_def text;
  a_tail constant text := '''mon_detect_ungated_expensive_detector''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then raise exception 'mon_run_all_detectors() not found'; end if;
  if position('mon_detect_dlr_lookup_equivalence' in v_def) > 0 then
    raise notice 'roster already carries the detector -- nothing to do';
    return;
  end if;
  if position(a_tail in v_def) = 0 then raise exception 'anchor missing: roster tail'; end if;

  execute replace(v_def, a_tail, a_tail || ', ''mon_detect_dlr_lookup_equivalence''');
end
$mig$;
