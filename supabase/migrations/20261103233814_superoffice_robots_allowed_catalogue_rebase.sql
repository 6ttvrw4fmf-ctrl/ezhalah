-- SUPEROFFICE: THE ROBOTS-ALLOWED SET IS ITS CATALOGUE (owner decision 4, 2026-11-03: «Yes, use your picks» —
-- respect robots.txt, do NOT read /api/office-listing, keep the robots-allowed offices).
--
-- rows_collapse:superoffice (alert 12219) and silent_partial_success:superoffice (12556) compared every run since
-- the site's 2026-10-28 rebuild (24 offices: 8 server-rendered per branch × al-aarid, as-suwaidi, al-rawdah) with
-- the OLD Laravel site's history (184 a run). The rest of each branch list loads from /api/office-listing, which
-- https://superoffice.sa/robots.txt disallows (`Disallow: /api`, re-read 2026-11-03), and the robots-allowed
-- /sitemap/units.xml is empty. So 24 is not a partial crawl — it is the whole catalogue Ezhalah may read.
--
-- A PLATFORM-SCOPED catalogue rebase, never a fleet-wide floor change: ops_platform_catalogue_rebase records the
-- moment a platform's readable catalogue changed shape, the run size now expected, the reason and a pointer to the
-- rule (robots.txt). Both crawl-health detectors ignore that platform's runs from BEFORE the rebase, and
-- silent_partial_success also holds a rebased platform to its declared size from the first run (a run under half
-- of it raises, mode 'declared_catalogue'), so a real future collapse still alarms before the new history is long
-- enough to have a median. rows_collapse keeps its fleet floor (3-day p90 ≥ 300): a 24-a-run site sits below it,
-- and silent_partial_success is its watch. Every other platform is untouched (no row → no change).

create table if not exists public.ops_platform_catalogue_rebase (
  platform              text primary key,
  rebased_at            timestamptz not null,
  expected_rows_per_run integer     not null check (expected_rows_per_run > 0),
  reason                text        not null check (length(reason) >= 40),
  source_rule_url       text        not null check (source_rule_url ~ '^https://'),
  evidence              jsonb       not null,
  decided_by            text        not null,
  created_at            timestamptz not null default now()
);
comment on table public.ops_platform_catalogue_rebase is
  'A platform whose readable catalogue changed shape on purpose (site rebuild + a source rule such as robots.txt). '
  'Crawl-health detectors (rows_collapse, silent_partial_success) judge its runs only from rebased_at, against '
  'expected_rows_per_run. One row per platform, with the evidence — never a fleet-wide threshold change.';
alter table public.ops_platform_catalogue_rebase enable row level security;
revoke all on public.ops_platform_catalogue_rebase from anon, authenticated;

insert into public.ops_platform_catalogue_rebase
  (platform, rebased_at, expected_rows_per_run, reason, source_rule_url, evidence, decided_by)
values ('superoffice', '2026-10-29 20:00:00+00', 24,
  'superoffice.sa was rebuilt on Next.js (2026-10-28): each branch private-office page server-renders 8 offices '
  || 'and the rest load from /api/office-listing, which robots.txt disallows. The owner chose to respect robots.txt, '
  || 'so the 24 robots-allowed offices are the complete expected catalogue; the old site''s 184-a-run history is '
  || 'not a baseline for it.',
  'https://superoffice.sa/robots.txt',
  jsonb_build_object(
    'robots_txt_2026_11_03', 'User-Agent: * / Allow: / / Disallow: /admin / Disallow: /api',
    'disallowed_path', '/api/office-listing?service=private-office&offset=N&limit=8',
    'units_sitemap_2026_11_03', 'https://superoffice.sa/sitemap/units.xml is an empty <urlset>',
    'branch_windows_2026_11_03', jsonb_build_object('al-aarid', '8 of 18', 'as-suwaidi', '8 of 56', 'al-rawdah', '8 of 170'),
    'window_per_branch', 8,
    'runs_since_rebuild', '2026-10-29 20:40 → 2026-11-03 06:51: every ok run rows_seen = 24',
    'old_site_rows_per_run', 184,
    'alerts', jsonb_build_array(12219, 12556),
    'scraper', 'scrapers/superoffice/run.py: window_is_whole() blocks pruning on a truncated window; robots_disallows_api() re-read every run'),
  'owner 2026-11-03 («Yes, use your picks», decision 4)')
on conflict (platform) do nothing;

-- silent_partial_success candidates: everything from 20261103052107 is kept; a rebased platform's pre-rebase runs
-- leave the baseline, and its declared size is a floor from the first run.
create or replace function public.mon_silent_partial_success_candidates(p_runs jsonb default null)
returns table(platform text, worst numeric, short_runs bigint, median_rows numeric, mode text)
language sql stable
set search_path to 'public'
as $function$
  with runs as (
    select s.platform, s.started_at, s.ok, s.rows_seen
      from public.scrape_runs s
     where p_runs is null and s.started_at >= now() - interval '18 days'
    union all
    select x.platform, x.started_at, x.ok, x.rows_seen
      from jsonb_to_recordset(coalesce(p_runs, '[]'::jsonb))
           as x(platform text, started_at timestamptz, ok boolean, rows_seen int)
     where p_runs is not null
  ), cap as (
    select r.platform, r.started_at, r.rows_seen,
           floor(extract(epoch from (now() - r.started_at)) / 86400)::int as day_ago,
           -- bday: the label's day counted back from its OWN latest run, so a once-a-day batch that is
           -- still running (or ran a few minutes later than yesterday) is never split across two days.
           floor(extract(epoch from (max(r.started_at) over (partition by r.platform) - r.started_at)) / 86400)::int as bday
      from runs r
      left join public.ops_platform_catalogue_rebase cr on cr.platform = r.platform
     where r.ok is true and r.rows_seen > 0
       and r.started_at >= now() - interval '18 days'
       and r.platform not like '%liveness%'
       and r.platform not like 'cleanup:%'
       -- an enrichment label's rows_seen is its PENDING QUEUE (wasalt_enrich_ar_*: 3,436 during the 11-01
       -- backfill, 99 on a normal night), never a captured catalogue, and it never feeds prune_unseen().
       and r.platform not like '%\_enrich\_%'
       -- a platform whose readable catalogue changed shape on purpose is judged only from that moment
       -- (ops_platform_catalogue_rebase: superoffice, robots.txt, owner 2026-11-03)
       and (cr.rebased_at is null or r.started_at >= cr.rebased_at)
  ), daily as (
    select c.platform, c.bday, sum(c.rows_seen)::numeric as total, count(*) as runs
      from cap c group by c.platform, c.bday
  ), base_day as (
    select d.platform,
           percentile_cont(0.25) within group (order by d.total)::numeric as p25_total,
           percentile_cont(0.5) within group (order by d.runs) as median_runs
      from daily d where d.bday >= 1
     group by d.platform having count(*) >= 5
  ), base_run as (
    select c.platform, percentile_cont(0.5) within group (order by c.rows_seen)::numeric as median_rows
      from cap c where c.day_ago >= 1
     group by c.platform having count(*) >= 5
  ), sliced as (
    select d.platform, d.total as worst, d.runs as short_runs, b.p25_total as median_rows, 'sliced_day_total'::text as mode
      from daily d join base_day b on b.platform = d.platform
     where d.bday = 0 and b.median_runs >= 3
       and d.total < 0.50 * b.p25_total
  ), single as (
    select c.platform, min(c.rows_seen)::numeric as worst, count(*) as short_runs, br.median_rows, 'per_run'::text as mode
      from cap c join base_run br on br.platform = c.platform
     where c.day_ago = 0
       and c.rows_seen < 0.50 * br.median_rows
       and not exists (select 1 from base_day b where b.platform = c.platform and b.median_runs >= 3)
     group by c.platform, br.median_rows
  ), declared as (
    -- a rebased platform is held to its DECLARED size from its first run, before it has a median
    select c.platform, min(c.rows_seen)::numeric as worst, count(*) as short_runs,
           cr.expected_rows_per_run::numeric as median_rows, 'declared_catalogue'::text as mode
      from cap c join public.ops_platform_catalogue_rebase cr on cr.platform = c.platform
     where c.day_ago = 0
       and c.rows_seen < 0.50 * cr.expected_rows_per_run
       and not exists (select 1 from sliced s where s.platform = c.platform)
       and not exists (select 1 from single s where s.platform = c.platform)
     group by c.platform, cr.expected_rows_per_run
  )
  select * from sliced
  union all
  select * from single
  union all
  select * from declared
$function$;

-- Check block: both directions, on synthetic runs (nothing is written).
do $check$
declare j jsonb; hits text[];
begin
  select jsonb_agg(x) into j from (
    -- (a) the wasalt-enum collapse: 34 shards a day of ~5,000 rows for 17 days, today 34 shards of ~3 → MUST fire
    select '__chk_enum'::text as platform, now() - (d || ' days')::interval - (s || ' minutes')::interval as started_at,
           true as ok, case when d = 0 then 3 else 5000 end as rows_seen
      from generate_series(0, 16) d, generate_series(1, 34) s
    union all
    -- (b) a sliced crawler with uneven slices (1..300) and a normal day → must NOT fire
    select '__chk_slices', now() - (d || ' days')::interval - (s || ' minutes')::interval, true, 1 + (s * 37 % 300)
      from generate_series(0, 16) d, generate_series(1, 34) s
    union all
    -- (c) a once-a-day crawler that read 40 instead of ~1,000 → MUST fire (per-run path unchanged)
    select '__chk_single', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 40 else 1000 end
      from generate_series(0, 16) d
    union all
    -- (e) gathern's shape (⚡ 2026-11-03, alert 12814): ONE batch of 12 slices a day, today's batch still
    -- running (2 slices so far) and yesterday's batch a few minutes later than today's. A rolling now()-24h
    -- window split it (5,200 of 15,600) → must NOT fire
    select '__chk_batch', now() - (d || ' days')::interval - interval '16 minutes' + ((s - 1) * 2 || ' minutes')::interval,
           true, 1300
      from generate_series(1, 16) d, generate_series(1, 12) s
    union all
    select '__chk_batch', now() - (m || ' minutes')::interval, true, 650 from generate_series(15, 16) m
    union all
    -- (f) an enrichment queue that drained (3,436 → 99, wasalt_enrich_ar_residential 11-01/11-02) → must NOT fire
    select 'wasalt_enrich_ar___chk', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 99 else 3436 end
      from generate_series(0, 16) d
    union all
    -- (d) a liveness label probing few rows → must NOT fire (rows_seen is probes, not a capture)
    select 'fleet_liveness:__chk', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 1 else 4000 end
      from generate_series(0, 16) d
  ) x;
  select array_agg(platform order by platform) into hits from public.mon_silent_partial_success_candidates(j);
  if hits is distinct from array['__chk_enum', '__chk_single'] then
    raise exception 'silent_partial_success check failed: candidates = %', hits;
  end if;
end $check$;

-- Check block 2: a catalogue rebase, both directions. The synthetic rebase rows are removed before the block ends.
do $check_rebase$
declare j jsonb; hits text[];
begin
  insert into public.ops_platform_catalogue_rebase (platform, rebased_at, expected_rows_per_run, reason, source_rule_url, evidence, decided_by)
  values ('__chk_rb_ok',     now() - interval '7 days 1 hour', 24, repeat('synthetic check row — removed below. ', 2), 'https://example.invalid/robots.txt', '{}', 'check'),
         ('__chk_rb_drop',   now() - interval '7 days 1 hour', 24, repeat('synthetic check row — removed below. ', 2), 'https://example.invalid/robots.txt', '{}', 'check'),
         ('__chk_rb_new',    now() - interval '2 days 1 hour', 24, repeat('synthetic check row — removed below. ', 2), 'https://example.invalid/robots.txt', '{}', 'check'),
         ('__chk_rb_new_ok', now() - interval '2 days 1 hour', 24, repeat('synthetic check row — removed below. ', 2), 'https://example.invalid/robots.txt', '{}', 'check');
  select jsonb_agg(x) into j from (
    -- (g) superoffice's shape: 184 a run on the old site, 24 a run since the rebase → must NOT fire
    select '__chk_rb_ok'::text as platform, now() - (d || ' days')::interval - interval '5 minutes' as started_at,
           true as ok, case when d >= 8 then 184 else 24 end as rows_seen
      from generate_series(0, 16) d
    union all
    -- (h) the same, and today's run read 8 of 24 → MUST fire (post-rebase median, per_run)
    select '__chk_rb_drop', now() - (d || ' days')::interval - interval '5 minutes', true,
           case when d >= 8 then 184 when d = 0 then 8 else 24 end
      from generate_series(0, 16) d
    union all
    -- (i) rebased 2 days ago (no median yet), today 5 of a declared 24 → MUST fire (declared_catalogue)
    select '__chk_rb_new', now() - (d || ' days')::interval - interval '5 minutes', true,
           case when d >= 3 then 184 when d = 0 then 5 else 24 end
      from generate_series(0, 16) d
    union all
    -- (j) rebased 2 days ago, today 24 → must NOT fire
    select '__chk_rb_new_ok', now() - (d || ' days')::interval - interval '5 minutes', true,
           case when d >= 3 then 184 else 24 end
      from generate_series(0, 16) d
    union all
    -- (k) the shape of (g) with NO rebase row → MUST fire: the rebase row, nothing else, is what quiets (g)
    select '__chk_rb_none', now() - (d || ' days')::interval - interval '5 minutes', true,
           case when d >= 8 then 184 else 24 end
      from generate_series(0, 16) d
  ) x;
  select array_agg(platform order by platform) into hits from public.mon_silent_partial_success_candidates(j);
  delete from public.ops_platform_catalogue_rebase where platform like '\_\_chk\_rb\_%';
  if hits is distinct from array['__chk_rb_drop', '__chk_rb_new', '__chk_rb_none'] then
    raise exception 'silent_partial_success rebase check failed: candidates = %', hits;
  end if;
end $check_rebase$;

-- rows_collapse: a rebased platform's baseline starts at its rebase. In-place edit of the live function (it carries
-- the 20261103135025 registry guard), raising if the expected text is absent.
do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_rows_collapse()'::regprocedure);
  old_ constant text := $o$               where started_at >= now() - interval '21 days'
                 and started_at <  now() - interval '3 days'
               group by 1,2) z$o$;
  new_ constant text := $n$               where started_at >= now() - interval '21 days'
                 and started_at <  now() - interval '3 days'
                 -- a platform whose readable catalogue changed shape on purpose is judged only from that
                 -- moment (ops_platform_catalogue_rebase: superoffice, robots.txt, owner 2026-11-03)
                 and not exists (select 1 from public.ops_platform_catalogue_rebase cr
                                  where cr.platform = scrape_runs.platform and scrape_runs.started_at < cr.rebased_at)
               group by 1,2) z$n$;
begin
  if position(old_ in d) = 0 then raise exception 'mon_detect_rows_collapse: the baseline window was not found — read the live function first'; end if;
  execute replace(d, old_, new_);
  if position('ops_platform_catalogue_rebase' in pg_get_functiondef('public.mon_detect_rows_collapse()'::regprocedure)) = 0 then
    raise exception 'mon_detect_rows_collapse: the rebase guard did not land';
  end if;
end $mig$;

-- both detectors' own stale-key paths close the two superoffice alerts if superoffice is no longer a candidate
select public.mon_detect_rows_collapse() as rows_collapse_newly_raised,
       public.mon_detect_silent_partial_success() as silent_partial_newly_raised;
