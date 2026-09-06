-- A ONE-SHOT REPAIR WITHOUT A FORWARD FIX RE-BREAKS ON EVERY CRAWL, AND NOTHING WAS WATCHING.
--
-- Migration 20260809151000 (`wasalt_meters_repaired_from_source`) parsed waterMeter /
-- electricityMeter out of wasalt's own additional_info payload into separate_water_meter /
-- separate_electricity_meter. It is registered in ops_repair_guarantee_registry with the invariant
-- "wasalt area in metres matches the source" and — this is the defect — a NULL detector column.
--
-- Re-verified against production 2026-09-04 by routine #7's oldest-first rotation. The rows the
-- repair actually touched still hold. But 8,284 rows (8,218 of them ACTIVE) now publish
-- waterMeter/electricityMeter as 'Yes'/'No' in additional_info while the parsed boolean is NULL,
-- and the split is total:
--
--   scraped BEFORE the repair (2026-08-09): 0
--   scraped AFTER  the repair:          8,284   (2026-08-09 .. 2026-09-04)
--
-- Zero before, all after. So the one-shot UPDATE held perfectly and the PRODUCING path never
-- learned to do the same thing — every crawl since has re-created the defect, accumulating for 26
-- days with no alert, because no detector was ever pointed at this invariant. That is the
-- orphaned-guarantee class exactly: not a repair that reverted, but a repair that was never made
-- durable, invisible because the registry row named no watcher.
--
-- SCOPE. This detector makes the gap VISIBLE and keeps it visible; it deliberately does NOT write a
-- single listing row. Fixing the wasalt enrichment so new rows parse these keys is the producing
-- path's own defect and belongs to the scraper/enrichment owner — this is the barrier, not the
-- repair. Do NOT clear this alert with another one-shot UPDATE: that would reproduce the exact
-- shape being reported here.
--
-- COST. Measured on the live table before installing: 778 ms, 31,734 shared buffer hits, no
-- sequential scan (bitmap index scan on the `active` predicate). That matters because the twice-
-- hourly sweep aborted twice on 2026-09-04 at its 900 s statement_timeout; 0.78 s is ~0.26% of a
-- typical sweep and does not move that number meaningfully.
create or replace function public.mon_detect_wasalt_meter_parse_gap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gap        bigint;
  v_after      bigint;
  n            int := 0;
begin
  select count(*),
         count(*) filter (where w.scraped_at >= timestamptz '2026-08-09')
    into v_gap, v_after
    from public.wasalt_residential_listings w
   where w.active
     and jsonb_typeof(w.additional_info) = 'array'
     and (
       ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
          where elem->>'key' = 'waterMeter' limit 1) in ('Yes','No')
        and w.separate_water_meter is null)
       or
       ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
          where elem->>'key' = 'electricityMeter' limit 1) in ('Yes','No')
        and w.separate_electricity_meter is null));

  if v_gap > 0 then
    n := n + public.mon_raise('P2', 'repair_guarantee', 'wasalt', 'wasalt_meter_parse_gap',
      jsonb_build_object(
        'active_rows_with_gap', v_gap,
        'scraped_since_the_repair', v_after,
        'repair', '20260809151000_wasalt_meters_repaired_from_source',
        'why', 'wasalt publishes waterMeter/electricityMeter as Yes/No inside additional_info on '
            || 'these ACTIVE rows, but separate_water_meter / separate_electricity_meter are NULL. '
            || 'Migration 20260809151000 repaired exactly this for the rows that existed on '
            || '2026-08-09; the producing path was never changed, so every crawl since has '
            || 're-created the defect. A one-shot repair with no forward fix is a guarantee that '
            || 'decays by design.',
        'action', 'Fix the wasalt enrichment/parse so newly written rows carry these columns from '
            || 'the same additional_info keys the repair read. Then, and only then, backfill the '
            || 'standing rows from THEIR OWN payload.',
        'do_not', 'Do NOT clear this with another one-shot UPDATE and no producing-path fix — that '
            || 'is what created this alert. Do NOT infer a value the payload does not publish: '
            || 'only Yes/No are read, anything else stays NULL.'));
  else
    perform public.mon_resolve_key('repair_guarantee', 'wasalt_meter_parse_gap');
  end if;
  return n;
end
$function$;

comment on function public.mon_detect_wasalt_meter_parse_gap() is
'Raises while ACTIVE wasalt rows publish waterMeter/electricityMeter (Yes/No) in additional_info but '
'the parsed separate_*_meter column is NULL — i.e. the invariant repaired by 20260809151000 is being '
're-broken by the producing path. Found by routine #7''s repair-guarantee rotation 2026-09-04: 8,284 '
'rows, ALL of them scraped after the repair and none before. Reads only what wasalt already sent us; '
'never writes a listing row.';

-- ── roster entry, in the SAME migration (a detector nothing reaches is decoration) ───────────────
do $roster$
declare
  src    text := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  anchor text := '''mon_detect_repair_guarantee_stale''';
begin
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'roster anchor not found exactly once in mon_run_all_detectors()';
  end if;
  if position('mon_detect_wasalt_meter_parse_gap' in src) > 0 then
    raise exception 'mon_run_all_detectors() already lists the detector - refusing to double-apply';
  end if;
  execute replace(src, anchor, anchor || ', ''mon_detect_wasalt_meter_parse_gap''');
end
$roster$;

-- ── the registry row stops being unwatched ───────────────────────────────────────────────────────
update public.ops_repair_guarantee_registry
   set detector = 'mon_detect_wasalt_meter_parse_gap'
 where repair_version = '20260809151000';

-- ── self-assertions: prove reachability AND that the detector actually fires on today's state ────
do $assert$
declare v_raised int; v_listed boolean; v_detector text;
begin
  select position('mon_detect_wasalt_meter_parse_gap' in
                  pg_get_functiondef('public.mon_run_all_detectors'::regproc)) > 0
    into v_listed;
  if not v_listed then
    raise exception 'detector is not reachable from the mon_run_all_detectors roster';
  end if;

  select detector into v_detector
    from public.ops_repair_guarantee_registry where repair_version = '20260809151000';
  if v_detector is distinct from 'mon_detect_wasalt_meter_parse_gap' then
    raise exception 'registry row was not pointed at the detector (got %)', v_detector;
  end if;

  -- EXECUTED proof, not a source claim: the condition is live today, so the detector must raise.
  select public.mon_detect_wasalt_meter_parse_gap() into v_raised;
  if v_raised < 1 then
    raise exception 'detector did not raise on a state measured to contain 8,218 active gap rows';
  end if;
end
$assert$;
