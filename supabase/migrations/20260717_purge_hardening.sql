-- ============================================================================
-- Purge Hardening (2026-07-17)
-- Hardens the DORMANT purge weapon before any future enablement.
--
-- STATUS: cron jobid 11 ('purge-inactive-listings', '0 22 * * 5') is
-- active = false and MUST STAY DISABLED. This migration does NOT enable it —
-- it re-asserts active = false. Enablement requires BOTH:
--   (a) the owner's PDPL retention-window decision (PRD §13), and
--   (b) a policy call on the ~3,495 missing_count = 0 dead-zone rows
--       (active = false forever-ineligible because mc >= 3 is required).
--
-- Three defects fixed (all verified live on 2026-07-16):
--   1. REAPPEARANCE GUARD — the old doomed-selection ignored last_seen_at:
--      a row a scraper has SEEN recently is not gone, whatever its
--      deactivated_at says. Verified impact: at the Fri 2026-07-17 22:00
--      schedule, 2,023 rows matched the old WHERE, of which 272 sold-pinned
--      rows (satel 122, awal 77, eastabha 38, ramzalqasim 35) had been seen
--      within 48h and would have been mass-deleted. New predicate:
--        and (last_seen_at is null or last_seen_at < now() - grace)
--   2. BATCH CAP — deletes are now bounded per table per run (500, oldest
--      deactivated_at first). A first-ever enablement can never mass-delete
--      a table in one pass. The optional argument can only LOWER the cap
--      (hard ceiling 500 inside the function), never raise it.
--   3. PREVIEW PARITY — purge_preview() previously answered a DIFFERENT
--      question (last_seen_at 30d, missing_count >= 3 OR retired-platform,
--      no deactivated_at requirement, wasalt NOT excluded). It is redefined
--      to share the weapon's doomed-selection SQL verbatim via
--      purge_doomed_sql(), so preview == what the weapon would delete.
--
-- Kept from the previous definition: archive-first CTE atomicity
-- (purged_listings_archive insert + delete in one statement), per-table
-- exception isolation, price-sanity exclusion, missing_count >= 3,
-- deactivated_at required + past grace, wasalt_% exclusion,
-- SECURITY DEFINER + pinned search_path, deletion_reason unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Single source of truth: the doomed-selection SQL, shared by the weapon
--    and the preview. p_limit = null means no LIMIT (preview's full count).
-- ---------------------------------------------------------------------------
create or replace function public.purge_doomed_sql(
  p_table text,
  p_grace interval,
  p_limit integer default null
)
returns text
language sql
stable
as $fn$
  select format($q$
    select * from public.%1$I
    where active = false
      and coalesce(missing_count, 0) >= 3
      and deactivated_at is not null
      and deactivated_at < now() - %2$L::interval
      and (last_seen_at is null or last_seen_at < now() - %2$L::interval)
      and not (coalesce(price_total, 0) > 1000000000
            or coalesce(price_per_meter, 0) > 300000
            or coalesce(price_annual, 0) > 100000000)
    order by deactivated_at asc, id asc
    limit %3$s
  $q$, p_table, p_grace::text, coalesce(p_limit::text, 'all'))
$fn$;

comment on function public.purge_doomed_sql(text, interval, integer) is
  'Generates the doomed-selection SQL used by BOTH purge_inactive_listings() '
  'and purge_preview(). Any change to purge eligibility must happen here so '
  'preview and weapon can never diverge again. The last_seen_at predicate is '
  'the reappearance guard: recently-seen rows are never purge-eligible.';

revoke execute on function public.purge_doomed_sql(text, interval, integer)
  from public, anon, authenticated;
grant execute on function public.purge_doomed_sql(text, interval, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Hardened weapon. Signature change: optional p_batch_limit (default 500,
--    hard ceiling 500 — callers can only lower it). The cron command
--    'select public.purge_inactive_listings()' resolves unchanged.
-- ---------------------------------------------------------------------------
drop function if exists public.purge_inactive_listings();

create or replace function public.purge_inactive_listings(
  p_batch_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t text;
  n int;
  total int := 0;
  grace constant interval := interval '7 days';
  batch_ceiling constant int := 500;
  batch int := least(coalesce(p_batch_limit, batch_ceiling), batch_ceiling);
begin
  if batch < 1 then
    return 0;
  end if;
  for t in select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt\_%'
  loop
    begin
      execute format($f$
        with doomed as ( %s ),
        archived as (
          insert into public.purged_listings_archive
            (source_table, listing_id, row_data, missing_count, deactivated_at, deletion_reason)
          select %L, d.id, to_jsonb(d), d.missing_count, d.deactivated_at, %L
          from doomed d
          returning listing_id
        )
        delete from public.%I x where x.id in (select listing_id from archived)
      $f$, public.purge_doomed_sql(t, grace, batch), t, '7d-confirmed-inactive', t);
      get diagnostics n = row_count;
      total := total + n;
    exception when others then
      raise notice 'purge skip %: %', t, sqlerrm;
    end;
  end loop;
  return total;
end $function$;

comment on function public.purge_inactive_listings(integer) is
  'DORMANT weapon — cron jobid 11 is disabled and must stay disabled until '
  'the owner''s PDPL retention decision (PRD §13) and the mc=0 dead-zone '
  'policy call. Hardened 2026-07-17: reappearance guard (last_seen_at within '
  'grace excludes the row), per-table batch cap (<= 500 oldest-deactivated '
  'first; argument can only lower it), doomed-selection shared with '
  'purge_preview() via purge_doomed_sql(). Archives to '
  'purged_listings_archive before deleting, per-table exception isolation.';

revoke execute on function public.purge_inactive_listings(integer)
  from public, anon, authenticated;
grant execute on function public.purge_inactive_listings(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Preview parity: purge_preview() now runs the EXACT doomed-selection the
--    weapon would run (same generator, same grace, same tables, same wasalt
--    exclusion). eligible = full match count; would_delete_next_run = capped
--    at the weapon's default batch; sample_ids = first 5 in deletion order.
-- ---------------------------------------------------------------------------
drop function if exists public.purge_preview(integer);
drop function if exists public.purge_preview();

create function public.purge_preview()
returns table(tbl text, eligible bigint, would_delete_next_run bigint, sample_ids bigint[])
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t text;
  c bigint;
  s bigint[];
  grace constant interval := interval '7 days';
  batch_ceiling constant int := 500;
begin
  for t in select tablename from pg_tables
    where schemaname = 'public'
      and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt\_%'
    order by tablename
  loop
    begin
      execute format('select count(*) from (%s) q',
                     public.purge_doomed_sql(t, grace, null)) into c;
      if c > 0 then
        execute format(
          'select coalesce(array_agg(q.id order by q.deactivated_at asc, q.id asc), ''{}'') from (%s) q',
          public.purge_doomed_sql(t, grace, 5)) into s;
        tbl := t;
        eligible := c;
        would_delete_next_run := least(c, batch_ceiling);
        sample_ids := s;
        return next;
      end if;
    exception when others then
      raise notice 'preview skip %: %', t, sqlerrm;
    end;
  end loop;
end $function$;

comment on function public.purge_preview() is
  'Answers the SAME question as purge_inactive_listings(): both build their '
  'doomed-selection from purge_doomed_sql() (grace 7d, reappearance guard, '
  'price-sanity, mc>=3, deactivated_at required, wasalt excluded). eligible '
  'is the full match count; would_delete_next_run caps it at the per-table '
  'batch limit (500); sample_ids are the first 5 ids in deletion order.';

revoke execute on function public.purge_preview()
  from public, anon, authenticated;
grant execute on function public.purge_preview()
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Re-assert the weapon stays DISABLED. This migration must never flip it.
--    (cron.job allows no direct DML on Supabase — use cron.alter_job(); the
--    exception guard keeps this migration replayable on branches without the
--    job or without cron privileges.)
-- ---------------------------------------------------------------------------
do $cron$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'purge-inactive-listings';
  if v_jobid is not null then
    perform cron.alter_job(job_id => v_jobid, active => false);
  end if;
exception when others then
  raise notice 'purge-cron re-assert skipped: %', sqlerrm;
end $cron$;

notify pgrst, 'reload schema';
