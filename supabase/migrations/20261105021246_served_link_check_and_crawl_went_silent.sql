-- Served cards that no longer open the ad, and a crawl that goes silent in one run (2026-11-05, Dwelleo).
--
-- On 2026-11-04 Dwelleo cut its own catalogue from ~7,000 ads to 18 (its listing pages, API total, sitemap and
-- map page all agree; 10 of 10 of our served ads answered API 422 and page 404). Two crawls that day ended
-- ok=false with 0 rows and nothing paged until the next morning; dead_visible_score read the site two nights
-- running as «void: known-live controls 0/5 alive» — when every link of a site dies, its controls die too.
--
-- 1. ops_served_link_check: one row per website per night from scrapers/common/served_link_check.py (~20 served
--    listing_url opened, home page first; moved links rewritten to the site's own new address, the crawl
--    re-dispatched when most links are dead or moved).
-- 2. mon_detect_served_links_broken: P1 per website when dead + moved-but-unrepaired links are at least half of
--    the decided ones (>= 5 decided), with the dead sample; a repair is recorded as a self-resolving P2; a check
--    that wrote nothing for 36 h is itself a P1.
-- 3. mon_detect_crawl_went_silent: P1 the same hour a crawl label's latest finished run saw under 5% of its own
--    8-day median healthy run (median >= 1,000), ok or not. Enrichment / probe labels are not inventory.
-- 4. Dwelleo's catalogue rebase (owner 2026-11-05: follow the source), so its proven shrink is judged from now.
-- Both detectors are needle-rostered into mon_run_all_detectors (cron mon-detectors-and-dispatch, :59) and
-- proven at apply time in both directions inside rolled-back sub-transactions.

create table if not exists public.ops_served_link_check (
  night        date        not null,
  platform     text        not null,
  shown        integer     not null,
  sampled      integer     not null default 0,
  ok           integer     not null default 0,
  moved        integer     not null default 0,
  repaired     integer     not null default 0,
  dead         integer     not null default 0,
  unknown      integer     not null default 0,
  home_status  integer,
  dead_sample  text[]      not null default '{}',
  redispatched boolean     not null default false,
  note         text,
  run_url      text,
  created_at   timestamptz not null default now(),
  primary key (night, platform)
);
comment on table public.ops_served_link_check is
  'Do served cards still open the ad? One row per website per night (scrapers/common/served_link_check.py). '
  'Read by mon_detect_served_links_broken.';
alter table public.ops_served_link_check enable row level security;
revoke all on public.ops_served_link_check from anon, authenticated;
grant select, insert, update on public.ops_served_link_check to service_role;

create or replace function public.mon_detect_served_links_broken()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; broken text[] := '{}'; healed text[] := '{}'; r record; v_last timestamptz;
begin
  for r in
    select distinct on (platform) *, ok + moved + dead as decided
      from public.ops_served_link_check
     where created_at > now() - interval '36 hours'
     order by platform, created_at desc
  loop
    if r.decided >= 5 and 2 * (r.dead + r.moved - r.repaired) >= r.decided then
      broken := broken || ('served_links_broken:' || r.platform);
      n := n + public.mon_raise('P1', 'served_links_broken', r.platform, 'served_links_broken:' || r.platform,
        jsonb_build_object('night', r.night, 'shown', r.shown, 'decided', r.decided, 'ok', r.ok, 'dead', r.dead,
          'moved', r.moved, 'repaired', r.repaired, 'unknown', r.unknown, 'dead_sample', r.dead_sample,
          'crawl_redispatched', r.redispatched, 'run_url', r.run_url, 'for', '⚡ ♻️',
          'why', 'Most of the cards a customer can open on this website do not open the ad: the served listing_url '
              || 'answers 404/410, or lands on another page that is not this ad. The automatic repair (rewrite to the '
              || 'site''s own new address, re-dispatch the crawl) could not fix these. Open dead_sample in a browser: '
              || 'a new URL scheme → fix the scraper to store it; the ads really gone → the liveness path hides them '
              || '(never a blind mass hide).'));
    end if;
    if r.repaired > 0 then
      healed := healed || ('served_links_self_healed:' || r.platform);
      n := n + public.mon_raise('P2', 'served_links_self_healed', r.platform, 'served_links_self_healed:' || r.platform,
        jsonb_build_object('night', r.night, 'repaired', r.repaired, 'moved', r.moved, 'decided', r.decided,
          'crawl_redispatched', r.redispatched, 'run_url', r.run_url,
          'why', 'Served links that redirected to the site''s own new address for the same ad were rewritten.'));
    end if;
  end loop;
  perform public.mon_resolve_stale_keys('served_links_broken', broken);
  perform public.mon_resolve_stale_keys('served_links_self_healed', healed);
  select max(created_at) into v_last from public.ops_served_link_check;
  if coalesce(v_last, timestamptz '2026-11-05 12:00+00') < now() - interval '36 hours' then
    n := n + public.mon_raise('P1', 'served_link_check_silent', 'fleet', 'served_link_check_silent',
      jsonb_build_object('last_row', v_last, 'workflow', '.github/workflows/served-link-check.yml',
        'why', 'The daily served-link check wrote no row for 36 hours: dead links would ship unseen.'));
  else
    perform public.mon_resolve_stale_keys('served_link_check_silent', '{}');
  end if;
  return n;
end $function$;
revoke all on function public.mon_detect_served_links_broken() from public, anon, authenticated;
grant execute on function public.mon_detect_served_links_broken() to service_role;

create or replace function public.mon_detect_crawl_went_silent()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    with ap as (
      select platform from public.platform_registry where status = 'active' and kind = 'source'
    ), runs as (
      select ap.platform, s.platform as label, s.started_at, s.ok, coalesce(s.rows_seen, 0) as rows_seen, s.notes
        from ap join public.scrape_runs s on (s.platform = ap.platform or s.platform like ap.platform || '\_%')
       where s.platform !~ ':'
         and s.platform !~ '_enrich'          -- a backfill's rows_seen is its backlog: 0 is a done job
         and s.started_at > now() - interval '8 days'
         and s.finished_at is not null
         and not exists (select 1 from public.ops_platform_catalogue_rebase cr
                          where cr.platform = ap.platform and s.started_at < cr.rebased_at)
    ), last as (
      select distinct on (label) * from runs order by label, started_at desc
    ), base as (
      select x.label, percentile_cont(0.5) within group (order by x.rows_seen)::numeric as median_rows, count(*) as healthy_runs
        from runs x join last l using (label)
       where x.ok and x.rows_seen > 0 and x.started_at < l.started_at
       group by x.label
    )
    select l.platform, l.label, l.started_at, l.ok, l.rows_seen, l.notes, b.median_rows, b.healthy_runs
      from last l join base b using (label)
     where b.median_rows >= 1000
       and l.rows_seen < 0.05 * b.median_rows
       and l.started_at > now() - interval '36 hours'
  loop
    live := live || ('crawl_went_silent:' || r.label);
    n := n + public.mon_raise('P1', 'crawl_went_silent', r.platform, 'crawl_went_silent:' || r.label,
      jsonb_build_object('label', r.label, 'last_run_at', r.started_at, 'last_ok', r.ok, 'last_rows_seen', r.rows_seen,
        'median_rows_8d', r.median_rows, 'healthy_runs_8d', r.healthy_runs, 'last_notes', left(r.notes, 300), 'for', '⚡',
        'why', 'This crawl''s latest run saw under 5% of what its own healthy runs see (Dwelleo 6,996 → 0 on '
            || '2026-11-04 paged nobody until the next day). Read last_notes, then the source in a rendered browser '
            || '(four places). If the source really shrank, record it in ops_platform_catalogue_rebase with the '
            || 'evidence; if not, fix the crawl. Its prune guard is holding the old ads meanwhile.'));
  end loop;
  perform public.mon_resolve_stale_keys('crawl_went_silent', live);
  return n;
end $function$;
revoke all on function public.mon_detect_crawl_went_silent() from public, anon, authenticated;
grant execute on function public.mon_detect_crawl_went_silent() to service_role;

insert into public.ops_platform_catalogue_rebase
  (platform, rebased_at, expected_rows_per_run, reason, source_rule_url, evidence, decided_by)
values ('dwelleo', '2026-11-04 08:00:00+00', 18,
  'Dwelleo cut its own catalogue on 2026-11-04 from ~7,000 ads to 18 (9 sale + 9 rent). Every place the site '
  || 'publishes agrees, read in a rendered browser on 2026-11-05; its old ~7,000-a-run history is not a baseline.',
  'https://www.dwelleo.sa/ar/properties/for-sale',
  jsonb_build_object(
    'for_sale_page', '«9 عقارات للبيع» https://www.dwelleo.sa/ar/properties/for-sale',
    'for_rent_page', '«9 عقارات للإيجار» https://www.dwelleo.sa/ar/properties/for-rent',
    're_sale_and_short_term', '0 نتيجة each',
    'api_total', 'https://api.dwelleo.sa/api/v1/properties?page=1 pagination.total 18 (filters do not widen it)',
    'sitemap', 'https://www.dwelleo.sa/sitemaps/properties.xml 32 <loc> = 16 slugs ar+en',
    'map_page', 'https://www.dwelleo.sa/ar/properties-maps calls the same API',
    'served_sample', '10 of 10 served ads: API 422 «The selected id is invalid.» and page 404'),
  'owner 2026-11-05: follow the source')
on conflict (platform) do nothing;

-- Roster (an unrostered detector is decoration). Needle-edit of the LIVE body, read in this same step.
do $roster$
declare d text; anchor text := '''mon_detect_pin_coverage_below_floor'','; k int; fn text;
begin
  foreach fn in array array['mon_detect_served_links_broken', 'mon_detect_crawl_went_silent'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
    if d is null then raise exception 'mon_run_all_detectors not found'; end if;
    if position('''' || fn || '''' in d) > 0 then
      raise notice '% already rostered', fn;
      continue;
    end if;
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''' || fn || ''', ' || anchor);
  end loop;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_served_links_broken''' in d) = 0 or position('''mon_detect_crawl_went_silent''' in d) = 0 then
    raise exception 'roster edit did not land';
  end if;
end
$roster$;

-- PROOF, both directions, inside rolled-back sub-transactions: a planted broken website raises and a healthy one
-- does not; a planted 0-row run after a healthy history raises, and Dwelleo's rebase keeps its proven shrink quiet.
do $proof$
declare victim text; v_open int;
begin
  begin
    insert into public.ops_served_link_check (night, platform, shown, sampled, ok, dead, dead_sample)
    values (current_date, 'zz_proof_broken', 100, 10, 2, 8, array['https://example.invalid/a']),
           (current_date, 'zz_proof_healthy', 100, 20, 18, 2, '{}');
    perform public.mon_detect_served_links_broken();
    select count(*) into v_open from public.alert_event where dedup_key = 'served_links_broken:zz_proof_broken' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: a website with 8 of 10 dead links did not raise'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'served_links_broken:zz_proof_healthy' and resolved_at is null;
    if v_open <> 0 then raise exception 'PROOF: a website with 2 of 20 dead links raised'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;

  -- the victim is a crawl whose OWN median healthy run is large (the detector's own yardstick, not one big run)
  select s.platform into victim
    from public.scrape_runs s join public.platform_registry pr on pr.platform = s.platform
   where pr.status = 'active' and pr.kind = 'source' and s.platform <> 'dwelleo'
     and s.ok and s.rows_seen > 0 and s.started_at > now() - interval '7 days' and s.finished_at is not null
     and not exists (select 1 from public.ops_platform_catalogue_rebase cr where cr.platform = s.platform)
   group by s.platform
  having count(*) >= 3 and percentile_cont(0.5) within group (order by s.rows_seen) >= 2000
   order by percentile_cont(0.5) within group (order by s.rows_seen) desc limit 1;
  if victim is null then raise exception 'PROOF: no healthy platform to plant a silent crawl on'; end if;
  begin
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, notes)
    values (victim, now(), now(), false, 0, 'PROOF planted silent crawl');
    perform public.mon_detect_crawl_went_silent();
    select count(*) into v_open from public.alert_event where dedup_key = 'crawl_went_silent:' || victim and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: a 0-row run on % after healthy runs did not raise', victim; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'crawl_went_silent:dwelleo' and resolved_at is null;
    if v_open <> 0 then raise exception 'PROOF: dwelleo raised despite its recorded rebase'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  raise notice 'PROOF OK: broken links raise, healthy do not; a silent crawl on % raises; dwelleo rebased; both rostered', victim;
end
$proof$;
