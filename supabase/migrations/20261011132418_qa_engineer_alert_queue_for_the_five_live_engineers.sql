-- 🔧 Quality & Repair 2026-10-11 — backlog item 159 / 369, changed approach (same blocker six nights running).
--
-- The alert spine still routes every alert_event to one of the ELEVEN routines the owner deleted on
-- 2026-09-27 (incident_known_owners(), scripts/lib/alertRouting.ts). Measured 13:20 UTC 2026-10-11:
-- 480 open alerts owned by slugs nobody reads (routine-3 154, routine-2 147, routine-7 48, routine-1 36,
-- routine-11 33, routine-5 20, …) — which is why zero_price_served and district_contradicts_source sat
-- open for 18 and 4 days (🦅 10-09). Rewriting the roster, the CHECK constraint, the TypeScript router
-- and its four barriers is one PR a routine cannot merge (the session gate refuses «Merge Without
-- Review»), so it would reach nobody tonight either.
--
-- This is the ADDITIVE half that reaches the five live engineers now and changes nothing that exists:
-- one pure function that says which LIVE engineer an alert belongs to, and one view each engineer reads
-- as its queue. No row is re-owned, no roster or constraint is touched, every legacy slug keeps working,
-- and dropping these two objects restores the previous state exactly. The legacy owner is kept on every
-- row of the view so the old routing is auditable next to the new one. Ownership follows the SURFACE:
--   🆕 new_listings_engineer — what arrives (zero_new_stall, af_new_listing_capture_regression)
--   ⚡ scraping-engineer     — whether the crawl ran and captured (runs, proxies, enrichers, scraper_*)
--   ♻️ lifecycle            — a listing after its source drops it (every liveness / stale / deletion kind)
--   🔬 advanced_filter      — AF, Monthly AF, Trending
--   🔧 repair               — everything nobody else owns (production, search QA, journeys, seam, barriers)
-- The self-test at the bottom proves, against the live table, that every open alert maps to exactly one
-- of the five and that the kinds named in this comment land where it says.

create or replace function public.ops_engineer_for_alert(p_kind text, p_owner_routine text)
returns text
language sql
immutable
as $$
  select case
    -- 🆕 arrivals first: af_new_listing_capture_regression is an AF kind by prefix but about ARRIVALS.
    when p_kind ~ '^(zero_new_stall|af_new_listing_capture_regression)$' then 'new_listings_engineer'
    -- ⚡ the capture layer (mirrors routine-1's rules in scripts/lib/alertRouting.ts, minus gathern_liveness).
    when p_kind ~ '^(silent_scraper_death|silent_partial_success|run_|dangling_scrape_run|proxy_|scraper_|enumeration_incomplete|legacy_scraper_freshness|dealapp_shard|aqar_deep_fill_health|wasalt_enrich|summary_only_capture|unattributable_platform_runs|liveness_cap_degraded|source_limited_contradicted|unprobed_source_waiver|ingestion_check_failed|moj_district_sales_stale)' then 'scraping-engineer'
    -- ♻️ after the source drops a listing: routine-11's kinds plus the liveness/stale/deletion kinds the old
    -- map filed under routine-3 (data integrity) and routine-1 (gathern_liveness).
    when p_kind ~ '^(served_after_source_gone|deleted_but_source_live|unledgered_hard_delete|liveness_|lifecycle_|gathern_liveness|oracle_chain_never_observed|deletion_|inactive_still|false_resurrection|unknown_treated_as_dead|orphan_after_delete|stale_listings_detected|stale_breaker_escape|quarantine_growth|prune_|cleanup_evidence_gap|deletion_spike|mass_inactivation|unverified_inactivation|inactivation)' then 'lifecycle'
    -- 🔬 the Advanced Filter, Monthly AF and Trending.
    when p_kind ~ '^(af_|monthly_af|trending_)' then 'advanced_filter'
    -- Anything the kind did not decide: the legacy owner decides where it is one of the three with a direct heir.
    when p_owner_routine = 'routine-1-scraping'    then 'scraping-engineer'
    when p_owner_routine = 'routine-5-af-trending' then 'advanced_filter'
    when p_owner_routine = 'routine-11-lifecycle'  then 'lifecycle'
    -- 🔧 owns everything nobody else does (QUALITY_REPAIR_ENGINEER.md): production, search QA, journeys,
    -- seam/monitoring plumbing, barriers, regression, red team, data truth on older rows, unrouted.
    else 'repair'
  end
$$;

comment on function public.ops_engineer_for_alert(text, text) is
  'Which of the five live engineers (scraping-engineer | new_listings_engineer | advanced_filter | lifecycle | repair) '
  'an alert belongs to, from its kind first and its legacy owner_routine second. Additive beside '
  'incident_known_owners(); never NULL. 🔧 2026-10-11, backlog 159/369.';

create or replace view public.ops_engineer_alert_queue as
  select public.ops_engineer_for_alert(a.kind, a.owner_routine) as engineer,
         a.id, a.severity, a.kind, a.platform, a.dedup_key, a.created_at, a.last_affirmed_at,
         a.acknowledged_at, a.dispatched_at,
         a.owner_routine as legacy_owner,
         a.detail
    from public.alert_event a
   where a.resolved_at is null;

comment on view public.ops_engineer_alert_queue is
  'Every OPEN alert with the live engineer that owns it. Each engineer reads its queue with '
  'select * from ops_engineer_alert_queue where engineer = ''<slug>'' order by severity, created_at. '
  'legacy_owner is the deleted-routine slug the spine still writes, kept for audit. 🔧 2026-10-11.';

grant select on public.ops_engineer_alert_queue to service_role;

-- Self-test against the LIVE table: totality (never NULL, always one of the five) and the surface
-- rules this file promises. A migration whose claim is false must not land.
do $$
declare v_bad int; v_counts text;
begin
  select count(*) into v_bad from public.ops_engineer_alert_queue
   where engineer is null
      or engineer not in ('scraping-engineer','new_listings_engineer','advanced_filter','lifecycle','repair');
  if v_bad > 0 then raise exception 'ops_engineer_for_alert is not total: % open alerts without a live engineer', v_bad; end if;

  if public.ops_engineer_for_alert('served_after_source_gone', 'routine-3-data-integrity') <> 'lifecycle'
     or public.ops_engineer_for_alert('deleted_but_source_live', 'routine-3-data-integrity') <> 'lifecycle'
     or public.ops_engineer_for_alert('gathern_liveness_cap', 'routine-1-scraping') <> 'lifecycle'
     or public.ops_engineer_for_alert('silent_partial_success', 'routine-1-scraping') <> 'scraping-engineer'
     or public.ops_engineer_for_alert('liveness_cap_degraded', 'routine-1-scraping') <> 'scraping-engineer'
     or public.ops_engineer_for_alert('af_new_listing_capture_regression', 'routine-5-af-trending') <> 'new_listings_engineer'
     or public.ops_engineer_for_alert('af_live_check_failed', 'routine-5-af-trending') <> 'advanced_filter'
     or public.ops_engineer_for_alert('district_contradicts_source', 'routine-3-data-integrity') <> 'repair'
     or public.ops_engineer_for_alert('stale_no_remediation_path', 'routine-7-seam') <> 'repair'
     or public.ops_engineer_for_alert('journey_live_check_failed', 'routine-6-journey') <> 'repair'
     or public.ops_engineer_for_alert('brand_new_kind_nobody_routed', null) <> 'repair'
  then raise exception 'ops_engineer_for_alert disagrees with the surface rules written above it'; end if;

  select string_agg(engineer || '=' || n, ', ' order by n desc) into v_counts
    from (select engineer, count(*) as n from public.ops_engineer_alert_queue group by 1) q;
  raise notice 'ops_engineer_alert_queue open alerts by engineer: %', v_counts;
end $$;