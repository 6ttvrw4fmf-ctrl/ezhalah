-- 🦅 Falcon 2026-11-03 — TWO DATABASE CHANGES WAITING FOR A PERSON TO APPLY.
-- Why a person: the Supabase MCP apply_migration asked a confirmation question at 20:12 UTC that an
-- unattended routine cannot answer (FALCON_ENGINEER.md «THE SUPABASE QUESTION RULE»). Nothing below has
-- been applied. Apply each part with apply_migration while the database is quiet (AGENTS.md rule 1),
-- then mirror the version apply_migration mints into supabase/migrations/ (mirror PR, «mirror» in title).
-- check-migration-before-apply.ts: PASS for part 1 (it cites no migration).
--
-- PART 2 (wasalt enum liveness cadence) is at the bottom.

-- ═══ PART 1 — duplex_index_drift: per row, and only after a sync pass ════════════════════════════════
-- Before: 16 opens in 7 days on ONE dedup key (owner repeat list #8). Every open read «missing 1-2», was
-- raised at :59 right after the :22 sync and cleared by the next one with nobody touching anything.
-- Per-row truth at 20:10 UTC: 933 active Duplex rows in platform tables, 933 of them in search_listings_ar.
-- duplex_index_drift reopened 16 times in 7 days on ONE key, each time «missing 1-2», each time raised at :59 right
-- after the :22 search sync and cleared by the next one. A Duplex listing that a crawl inserts or reactivates at :30
-- cannot be in search_listings_ar until the next :22 sync, so a COUNT compare read normal sync lag as drift. A count
-- compare could also hide a real loss behind an extra row. Now: per row, and only a listing that was already missing
-- BEFORE the latest successful sync (cron job sync-search-listings-ar) and is still missing after it is drift.
create table if not exists public.ops_duplex_unindexed_seen (
  source_table text not null,
  listing_id bigint not null,
  first_missing_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.ops_duplex_unindexed_seen enable row level security;
revoke all on public.ops_duplex_unindexed_seen from anon, authenticated;

CREATE OR REPLACE FUNCTION public.mon_detect_duplex_reachability()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  raw_duplex bigint := 0; idx_duplex bigint; n int := 0; t text; c bigint;
  last_sync timestamptz; confirmed bigint; pending bigint; sample jsonb;
begin
  create temp table if not exists _duplex_live (source_table text, listing_id bigint) on commit drop;
  truncate _duplex_live;
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
  loop
    execute format('insert into _duplex_live select %L, id from public.%I where active and property_type = ''Duplex''', t, t);
    get diagnostics c = row_count;
    raw_duplex := raw_duplex + c;
  end loop;

  select count(*) into idx_duplex from public.search_listings_ar where type_ar = 'دوبلكس';

  -- the per-row missing set, remembered across sweeps
  delete from public.ops_duplex_unindexed_seen s
   where not exists (select 1 from _duplex_live d
                      where d.source_table = s.source_table and d.listing_id = s.listing_id
                        and not exists (select 1 from public.search_listings_ar x
                                         where x.source_table = d.source_table and x.listing_id = d.listing_id));
  insert into public.ops_duplex_unindexed_seen (source_table, listing_id)
  select d.source_table, d.listing_id from _duplex_live d
   where not exists (select 1 from public.search_listings_ar x
                      where x.source_table = d.source_table and x.listing_id = d.listing_id)
  on conflict do nothing;

  select max(r.start_time) into last_sync
    from cron.job_run_details r join cron.job j using (jobid)
   where j.jobname = 'sync-search-listings-ar' and r.status = 'succeeded';

  select count(*) filter (where last_sync is not null and first_missing_at < last_sync),
         count(*) filter (where last_sync is null or first_missing_at >= last_sync),
         coalesce(jsonb_agg(source_table || ':' || listing_id) filter (where last_sync is not null and first_missing_at < last_sync), '[]'::jsonb)
    into confirmed, pending, sample
    from (select * from public.ops_duplex_unindexed_seen order by first_missing_at limit 1000) s;

  -- 1. drift: a live Duplex listing a whole sync pass did not index
  if confirmed > 0 then
    n := n + public.mon_raise('P2', 'duplex_index_drift', 'search', 'duplex_index_drift',
      jsonb_build_object('raw_active_duplex', raw_duplex, 'indexed_duplex', idx_duplex,
        'missing', confirmed, 'awaiting_next_sync', pending, 'last_sync', last_sync,
        'keys', (select jsonb_agg(e) from (select e from jsonb_array_elements(sample) e limit 20) q),
        'note', 'Duplex rows exist in platform tables but are absent from search_listings_ar after a full sync pass — '
             || 'unreachable by every user-facing path.'));
  else
    perform public.mon_resolve_key('duplex_index_drift', 'duplex_index_drift');
  end if;

  -- 2. fold: the type collapsing to zero fleet-wide is a mapping regression, not an inventory fact
  if idx_duplex = 0 then
    n := n + public.mon_raise('P1', 'duplex_type_folded', 'search', 'duplex_type_folded',
      jsonb_build_object('indexed_duplex', 0,
        'note', 'Zero searchable Duplex fleet-wide. A scraper mapping has almost certainly re-folded '
             || 'دوبلكس into Villa/Apartment (the 2026-08-19 defect). Check scrapers/*/run.py against '
             || 'scripts/verify-duplex-source-truth.ts.'));
  else
    update public.alert_event set resolved_at = now()
     where kind = 'duplex_type_folded' and resolved_at is null;
  end if;

  return n;
end $function$;

-- ═══ PART 2 — wasalt enum liveness runs every day, not every other day ═════════════════════════════════
-- liveness_checking_stalled:wasalt opens between runs by construction: pg_cron job 36 dispatches
-- wasalt-enum-liveness.yml at «0 21 */2 * *» (48 h apart) while the stall window is least(sla 48 h, 30 h)
-- = 30 h. Measured 11-03 06:59: 95,775 active rows, 0 checked in 30 h, 8,290 in 7 days against a need of
-- 47,888 a day. The workflow's own concurrency group (cancel-in-progress: false) prevents overlap, and a
-- full enumeration took 3h26m on 11-01 (run 41349680012), so a daily start never stacks.
-- Do NOT clear the alert by widening the window or raising sla_hours (LISTING_LIVENESS.md §7).
select cron.alter_job(36, schedule := '0 21 * * *');
