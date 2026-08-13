-- AQARATIKOM: rent_period was NULL on rows whose OWN captured source token says «سنوي».
-- Senior Production Engineer run #15, 2026-08-13. Triggered by P1 searchability_collapse:aqaratikom
-- (alert 486, 2026-08-12 21:29): Rent APARTMENT period-reachability fell 100% -> 67.4% of 43 rows.
--
-- WHAT THE EVIDENCE IS (§14 source-truth bar: prove Ezhalah created the error before repairing).
-- scrapers/aqaratikom/run.py:380 reads `subtype` STRAIGHT from the nawait.sa /ad/<id> detail payload
-- and stores it VERBATIM as additional_info.subtype_ar (run.py:472). It is the SOURCE's own period
-- field, not an Ezhalah inference. The very same variable feeds _rent_period() (run.py:321), a
-- deterministic map where «سنوي» -> 'annual'. So a row holding subtype_ar='سنوي' with rent_period
-- NULL is Ezhalah's own data contradicting Ezhalah's own captured source value -- it cannot be a
-- source limitation, because the source token is sitting in the row.
--
-- Corroborated per-row: id 645398's additional_info is fully detail-derived (instrument_number,
-- plan/lot number, REGA issue+end dates, lat/long) -- i.e. its last write had a SUCCESSFUL detail
-- fetch that read subtype='سنوي'. This is not the failed-fetch case.
--
-- WHAT WAS RULED OUT before writing (each checked, each refuted):
--   * migration 20260811133115 (rent_period_source_truth_retractions) -- read in full, all 6
--     sections: aqaratikom appears ONLY in its header's explicitly-UNTOUCHED list. It is the sole
--     migration in the whole history matching `rent_period = null`.
--   * a DB trigger -- the table carries only trg_set_deactivated_at.
--   * _sanitize_price() -- touches price columns only, never rent_period.
--   * failed-detail-fetch erasure -- _unknown_must_not_overwrite_known() (common/db.py, owner rule
--     2026-08-09) DROPS a None key rather than sending NULL, so a silent fetch preserves the stored
--     period. That path yields the OPPOSITE signature (period kept, subtype_ar dropped).
--   * re-capture clobber -- all 46 correctly-'annual' rows were re-captured 2026-08-13 and KEPT it.
-- The originating write is historical (the whole affected set is the June-22 first-crawl id block,
-- 645394-645462, interleaved with correct rows) and is no longer reproducible. The CURRENT code is
-- correct, which is what makes this repair safe rather than a one-crawl-half-life patch (run #6's
-- lesson): the next crawl of these rows recomputes EXACTLY 'annual' from the same stored token, so
-- the repair and the write path agree instead of fighting. Nothing here changes search semantics or
-- product meaning -- it re-runs the documented mapping on a source value we already hold.
--
-- Blast radius: 15 rows (2 active + 13 inactive), aqaratikom only. Prices untouched.

-- ═══ 0. ONE definition of the mapping, shared by the repair and the barrier ═══
-- Mirrors scrapers/aqaratikom/run.py::_rent_period byte-for-byte, INCLUDING the نصف/ربع exclusions,
-- so no half-year/quarter token can ever be widened into 'annual'. Defined once on purpose: three
-- hand-copied CASE arms is the same drift hazard this codebase has been bitten by repeatedly.
-- Returns NULL for an absent or unrecognized token -- the honest-unknown case, never a default.
create or replace function public.aqaratikom_period_from_token(p_token text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_token is null then null
    when p_token like '%يوم%' then 'daily'
    when p_token like '%شهر%' then 'monthly'
    when (p_token like '%سنو%' or p_token like '%سنة%')
         and p_token not like '%نصف%' and p_token not like '%ربع%' then 'annual'
    else null
  end;
$function$;

-- ═══ 1. Raw-layer repair: recompute rent_period from the row's OWN captured source token ═══
-- Only rows where the token yields a NON-NULL period are touched: an unrecognized or absent token
-- leaves the stored value exactly as it is (this migration never retracts, only restores).
do $$
declare
  v_tbl text; v_n int; v_total int := 0;
begin
  foreach v_tbl in array array['aqaratikom_residential_listings','aqaratikom_commercial_listings'] loop
    if to_regclass('public.'||v_tbl) is not null then
      execute format($q$
        update public.%I r
           set rent_period = public.aqaratikom_period_from_token(r.additional_info->>'subtype_ar')
         where public.aqaratikom_period_from_token(r.additional_info->>'subtype_ar') is not null
           and r.rent_period is distinct from
               public.aqaratikom_period_from_token(r.additional_info->>'subtype_ar') $q$, v_tbl);
      get diagnostics v_n = row_count; v_total := v_total + v_n;
    end if;
  end loop;
  raise notice 'aqaratikom rent_period rows restored from own capture: %', v_total;
  if v_total > 60 then
    raise exception 'refusing: % rows is far beyond the audited 15-row population', v_total;
  end if;
end $$;

-- ═══ 2. Index-leg: sync_search_listings_ar() is watermark-gated on scrape recency, so a raw-layer
-- repair on rows the crawl has not re-touched does NOT propagate on its own (the exact gap
-- migration 20260811133417 was written for). Push the repaired values for aqaratikom only. ═══
do $$
declare v_tbl text; v_n int; v_total int := 0;
begin
  foreach v_tbl in array array['aqaratikom_residential_listings','aqaratikom_commercial_listings'] loop
    if to_regclass('public.'||v_tbl) is not null then
      execute format($q$
        update public.search_listings_ar s
           set rent_period_ar = case r.rent_period when 'annual' then 'سنوي'
                                                   when 'monthly' then 'شهري' else null end,
               payment_monthly = coalesce(r.rent_period = 'monthly', false)
          from public.%I r
         where s.platform = 'aqaratikom' and s.listing_id = r.id and s.deal_ar = 'إيجار'
           and r.rent_period is not null
           and s.rent_period_ar is distinct from case r.rent_period when 'annual' then 'سنوي'
                                                 when 'monthly' then 'شهري' else null end $q$, v_tbl);
      get diagnostics v_n = row_count; v_total := v_total + v_n;
    end if;
  end loop;
  raise notice 'aqaratikom index rows re-synced: %', v_total;
end $$;

-- ═══ 3. BARRIER: a stored period that contradicts the platform's OWN captured source token ═══
-- This is the defect CLASS, not today's 15 rows (§22). Distinct from
-- mon_detect_rent_period_unreachable, which counts periodless rows without asking whether the
-- source said anything: that detector cannot tell an honest NULL (source silent -- the correct,
-- protected state under the fidelity rule) from a row whose own capture states a period we dropped.
-- This one fires ONLY on internal self-contradiction, so it can never pressure anyone into
-- defaulting a period the source never published.
create or replace function public.mon_detect_rent_period_contradicts_capture()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tbl text; v_rows jsonb := '[]'::jsonb; v_part jsonb; total int := 0; n int := 0;
begin
  foreach v_tbl in array array['aqaratikom_residential_listings','aqaratikom_commercial_listings'] loop
    if to_regclass('public.'||v_tbl) is null then continue; end if;
    execute format($q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'table', %L, 'listing_id', id, 'stored', rent_period,
               'source_token', additional_info->>'subtype_ar', 'active', active)), '[]'::jsonb)
        from public.%I r
       where public.aqaratikom_period_from_token(r.additional_info->>'subtype_ar') is not null
         and r.rent_period is distinct from
             public.aqaratikom_period_from_token(r.additional_info->>'subtype_ar') $q$,
      v_tbl, v_tbl) into v_part;
    v_rows := v_rows || v_part;
  end loop;
  total := jsonb_array_length(v_rows);

  if total > 0 then
    n := public.mon_raise('P2', 'rent_period_contradicts_capture', 'aqaratikom',
      'rent_period_contradicts_capture',
      jsonb_build_object(
        'contradicting_rows', total,
        'sample', (select jsonb_agg(e) from (select e from jsonb_array_elements(v_rows) e limit 8) s),
        'why', 'The stored rent_period disagrees with the period token this row ALREADY holds in '
               'additional_info.subtype_ar, which scrapers/aqaratikom/run.py copies verbatim from '
               'the nawait.sa detail payload. Because the source token is present in our own row, '
               'this is never a source limitation -- it is data we captured and then dropped, and '
               'the row is unreachable under BOTH Filter period chips. Repair by re-running the '
               'documented mapping (public.aqaratikom_period_from_token) on the stored token '
               '(run #15, 2026-08-13). Do NOT "fix" a row that has NO subtype_ar by defaulting a '
               'period -- that is the honest-unknown case this detector deliberately ignores.'));
  else
    perform public.mon_resolve_key('rent_period_contradicts_capture', 'rent_period_contradicts_capture');
  end if;
  return n;
end $function$;

-- ═══ 4. Roster wiring by NEEDLE-EDIT of the LIVE body ═══
-- Never a hand-pasted full body: the roster has been silently lost at least four times to exactly
-- that move (20260804113911, 20260810175245, 20260810202219, repaired 20260810222259), which is why
-- scripts/verify-detector-roster-edits-are-guarded.ts forbids it. A needle-edit cannot drop entries
-- it never read. Idempotent: splices only if absent.
do $$
declare
  v_def text; v_new text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text := '''mon_detect_rent_period_contradicts_capture''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors not found'; end if;

  if position(want in v_def) > 0 then
    raise notice 'already in roster; no change';
  else
    if position(anchor in v_def) = 0 then
      raise exception 'roster anchor % not found -- refusing to guess an edit point', anchor;
    end if;
    v_new := replace(v_def, anchor, anchor || ', ' || want);
    if v_new = v_def then raise exception 'needle-edit produced no change'; end if;
    execute v_new;
    raise notice 'spliced % into the roster', want;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position(want in v_def) = 0 then
    raise exception 'post-check: detector is NOT in the roster';
  end if;
  if position(anchor in v_def) = 0 then
    raise exception 'post-check: anchor detector lost from roster';
  end if;
end $$;