-- Data Integrity Engineer run #16 (2026-08-13).
--
-- Invariant: every row in search_listings_ar must be reachable by AT LEAST ONE Normal Filter
-- combination. location_search_candidates_ar admits a row via exactly two branches:
--   (a) s.production_ready, or
--   (b) the unlocated fallback, which REQUIRES (s.region_id is null or s.city_id is null).
-- A row that is production_ready=false while carrying BOTH region_id and city_id therefore
-- satisfies neither branch and is retrievable by no filter at all — it sits in the index and
-- counts as "searchable" in every count-parity check while no user can ever reach it
-- (186,160 canonical active = 186,160 index rows, but the unfiltered RPC returns 186,136).
-- Same shape as §22's rent-period cohort and §11a's decorative barriers.
--
-- The 24 rows in this state on 2026-08-13 are ALL price_size_impossible (trg_price_size_sanity
-- downgrades production_ready), which is the already-open price_gate_withheld P2 and the owner
-- decision already sitting in PR #410 — not a new defect. PR #410's recalibration IS live
-- (area > 50,000,000), so these are per-meter-clause (> 5,000,000 SAR/m²) or > 50B SAR absolute
-- hits, not the large-land false positives it fixed. Alerting on them daily would make this
-- detector red forever, and a barrier that is always red carries no information (run #8's
-- lesson). So the gate cohort is excluded and this fires only on a NEW cause.
create or replace function public.mon_detect_orphaned_search_row()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; cnt int; sample jsonb;
begin
  select count(*) into cnt
    from public.search_listings_ar s
   where not s.production_ready
     and s.region_id is not null
     and s.city_id  is not null
     and not public.price_size_impossible(s.price_total, s.price_annual, s.area_m2);

  if coalesce(cnt, 0) > 0 then
    select jsonb_agg(x) into sample from (
      select s.source_table, s.listing_id, s.platform, s.city_ar, s.deal_ar, s.type_ar
        from public.search_listings_ar s
       where not s.production_ready
         and s.region_id is not null
         and s.city_id  is not null
         and not public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
       order by s.source_table, s.listing_id
       limit 20) x;

    n := public.mon_raise('P1', 'orphaned_search_row', 'all', 'orphaned_search_row',
      jsonb_build_object(
        'count', cnt,
        'sample', sample,
        'why', 'Rows in search_listings_ar with a COMPLETE canonical location (region_id and city_id both set) but production_ready=false. They fail both branches of location_search_candidates_ar — the unlocated fallback admits only rows whose region_id or city_id IS NULL — so NO filter combination returns them, yet they still count as searchable in table-vs-index parity. The price/size-gate cohort is deliberately excluded from this count, so a non-zero value here is a NEW cause. Find why production_ready was cleared on a fully located row; do NOT fix it by flipping production_ready without establishing that cause.'));
  else
    perform public.mon_resolve_key('orphaned_search_row', 'orphaned_search_row');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_orphaned_search_row() is
'Data Integrity run #16 (2026-08-13). Asserts every search_listings_ar row is reachable by at least one Normal Filter path. Excludes the price_size_impossible cohort (24 rows on 2026-08-13, already tracked by price_gate_withheld / location_pipeline_monitor and pending an owner decision in PR #410) so the detector stays green and fires only on a new cause.';

-- §11a: a barrier nothing calls is decoration — the roster entry lands in the SAME migration.
--
-- GUARDED NEEDLE-EDIT, never a pasted body. The first form of this migration pasted a full
-- CREATE OR REPLACE of mon_run_all_detectors() captured minutes earlier, and
-- verify-detector-roster-edits-are-guarded correctly failed it in CI. That guard exists because
-- this exact class has now happened three times (see
-- 20260810222259_restore_roster_detectors_dropped_by_stale_rebuild.sql): a hand-copied body
-- silently reverts the roster to whatever the copy predates, dropping detectors added by a
-- concurrent session in between — a real hazard in this shared repo, and one a "verified this
-- session" comment does not prevent. An edit that never reads the other entries cannot lose them.
--
-- Idempotent: inserts only when absent, so replaying against a database that already carries the
-- entry (as production does — this migration's first form applied at 20260813072652) is a no-op
-- and reaches the identical end state.
do $$
declare
  v_def text;
  v_before text;
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
  fn     constant text := 'mon_detect_orphaned_search_row';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then
    raise exception 'mon_run_all_detectors is missing';
  end if;
  v_before := v_def;

  -- Anchor on a long-standing roster entry so the insert always lands inside the array literal.
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def <> v_before then
    execute v_def;
  end if;

  -- Prove the entry is reachable from the roster, else this barrier is decoration.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''' || fn || '''' in v_def) = 0 then
    raise exception 'SELFTEST: % is not reachable from mon_run_all_detectors()', fn;
  end if;

  -- The needle-edit must not have cost any pre-existing entry.
  if (select count(*) from regexp_matches(v_def, '''mon_detect_\w+''', 'g')) < 46 then
    raise exception 'SELFTEST: roster shrank — refusing to leave detectors dropped';
  end if;
end $$;
