-- A crawl that cannot reach part of its catalogue must not read as a healthy crawl.
--
-- gathern's rows_seen fell ~3x on 2026-09-01 and stayed flat (18,850 -> ~6,900/day). Every run kept
-- reporting ok=true, because fetch_page() returned the same bare `[], {}` for "HTTP 200, zero items"
-- and "the source declined to answer", and crawl() recorded a declined city as «no monthly units».
-- Instrumenting that distinction (PRs #1644, #1650) produced the answer on the first run:
--
--   city_fail_reasons=http_400:7 / :8 / :6 / :7 / :6 / :2   (~36 city fetches per crawl)
--
-- HTTP 400 — not 429, not 403. The search API is REJECTING our request for a deterministic subset
-- of cities, which is why the post-09-01 numbers are flat to within +/-40 rather than ragged the way
-- throttling would be. That is an Ezhalah-side defect in the request, and it silently cost coverage
-- for days.
--
-- This detector exists so the NEXT one cannot be silent. It reads what the crawl now records about
-- its own coverage rather than re-deriving anything, and it deliberately does NOT touch deletion
-- safety: it neither prunes, restores, nor infers a single listing. It only says the crawl could not
-- see everything it was asked to see.
create or replace function public.mon_detect_gathern_city_coverage_gap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_runs bigint; v_failed bigint; v_incomplete bigint; v_reasons text;
  n int := 0;
  live_keys text[] := '{}';
begin
  select count(*),
         coalesce(sum((regexp_match(notes, 'city_failed=(\d+)'))[1]::bigint), 0),
         coalesce(sum((regexp_match(notes, 'city_incomplete=(\d+)'))[1]::bigint), 0),
         string_agg(distinct (regexp_match(notes, 'city_fail_reasons=(\S+)'))[1], ' | ')
    into v_runs, v_failed, v_incomplete, v_reasons
    from public.scrape_runs
   where platform = 'gathern'
     and started_at > now() - interval '24 hours'
     and notes like '%city_failed=%';

  if v_runs > 0 and (v_failed > 0 or v_incomplete > 0) then
    live_keys := array['gathern_city_coverage_gap'];
    n := n + public.mon_raise('P1', 'gathern_city_coverage_gap', 'gathern',
      'gathern_city_coverage_gap',
      jsonb_build_object(
        'runs_24h', v_runs,
        'cities_failed', v_failed,
        'cities_incomplete', v_incomplete,
        'reasons', coalesce(v_reasons, 'not recorded'),
        'why', 'gathern crawl runs reported ok=true while failing to fetch part of their city list. '
            || 'A city the source REFUSED to answer for used to be recorded as a city with no '
            || 'monthly units, so coverage shrank silently and every count-based barrier stayed '
            || 'green — the counts it compares were themselves the truncated ones.',
        'adjudicate', 'Read the reasons. http_4xx (esp. 400) means OUR REQUEST is malformed for '
            || 'those cities — an Ezhalah defect in the search parameters or the city list, and the '
            || 'deterministic kind, which is why the row counts go flat rather than ragged. '
            || '"exhausted" or 429 means the source throttled us: pacing and shard parallelism are '
            || 'ours to fix. 403 means blocked; escalate rather than retry. Do NOT respond by '
            || 'pruning, restoring, or inferring any listing — an incomplete crawl is a reason to '
            || 'DISTRUST absence, never to act on it.'));
  end if;

  -- Resolve on the EVALUATED path from the keys this run re-affirmed (§25a).
  perform public.mon_resolve_stale_keys('gathern_city_coverage_gap', live_keys);
  return n;
end
$function$;

comment on function public.mon_detect_gathern_city_coverage_gap() is
'Raises while gathern crawl runs report city_failed/city_incomplete > 0 in the last 24h — i.e. the '
'crawl could not reach part of its own city list while still reporting ok=true. Reads only what the '
'crawl records about itself (scrape_runs.notes, written by scrapers/gathern/run.py); never prunes, '
'restores or infers a listing. Found live 2026-09-03: ~36 city fetches per crawl failing http_400, '
'the deterministic rejection behind the 2026-09-01 3x rows_seen drop.';

do $roster$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to leave the detector unrostered';
  end if;
  if position('mon_detect_gathern_city_coverage_gap' in src) > 0 then
    return;
  end if;
  if position('''mon_detect_gathern_liveness_evidence_gap''' in src) = 0 then
    raise exception 'roster anchor not found - refusing to guess where to append';
  end if;
  newsrc := replace(src,
    '''mon_detect_gathern_liveness_evidence_gap''',
    '''mon_detect_gathern_liveness_evidence_gap'', ''mon_detect_gathern_city_coverage_gap''');
  execute newsrc;
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_gathern_city_coverage_gap' in src) = 0 then
    raise exception 'roster append did not take effect';
  end if;
end
$roster$;;