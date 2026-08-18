-- Data Integrity run #29 (2026-08-18): 15 of 16 alert-suppressing waivers have no recorded probe.
--
-- Owner permanent rule #2 (2026-08-13, docs/ops/ENGINEER_ROUTINES.md): "A missing captured field is
-- NOT evidence that the source omits it — a failed fetch looks identical. Re-fetch the source and
-- record the probe (ops_rent_period_source_probe) before calling anything a source limitation; any
-- alert-suppressing waiver must be FK-gated to that probe and re-checked by a detector."
--
-- ops_rent_period_sourceless is exactly such a waiver: mon_detect_rent_period_unreachable()
-- excludes every platform listed there. Today it lists 16 platforms and suppresses 293 priced Rent
-- listings that neither period chip can reach. Only **aqar** carries the evidence the rule demands —
-- run #22's live re-probe, 63/63 HTTP 200, per-row rows in ops_rent_period_source_probe. The other
-- 15 rows all read "audit 2026-08-11", i.e. they were decided from inspection BEFORE the owner rule
-- existed, and nothing re-checks them:
--
--   raghdan 128 · alkhaas 20 · eastabha 17 · mizlaj 7 · hajer 6 · ramzalqasim 3 · souq24 1 · jurash 1
--   (+ abeea, aldarim, alhoshan, dealapp, eaqartabuk, mustqr, sadin — currently 0 rows each)
--
-- Run #15 made this exact mistake on aqaratikom: 13 rows called a source limitation on ABSENCE
-- alone, and the source published «سنوي» on all 13.
--
-- What this migration does NOT do, deliberately:
--   * it does not delete the waivers — that would flood a P2 with 184 rows and establishes no truth;
--   * it does not import a period from anywhere — that is how «سنوي» gets fabricated (§22.1);
--   * it does not decide the product question of how period-less rentals should surface (§22, owner).
-- It makes an invisible policy violation VISIBLE and re-checked, which is precisely the "re-checked
-- by a detector" half of the owner's rule. Clearing it requires a real probe per platform, recorded
-- in ops_rent_period_source_probe — the same bar aqar already met.

create or replace function public.mon_detect_unprobed_source_waiver()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  total int := 0;
  rows_json jsonb;
begin
  select coalesce(jsonb_agg(x order by x->>'suppressed_rows' desc), '[]'::jsonb), count(*)
    into rows_json, total
  from (
    select jsonb_build_object(
             'platform', w.platform,
             'reason', left(w.reason, 160),
             'decided_at', w.decided_at,
             'suppressed_rows', (
               select count(*) from public.search_listings_ar s
                where s.platform = w.platform
                  and s.deal_ar = 'إيجار'
                  and (s.price_annual is not null or s.price_total is not null)
                  and (s.rent_period_ar is null or s.rent_period_ar not in ('سنوي','شهري')))
           ) as x
      from public.ops_rent_period_sourceless w
     where not exists (
       select 1 from public.ops_rent_period_source_probe p
        where p.source_table like w.platform || '\_%'
          and p.http_status = 200)
  ) q;

  if total > 0 then
    n := public.mon_raise('P2', 'unprobed_source_waiver', 'all', 'unprobed_source_waiver',
      jsonb_build_object(
        'unprobed_waivers', total,
        'waivers', rows_json,
        'why', 'These platforms are waived out of mon_detect_rent_period_unreachable() - their priced '
               'Rent listings with no period are excluded from that barrier entirely - on the strength '
               'of a reason string alone. Owner permanent rule #2 (2026-08-13) requires an '
               'alert-suppressing waiver to be backed by a recorded HTTP-200 probe in '
               'ops_rent_period_source_probe, because a failed fetch and a source that publishes '
               'nothing look identical in our database. aqar is the worked example of the bar: run #22 '
               're-fetched 63/63 live and recorded every row.',
        'do_not', 'Do NOT clear this by deleting the waivers (that floods a barrier with rows nobody '
                  'has adjudicated) and do NOT clear it by importing a period from a field that merely '
                  'looks right - aqar''s own payload carries a rent_period_text that reads «سنوي» on '
                  'genuinely monthly ads (§22.1). Clear it by probing the source and recording the '
                  'result, one platform at a time.'));
  else
    perform public.mon_resolve_key('unprobed_source_waiver', 'unprobed_source_waiver');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_unprobed_source_waiver() is
  'P2. A platform waived out of mon_detect_rent_period_unreachable() by ops_rent_period_sourceless '
  'with no HTTP-200 probe recorded in ops_rent_period_source_probe. Added by Data Integrity run #29: '
  '15 of 16 waivers were decided by inspection on 2026-08-11, before owner permanent rule #2 '
  '(2026-08-13) required probe-backed, detector-re-checked waivers, and between them they suppress '
  '184 priced Rent listings reachable by neither period chip. aqar is the one that meets the bar '
  '(run #22, 63/63 live HTTP 200). Clearing this needs evidence, not deletion - run #15 called 13 '
  'aqaratikom rows a source limitation on absence alone and the source published «سنوي» on all 13.';

-- Roster wiring, in the SAME migration. Guarded needle-edit, never a re-pasted body.
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_unprobed_source_waiver''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then raise exception 'mon_run_all_detectors not found - refusing to wire blindly'; end if;
  if position('mon_detect_unprobed_source_waiver' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install', before_n, after_n;
  end if;
  if position('mon_detect_unprobed_source_waiver' in src) = 0
     or position('mon_detect_rent_period_unreachable' in src) = 0
     or position('mon_detect_english_overlay_stranded_city' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;
