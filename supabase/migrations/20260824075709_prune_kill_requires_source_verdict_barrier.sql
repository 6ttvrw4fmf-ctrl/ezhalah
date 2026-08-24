-- Barrier for the bug class found on 2026-08-24: a listing deactivated for missing N consecutive
-- crawls of a DISCOVERY INDEX THAT DOES NOT ENUMERATE THE FULL LIVE CATALOGUE.
--
-- prune_unseen()'s existing guards (empty-seen skip, 30% collapse guard, 0.80 coverage floor,
-- 3-strike grace) all protect against a BROKEN crawl. A perfect crawl of an INCOMPLETE index has an
-- identical signature and the opposite meaning, and none of them can tell the two apart: aqarcity
-- read ~99.6% coverage while 252 live listings aged out. Measured that day: 261/261 deactivated rows
-- (aqarcity 252, abeea 9) were still being served by their source. All were restored.
--
-- The code fix (scrapers/common/db.py prune_unseen(verify_gone=…), wired in aqarcity/abeea) makes
-- the SOURCE's verdict the only thing that may deactivate. This barrier proves that fix keeps
-- running: it does not re-derive liveness (SQL cannot fetch a page), it checks that every
-- deactivation on an oracle-required platform is BACKED by a recorded GONE verdict.

create table if not exists public.ops_oracle_required_platform (
  source_table text primary key,
  reason       text not null,
  added_at     timestamptz not null default now()
);

comment on table public.ops_oracle_required_platform is
  'Platform tables whose discovery index is PROVEN not to enumerate the full live catalogue, so '
  'crawl-absence alone must never deactivate a listing — prune_unseen() must be given a '
  'control-validated verify_gone oracle. Enforced by mon_detect_prune_kill_without_source_verdict().';

insert into public.ops_oracle_required_platform (source_table, reason) values
  ('aqarcity_residential_listings',
   'sitemap.xml publishes a ~1,799-entry window (ids 26858..30637) while the site keeps serving '
   'listings outside it. 2026-08-24: 236 residential rows deactivated over 30 days, 236/236 still '
   'served on re-probe; most had ids INSIDE the sitemap id range. Oracle: _probe_id() — soft-404 '
   '"Page Not Found" or the «هذا الإعلان منتهي» expired banner = gone; clean 200 = live.'),
  ('aqarcity_commercial_listings',
   'Same sitemap window as the residential table (one crawl, one index). 2026-08-24: 16/16 '
   'deactivated rows still served on re-probe.'),
  ('abeea_residential_listings',
   '2026-08-24: 9/9 rows deactivated for crawl absence were still served. Oracle: a removed slug '
   'returns a HARD HTTP 404 (control-validated against a bogus slug); 200 with a real page = live.')
on conflict (source_table) do nothing;

-- The probe evidence table gains ad_number, because prune_unseen() works in ad_number space and
-- resolving it to the row id mid-prune would cost a lookup per batch for no gain.
alter table public.ops_stale_inactivation_probe
  add column if not exists ad_number text;
alter table public.ops_stale_inactivation_probe
  alter column listing_id drop not null;
alter table public.ops_stale_inactivation_probe
  alter column listing_url drop not null;
alter table public.ops_stale_inactivation_probe
  drop constraint if exists ops_stale_inactivation_probe_source_table_listing_id_probed_at_key;

create index if not exists idx_stale_inact_probe_ad
  on public.ops_stale_inactivation_probe (source_table, ad_number, probed_at desc);

create or replace function public.mon_detect_prune_kill_without_source_verdict()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; n int := 0; live_keys text[] := '{}'; bad int; tot int;
begin
  for r in select source_table from public.ops_oracle_required_platform loop
    -- Rows deactivated in the last 48h with NO recorded GONE verdict at/after the deactivation.
    -- query_to_xml keeps this generic over N platform tables without dynamic-SQL plumbing.
    execute format($q$
      select
        count(*) filter (where not exists (
          select 1 from public.ops_stale_inactivation_probe p
           where p.source_table = %L and p.ad_number = t.ad_number
             and p.verdict = 'GONE' and p.probed_at >= t.deactivated_at - interval '1 hour')),
        count(*)
      from public.%I t
      where t.active = false and t.deactivated_at >= now() - interval '48 hours'
    $q$, r.source_table, r.source_table) into bad, tot;

    if bad > 0 then
      live_keys := live_keys || ('prune_kill_unverified:' || r.source_table);
      n := n + public.mon_raise(
        'P1', 'prune_kill_unverified',
        regexp_replace(r.source_table, '_(residential|commercial)_listings$', ''),
        'prune_kill_unverified:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'deactivated_48h', tot,
          'without_gone_verdict', bad,
          'why', 'This platform''s discovery index does NOT enumerate its full live catalogue '
              || '(see ops_oracle_required_platform.reason), so absence from the crawl is not '
              || 'evidence of death. On 2026-08-24, 261 of 261 rows deactivated this way were '
              || 'still served by their source. A deactivation here is only legitimate when '
              || 'prune_unseen''s verify_gone oracle recorded a GONE verdict for that ad_number.',
          'adjudicate', 'Do NOT resolve this by widening the crawl or relaxing the grace count. '
              || 'Either the verify_gone wiring was dropped from the scraper (check '
              || 'scrapers/<platform>/run.py passes verify_gone=, pinned by '
              || 'scrapers/common/tests/test_prune_requires_source_verdict_to_kill.py), or the '
              || 'oracle stopped writing evidence. Re-probe the affected rows and RESTORE any that '
              || 'are live (DATA_INTEGRITY_ENGINEER.md §15).'));
    end if;
  end loop;

  -- Resolve on the EVALUATED path only, from the cohort that raises (§23a/§25a: one predicate for
  -- both directions — never a second, independently-worded self-heal clause).
  perform public.mon_resolve_stale_keys('prune_kill_unverified', live_keys);
  return n;
end
$function$;

comment on function public.mon_detect_prune_kill_without_source_verdict() is
  'P1. For every table in ops_oracle_required_platform, asserts that each listing deactivated in the '
  'last 48h carries a recorded GONE verdict from prune_unseen()''s verify_gone oracle. Protects the '
  '2026-08-24 bug class: a perfect crawl of an incomplete discovery index aged out 261 live '
  'listings while every coverage/collapse guard read healthy. A standing 0 is the healthy reading '
  '(§24c) — it guards the wiring, not a live defect. Cheap: two counts per registered table.';

-- Reachability (§11a: a barrier nothing calls is decoration; mon_detect_orphaned_detectors() fires
-- on any detector reachable from neither the roster nor a cron job). Its own cron job rather than a
-- roster edit, so it cannot lengthen the twice-hourly sweep that already runs ~170s of a 900s
-- budget. 08:42 UTC: minute 42 carries no hourly job, and hour 8 carries no */8 sweep — no
-- minute-slot collision (cron discipline, 2026-08-10 outage).
select cron.schedule(
  'mon-prune-kill-without-source-verdict',
  '42 8 * * *',
  $$ set statement_timeout to '120s'; select public.mon_detect_prune_kill_without_source_verdict(); $$
);
