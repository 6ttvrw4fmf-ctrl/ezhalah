-- A listing the SOURCE returns 404 for must not stay in search. Nothing was watching that.
--
-- FOUND 2026-08-12 (Data Integrity run #14, follow-up). gathern's liveness sweep has re-fetched the
-- real listing URL on three consecutive days and classified ~1,130 units DEAD (hard 404) each time:
--
--   08-10  APPLY scanned=3000 dead=1130 inactivated=0 strike=1130 alive=1870
--   08-11  APPLY scanned=1500 dead=1134 inactivated=0 strike=1134 alive=366
--   08-12  ANOMALY-CAPPED would_inactivate=1109 cap=150 — 0 rows inactivated; owner review required
--
-- The rows reached the 3-strike grace on 08-12 and the kill cap (150) correctly refused to action
-- 1,109 of them in one sweep. That refusal is RIGHT — it is the mass-deletion guard doing its job,
-- and it must not be loosened to get past it. But the consequence went unwatched: **1,107 listings
-- whose source returns 404 are production_ready and being served to real users right now**, and no
-- alert anywhere names that. The existing gathern alerts are about other things entirely
-- (stale_listings_detected is an explicitly report-only time-based path, quarantine_growth,
-- field_integrity). mon_detect_silent_scraper_death cannot see it either: it needs three
-- consecutive BAD runs and 08-10/08-11 both reported ok=true.
--
-- So the gap is not the cap. The gap is that a capped/deadlocked liveness sweep is indistinguishable
-- from a healthy one at the monitoring layer, which is the same failure shape as §11a (a barrier
-- nothing calls) and the 2026-08-10 lesson that an all-zero sweep can sit on top of standing state.
--
-- WHAT THIS DETECTS is a structural invariant, not a log string: an ACTIVE row that has accumulated
-- the full 3-strike grace AND has not been seen for 3+ days. Parsing scrape_runs.notes for
-- "ANOMALY-CAPPED" would only work for the one platform that happens to print it; this predicate
-- holds for every platform and every deletion path (liveness, prune_unseen, cleanup.py), so a future
-- deadlock in any of them raises here too. Measured at wiring time: gathern 1,109 (1,107 served) and
-- **exactly 0 on all 66 other listing tables**, so this is a real signal, not a noisy one.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it does not inactivate anything, and its alert text must never
-- be read as "raise the cap". Actioning ~1,109 listings is a bulk listing operation and an owner
-- decision (AGENTS.md RED list). The detector's job is to make sure that decision is never again
-- waiting three days without anyone being told.

-- ── 1. the view: every listing table, residential AND commercial (§20) ─────────────────────────
create or replace view public.mon_served_after_source_gone as
  select tbl as source_table,
         split_part(tbl, '_', 1) as platform,
         struck_active,
         still_served
  from (
    select t.tbl,
      (xpath('/row/a/text()', query_to_xml(format(
        'select count(*) a from public.%I where active and coalesce(missing_count,0) >= 3 '
        'and last_seen_at < now() - interval ''3 days''', t.tbl), false, true, '')))[1]::text::bigint
        as struck_active,
      (xpath('/row/a/text()', query_to_xml(format(
        'select count(*) a from public.%I c join public.search_listings_ar s '
        '  on s.source_table = %L and s.listing_id = c.id '
        ' where c.active and coalesce(c.missing_count,0) >= 3 '
        '   and c.last_seen_at < now() - interval ''3 days'' and s.production_ready',
        t.tbl, t.tbl), false, true, '')))[1]::text::bigint
        as still_served
    from (
      select c.relname as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname ~ '_(residential|commercial)_listings$'
    ) t
  ) z
  where struck_active > 0;

comment on view public.mon_served_after_source_gone is
  'Rows the source has already been proven to have dropped — full 3-strike grace accumulated AND '
  'unseen for 3+ days — that are STILL active, with how many of them are still production_ready and '
  'therefore reachable by real users. Structural, not log-parsing: it holds for every platform and '
  'every deletion path (liveness, prune_unseen, cleanup.py), so a deadlock in any of them shows here. '
  'Baseline at creation 2026-08-12: gathern 1,109 struck / 1,107 served, 0 on all 66 other tables.';

-- ── 2. the detector ───────────────────────────────────────────────────────────────────────────
create or replace function public.mon_detect_served_after_source_confirmed_gone()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  seen text[] := array[]::text[];
begin
  for r in select * from public.mon_served_after_source_gone order by still_served desc loop
    seen := seen || r.source_table;
    n := n + public.mon_raise(
      case when r.still_served > 0 then 'P1' else 'P2' end,
      'served_after_source_gone', r.platform,
      'served_after_source_gone:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'struck_active', r.struck_active,
        'still_served', r.still_served,
        'why', 'These rows carry the FULL strike grace and have not been seen for 3+ days, yet they '
               'are still active and ' || r.still_served || ' of them are production_ready — real '
               'users can find and click a listing the source no longer serves. Something in the '
               'deletion path stopped draining: a liveness kill-cap/anomaly gate refusing the batch, '
               'a prune circuit breaker, or a disabled cleanup policy. DIAGNOSE THAT — do NOT loosen '
               'the cap to clear the backlog. Actioning a batch this size is a bulk listing '
               'operation and an owner decision (AGENTS.md RED list); the guard refusing it is '
               'working as designed. This alert exists so that decision is never again pending for '
               'days with nobody told.'));
  end loop;

  perform public.mon_resolve_key('served_after_source_gone', 'served_after_source_gone:' || t.relname)
    from pg_class t join pg_namespace ns on ns.oid = t.relnamespace
   where ns.nspname = 'public' and t.relkind = 'r'
     and t.relname ~ '_(residential|commercial)_listings$'
     and not (t.relname = any(seen));

  return n;
end $function$;

comment on function public.mon_detect_served_after_source_confirmed_gone() is
  'Wired 2026-08-12 (Data Integrity run #14). gathern''s liveness sweep classified ~1,130 units dead '
  '(hard 404) on three consecutive days and inactivated 0; on the third the kill cap correctly '
  'refused 1,109 at once. The refusal was right — the gap was that nobody was told, so 1,107 '
  'source-404 listings stayed searchable for three days. Detects the structural invariant (full '
  'strike grace + unseen 3+ days + still active) rather than a log string, so it covers every '
  'platform and every deletion path. Never inactivates anything; the backlog decision is the '
  'owner''s.';

-- ── 3. roster wiring — needle-edit off the LIVE body, same migration (§11a) ───────────────────
do $$
declare
  v_def text;
  v_before text;
  fn constant text := 'mon_detect_served_after_source_confirmed_gone';
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

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'roster already carries %', fn;
    return;
  end if;
  execute v_def;
end $$;

-- ── 4. self-tests ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_gathern bigint;
  v_served bigint;
  v_others int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_served_after_source_confirmed_gone' in v_def) = 0 then
    raise exception 'SELFTEST FAILED: detector is not in the roster — it would be orphaned';
  end if;

  -- The condition this was built for must actually be visible to it. If this is 0, either the
  -- backlog drained (good — then the detector self-resolves) or the predicate no longer matches
  -- reality and the barrier is inert. Either way a human should know which.
  select struck_active, still_served into v_gathern, v_served
    from public.mon_served_after_source_gone where source_table = 'gathern_residential_listings';
  if v_gathern is null then
    raise notice 'SELFTEST NOTE: gathern backlog no longer matches the predicate (drained or changed)';
  elsif v_gathern < 100 then
    raise exception 'SELFTEST FAILED: gathern shows only % struck rows; predicate looks wrong', v_gathern;
  else
    raise notice 'SELFTEST: gathern % struck / % served — the barrier can see the condition', v_gathern, v_served;
  end if;

  -- It must not be a blanket alarm: no other table should qualify today.
  select count(*) into v_others from public.mon_served_after_source_gone
   where source_table <> 'gathern_residential_listings';
  if v_others > 0 then
    raise notice 'SELFTEST NOTE: % other table(s) also qualify — investigate each', v_others;
  end if;

  raise notice 'SELFTESTS PASSED: roster-wired, predicate matches the observed condition';
end $$;