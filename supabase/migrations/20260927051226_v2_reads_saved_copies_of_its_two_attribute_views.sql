-- listing_native_location_v2 reads SAVED COPIES of its two attribute views (2026-09-27, owner-approved).
--
-- THE CAUSE OF THE RESTARTS. Planning any query over listing_native_location_v2 cost ~292 MB of planner
-- memory (EXPLAIN (MEMORY)). Almost all of it came from two views v2 references four times each:
-- listing_extra_attrs (~22 MB to plan) and listing_age_resolved (~57 MB), each a UNION over every
-- platform's listing tables, so one v2 plan expanded ~2,000 union branches. Every consumer paid that on
-- every call: the hourly search sync (twice), the audit counts, the detector sweep, dealapp propagation
-- every 10 min, loc_rel every 15 min and ad-hoc queries. Overlapping plans exhausted the 8 GB instance
-- five times on 2026-09-26/27, and the cost grew ~1 MB per plan with every platform added.
--
-- THE FIX. v2 now joins listing_extra_attrs_mv / listing_age_resolved_mv, plain copies of the two views
-- (same columns, same rows, unique on (source_table, listing_id)), refreshed at the start of jobid 17
-- every hour. Measured with the same stand-in method before this migration: v2 planning 292 MB -> 3 MB.
-- Each refresh takes ~2 s and plans the source views once an hour, instead of every consumer planning
-- them eight times per call.
--
-- WHAT CHANGES FOR READERS OF v2. Its extra-attribute and property_age columns are now as fresh as the
-- last jobid 17 run (<= 1 h), like its price columns already were (active_listing_ids_v2 is an hourly
-- matview). The served search index is unaffected in practice: the sync (jobid 28, :22) runs right after
-- the refresh (:20) and was already hourly. The two live views are UNCHANGED, and so is everything that
-- reads them directly.
--
-- mon_detect_v2_discards_captured_attrs compared live listing_extra_attrs / listing_age_resolved against
-- v2. It now compares v2 against the copies v2 is built from, which is its actual invariant ("a v2 branch
-- drops a value its input holds"). Comparing against the live views would turn every attribute captured
-- in the last hour into a false P1. The copies' own freshness is watched by mon_detect_stale_refresh
-- (mon_refresh_targets, same thresholds as v1).
--
-- ONBOARDING NOTE. A new platform's attributes reach v2 when the copies are refreshed. Refresh both
-- copies, as well as v1 / active_listing_ids_v2, before its first sync, or wait for jobid 17's next run.
-- Rebuilds that replay v2 from pg_get_viewdef keep these references. Never point v2 back at the live
-- views: that restores the 292 MB plan.

create materialized view if not exists public.listing_extra_attrs_mv as
  select * from public.listing_extra_attrs;
create unique index if not exists listing_extra_attrs_mv_key
  on public.listing_extra_attrs_mv (source_table, listing_id);

create materialized view if not exists public.listing_age_resolved_mv as
  select * from public.listing_age_resolved;
create unique index if not exists listing_age_resolved_mv_key
  on public.listing_age_resolved_mv (source_table, listing_id);

revoke all on public.listing_extra_attrs_mv, public.listing_age_resolved_mv from anon, authenticated;
grant select on public.listing_extra_attrs_mv, public.listing_age_resolved_mv to service_role;

comment on materialized view public.listing_extra_attrs_mv is
  'Saved copy of listing_extra_attrs that listing_native_location_v2 joins (planning v2 over the live view cost ~292 MB). Refreshed by jobid 17 hourly.';
comment on materialized view public.listing_age_resolved_mv is
  'Saved copy of listing_age_resolved that listing_native_location_v2 joins (planning v2 over the live view cost ~292 MB). Refreshed by jobid 17 hourly.';

analyze public.listing_extra_attrs_mv;
analyze public.listing_age_resolved_mv;

-- v2: rewrite the LIVE definition in place, so a concurrent change to v2 is carried forward, not clobbered.
do $mig$
declare
  def text := rtrim(rtrim(pg_get_viewdef('public.listing_native_location_v2'::regclass, true)), ';');
  n_ea int := (select count(*) from regexp_matches(def, '\mlisting_extra_attrs\M', 'g'));
  n_ar int := (select count(*) from regexp_matches(def, '\mlisting_age_resolved\M', 'g'));
  rows_before bigint := (select count(*) from public.listing_native_location_v2);
  rows_after bigint;
  r text;
  plan_kb bigint;
begin
  if n_ea <> 4 or n_ar <> 4 then
    raise exception 'expected v2 to reference listing_extra_attrs and listing_age_resolved 4 times each, found % and %', n_ea, n_ar;
  end if;
  def := regexp_replace(def, '\mlisting_extra_attrs\M', 'listing_extra_attrs_mv', 'g');
  def := regexp_replace(def, '\mlisting_age_resolved\M', 'listing_age_resolved_mv', 'g');
  set local lock_timeout = '5s';
  execute 'create or replace view public.listing_native_location_v2 as ' || def;

  def := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);
  if def ~ '\mlisting_extra_attrs\M' or def ~ '\mlisting_age_resolved\M' then
    raise exception 'v2 still references a live attribute view';
  end if;
  rows_after := (select count(*) from public.listing_native_location_v2);
  if rows_after <> rows_before then
    raise exception 'v2 row count changed: % -> %', rows_before, rows_after;
  end if;
  for r in execute 'explain (memory) select count(*) from public.listing_native_location_v2' loop
    if r ~ 'Memory: used' then plan_kb := substring(r from 'used=([0-9]+)kB')::bigint; end if;
  end loop;
  if plan_kb is null or plan_kb > 32768 then
    raise exception 'v2 planning still uses % kB (expected < 32 MB)', plan_kb;
  end if;
end $mig$;

-- The detector compares v2 against the inputs v2 is built from.
do $mig$
declare
  def text := pg_get_functiondef('public.mon_detect_v2_discards_captured_attrs()'::regprocedure);
begin
  if (select count(*) from regexp_matches(def, 'join\s+public\.listing_extra_attrs\s+ea\s+on', 'g')) <> 1
     or (select count(*) from regexp_matches(def, 'join\s+public\.listing_age_resolved\s+car\s+on', 'g')) <> 1 then
    raise exception 'mon_detect_v2_discards_captured_attrs no longer has the expected joins; update it by hand';
  end if;
  def := regexp_replace(def, '(join\s+public\.)listing_extra_attrs(\s+ea\s+on)', '\1listing_extra_attrs_mv\2');
  def := regexp_replace(def, '(join\s+public\.)listing_age_resolved(\s+car\s+on)', '\1listing_age_resolved_mv\2');
  execute def;
end $mig$;

-- jobid 17 refreshes the copies first, then v1 / active_listing_ids_v2, and logs all four.
do $mig$
declare
  j record;
  anchor constant text := 'refresh materialized view concurrently public.active_listing_ids_v2;';
  cmd text;
begin
  select * into strict j from cron.job where jobname = 'refresh_listing_native_location_v1';
  if j.command ~ 'listing_extra_attrs_mv' then
    return;
  end if;
  if (length(j.command) - length(replace(j.command, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'jobid 17 command no longer has exactly one "%"; update it by hand', anchor;
  end if;
  cmd := replace(j.command, anchor,
    'refresh materialized view concurrently public.listing_extra_attrs_mv; '
    || 'refresh materialized view concurrently public.listing_age_resolved_mv; '
    || 'analyze public.listing_extra_attrs_mv; analyze public.listing_age_resolved_mv; '
    || anchor);
  cmd := rtrim(rtrim(cmd), ';') || '; '
    || 'insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note) '
    || 'select ''listing_extra_attrs_mv'', now(), count(*), ''jobid17'' from public.listing_extra_attrs_mv '
    || 'on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note; '
    || 'insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note) '
    || 'select ''listing_age_resolved_mv'', now(), count(*), ''jobid17'' from public.listing_age_resolved_mv '
    || 'on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;';
  perform cron.schedule(j.jobname, j.schedule, cmd);
end $mig$;

insert into public.mon_mv_refresh_log (object_name, refreshed_at, rows_after, note)
select 'listing_extra_attrs_mv', now(), count(*), 'created by migration' from public.listing_extra_attrs_mv
on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;
insert into public.mon_mv_refresh_log (object_name, refreshed_at, rows_after, note)
select 'listing_age_resolved_mv', now(), count(*), 'created by migration' from public.listing_age_resolved_mv
on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;

insert into public.mon_refresh_targets (object_name, check_kind, warn_after_minutes, crit_after_minutes, notes)
select v.object_name, 'mv_freshness', 180, 360, 'saved copy joined by listing_native_location_v2; refreshed by jobid 17 hourly; same thresholds as v1'
from (values ('listing_extra_attrs_mv'), ('listing_age_resolved_mv')) v(object_name)
where not exists (select 1 from public.mon_refresh_targets t where t.object_name = v.object_name);

do $mig$
declare j record;
begin
  select * into strict j from cron.job where jobname = 'refresh_listing_native_location_v1';
  if position('refresh materialized view concurrently public.listing_extra_attrs_mv' in j.command) = 0
     or position('refresh materialized view concurrently public.listing_age_resolved_mv' in j.command) = 0
     or position('refresh materialized view concurrently public.listing_age_resolved_mv' in j.command)
        > position('refresh materialized view concurrently public.listing_native_location_v1' in j.command)
     or not j.active then
    raise exception 'jobid 17 does not refresh both copies before v1: %', j.command;
  end if;
  if has_table_privilege('anon', 'public.listing_extra_attrs_mv', 'select')
     or has_table_privilege('anon', 'public.listing_age_resolved_mv', 'select') then
    raise exception 'the saved copies must not be public API';
  end if;
  if pg_get_functiondef('public.mon_detect_v2_discards_captured_attrs()'::regprocedure) !~ 'listing_extra_attrs_mv\s+ea\M'
     or pg_get_functiondef('public.mon_detect_v2_discards_captured_attrs()'::regprocedure) !~ 'listing_age_resolved_mv\s+car\M' then
    raise exception 'mon_detect_v2_discards_captured_attrs was not repointed at the copies';
  end if;
  if (select count(*) from public.mon_refresh_targets where object_name in ('listing_extra_attrs_mv','listing_age_resolved_mv') and active) <> 2 then
    raise exception 'the saved copies are not registered with mon_detect_stale_refresh';
  end if;
end $mig$;
