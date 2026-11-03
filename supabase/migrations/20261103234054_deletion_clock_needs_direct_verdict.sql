-- DELETION CLOCK NEEDS A DIRECT SOURCE VERDICT (owner decision 2, 2026-11-03, verbatim answer
-- "Yes, use your picks" to: "an ad becomes eligible for the deletion clock only after at least one
-- DIRECT source verdict (last_verified_alive_at or a GONE probe), not crawl absence alone").
--
-- Before: the retention engine (scrapers/common/cleanup.py) put a row on the deletion clock on
--   active = false AND missing_count >= N AND last_seen_at < now() - D days
-- All three are crawl-absence signals (LISTING_LIVENESS.md: absence is UNKNOWN, never a verdict).
-- mon_detect_deletion_clock_without_evidence measured the gap: gathern 210 of 13,522 eligible,
-- wasalt residential 117, aqar residential 36, wasalt commercial 14 rows with NO verdict at all.
--
-- After: eligibility is decided in ONE place, deletion_clock_eligible_sql(), and it additionally
-- requires a DIRECT verdict for that row:
--   last_verified_alive_at IS NOT NULL                 (the source once affirmed it alive), or
--   a GONE row in ops_stale_inactivation_probe for its ad_number, probed no earlier than an hour
--   before this deactivation.
-- Rows without one stay OUT of the clock: they are not deleted, not changed, they stay as they are.
-- The delete-time fresh re-probe, the anomaly/fraction gates, the health gate and the audit trail
-- are all unchanged — this only ADDS a precondition.
--
-- Callers of the one predicate: the engine (via the two RPCs below), ops_lifecycle_deletion_backlog,
-- ops_lifecycle_backlog_evidence_class. mon_detect_deletion_clock_without_evidence now measures the
-- ENGINE'S set (the same function) and re-checks the verdict with its own independent clause, so it
-- clears because it is true, and fires again the day anyone drops the clause from the predicate.

do $pre$
begin
  if to_regprocedure('public.mon_detect_deletion_clock_without_evidence()') is null
     or to_regprocedure('public.ops_lifecycle_deletion_backlog()') is null
     or to_regprocedure('public.ops_lifecycle_backlog_evidence_class(text,jsonb)') is null then
    raise exception 'deletion clock: an expected function is missing — refusing to patch blind';
  end if;
  if position('t.last_seen_at < now() - (%3$s || '' days'')::interval'
              in pg_get_functiondef('public.mon_detect_deletion_clock_without_evidence()'::regprocedure)) = 0
     or position('t.last_seen_at < now() - (%3$s || '' days'')::interval'
              in pg_get_functiondef('public.ops_lifecycle_deletion_backlog()'::regprocedure)) = 0
     or position('t.last_seen_at < now() - (%3$L || '' days'')::interval'
              in pg_get_functiondef('public.ops_lifecycle_backlog_evidence_class(text,jsonb)'::regprocedure)) = 0 then
    raise exception 'deletion clock: live function bodies moved since this migration was written — re-read them';
  end if;
end
$pre$;

-- ── 1. THE predicate ────────────────────────────────────────────────────────────────────────────
create or replace function public.deletion_clock_eligible_sql(
  p_table text, p_min_missing int, p_cutoff timestamptz, p_limit int default null)
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
begin
  if p_table is null or p_table !~ '^[a-z0-9]+_(residential|commercial)_listings$' then
    raise exception 'deletion_clock_eligible_sql: % is not a listing table', p_table;
  end if;
  if p_min_missing is null or p_cutoff is null then
    raise exception 'deletion_clock_eligible_sql: thresholds must not be null';
  end if;
  return format($q$
    select t.id::bigint as id, t.ad_number::text as ad_number, t.listing_url::text as listing_url,
           t.missing_count::int as missing_count, t.last_seen_at, t.deactivated_at
      from public.%1$I t
     where t.active = false
       and coalesce(t.missing_count, 0) >= %2$s
       and t.last_seen_at < %3$L::timestamptz
       -- owner decision 2 (2026-11-03): crawl absence alone never starts the deletion clock.
       and ( t.last_verified_alive_at is not null
          or exists (select 1 from public.ops_stale_inactivation_probe v
                      where v.source_table = %1$L
                        and v.ad_number = t.ad_number
                        and v.verdict = 'GONE'
                        and v.probed_at >= t.deactivated_at - interval '1 hour') )
     order by t.last_seen_at asc, t.id asc
     limit %4$s
  $q$, p_table, p_min_missing, p_cutoff, coalesce(p_limit::text, 'all'));
end;
$function$;

revoke all on function public.deletion_clock_eligible_sql(text, int, timestamptz, int) from public, anon, authenticated;
grant execute on function public.deletion_clock_eligible_sql(text, int, timestamptz, int) to service_role;

-- ── 2. What the engine calls (scrapers/common/cleanup.py) ───────────────────────────────────────
create or replace function public.deletion_clock_eligible_count(
  p_table text, p_min_missing int, p_cutoff timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare c bigint;
begin
  execute format('select count(*) from (%s) q',
                 public.deletion_clock_eligible_sql(p_table, p_min_missing, p_cutoff, null)) into c;
  return c;
end;
$function$;

create or replace function public.deletion_clock_candidates(
  p_table text, p_min_missing int, p_cutoff timestamptz, p_limit int)
returns table(id bigint, ad_number text, listing_url text, missing_count int, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_limit is null or p_limit < 0 then
    raise exception 'deletion_clock_candidates: p_limit must be a non-negative bound';
  end if;
  return query execute format(
    'select q.id, q.ad_number, q.listing_url, q.missing_count, q.last_seen_at from (%s) q',
    public.deletion_clock_eligible_sql(p_table, p_min_missing, p_cutoff, p_limit));
end;
$function$;

revoke all on function public.deletion_clock_eligible_count(text, int, timestamptz) from public, anon, authenticated;
revoke all on function public.deletion_clock_candidates(text, int, timestamptz, int) from public, anon, authenticated;
grant execute on function public.deletion_clock_eligible_count(text, int, timestamptz) to service_role;
grant execute on function public.deletion_clock_candidates(text, int, timestamptz, int) to service_role;

-- ── 3. The backlog report reads the engine's set ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_lifecycle_deletion_backlog()
 RETURNS TABLE(platform text, eligible_now bigint, last_run_at timestamp with time zone, candidates_last_run integer, deleted_last_run integer, aborted boolean, abort_reason text, last_drain_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r   record;
  v_n bigint;
begin
  for r in
    select p.platform, p.min_inactive_days, p.min_missing_count
      from public.platform_retention_policy p
     where p.enabled
  loop
    v_n := 0;
    -- The platform's OWN thresholds, read per run, through the ONE eligibility predicate the engine
    -- uses (deletion_clock_eligible_sql — owner decision 2, 2026-11-03: a direct verdict is required).
    declare
      t text;
      c bigint;
    begin
      for t in
        select c2.table_name from information_schema.columns c2
         where c2.table_schema = 'public' and c2.column_name = 'deactivated_at'
           and c2.table_name like r.platform || '\_%\_listings'
      loop
        execute format('select count(*) from (%s) q',
          public.deletion_clock_eligible_sql(t, r.min_missing_count,
            now() - (r.min_inactive_days || ' days')::interval, null)) into c;
        v_n := v_n + coalesce(c, 0);
      end loop;
    end;

    -- LEFT JOIN, not a plain FROM: an enabled platform that has NEVER run cleanup must still appear
    -- with its backlog rather than vanish from the report because there is no run row to join to.
    return query
      select r.platform, v_n,
             lr.ran_at, lr.candidates, lr.deleted, lr.aborted, lr.abort_reason,
             (select max(d.ran_at) from public.cleanup_runs d
               where d.platform = r.platform and d.dry_run is not true and coalesce(d.deleted, 0) > 0)
        from (select 1) one
        left join lateral (select * from public.cleanup_runs cr
                            where cr.platform = r.platform and cr.dry_run is not true
                            order by cr.ran_at desc limit 1) lr on true;
  end loop;
end;
$function$;

-- ── 4. The evidence-class report reads the engine's set ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_lifecycle_backlog_evidence_class(p_platform text, p_inject jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(eligible bigint, latest_gone bigint, latest_live bigint, latest_unknown bigint, no_verdict bigint, evidence_class text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pol record;
  t   text;
  v_e bigint := 0; v_g bigint := 0; v_l bigint := 0; v_u bigint := 0; v_n bigint := 0;
  c_e bigint;      c_g bigint;      c_l bigint;      c_u bigint;      c_n bigint;
begin
  if p_inject is not null then
    -- The injected input is a list of per-row LATEST verdicts: 'GONE' | 'LIVE' | 'UNKNOWN' | null.
    -- This is the seam the detector needs to test the classifier without writing a single row.
    select count(*),
           count(*) filter (where x.v = 'GONE'),
           count(*) filter (where x.v = 'LIVE'),
           count(*) filter (where x.v = 'UNKNOWN'),
           count(*) filter (where x.v is null)
      into v_e, v_g, v_l, v_u, v_n
      from jsonb_array_elements(p_inject) as e(j)
      cross join lateral (select nullif(e.j #>> '{}', '') as v) as x;
  else
    select p.min_inactive_days, p.min_missing_count into pol
      from public.platform_retention_policy p
     where p.platform = p_platform and p.enabled;
    -- A platform that is not enabled has no deletion queue to classify. Return no row rather than
    -- a zeroed one, so a caller cannot read "not enabled" as "empty and therefore fine".
    if not found then return; end if;

    -- Tables by SHAPE, and the platform's OWN thresholds, read per call, through the ONE eligibility
    -- predicate the engine uses (deletion_clock_eligible_sql — owner decision 2, 2026-11-03).
    for t in
      select c2.table_name from information_schema.columns c2
       where c2.table_schema = 'public'
         and c2.column_name  = 'deactivated_at'
         and c2.table_name like p_platform || '\_%\_listings'
    loop
      -- `as materialized` is load-bearing, not style: inlined, the planner duplicates the correlated
      -- subquery once per count(... filter ...).
      execute format($q$
        with elig as materialized (
          select q.id, q.ad_number from (%1$s) q
        ), latest as materialized (
          select (select p.verdict
                    from public.ops_stale_inactivation_probe p
                   where p.source_table = %2$L
                     and ( (p.listing_id is not null and p.listing_id = e.id)
                        or (p.ad_number  is not null and e.ad_number is not null
                            and p.ad_number = e.ad_number) )
                   order by p.probed_at desc
                   limit 1) as v
            from elig e
        )
        select count(*),
               count(*) filter (where v = 'GONE'),
               count(*) filter (where v = 'LIVE'),
               count(*) filter (where v = 'UNKNOWN'),
               count(*) filter (where v is null)
          from latest
      $q$, public.deletion_clock_eligible_sql(t, pol.min_missing_count,
             now() - (pol.min_inactive_days || ' days')::interval, null), t)
      into c_e, c_g, c_l, c_u, c_n;
      v_e := v_e + coalesce(c_e, 0);
      v_g := v_g + coalesce(c_g, 0);
      v_l := v_l + coalesce(c_l, 0);
      v_u := v_u + coalesce(c_u, 0);
      v_n := v_n + coalesce(c_n, 0);
    end loop;
  end if;

  return query select v_e, v_g, v_l, v_u, v_n,
    case
      when v_e = 0         then 'EMPTY'
      when v_l > 0         then 'CONTRADICTED'
      when v_g = 0         then 'UNVERIFIED'
      when (v_u + v_n) = 0 then 'SOURCE_CONFIRMED_DEAD'
      else                      'PARTIALLY_VERIFIED'
    end;
end;
$function$;

-- ── 5. The detector measures the ENGINE'S set, with its own independent verdict clause ──────────
CREATE OR REPLACE FUNCTION public.mon_detect_deletion_clock_without_evidence()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n        int := 0;
  live     text[] := '{}';
  r        record;
  v_unevid bigint;
  v_total  bigint;
  v_oldest timestamptz;
  v_held   bigint;
begin
  for r in
    select p.platform, c.table_name as tbl, p.min_inactive_days, p.min_missing_count,
           p.require_source_recheck,
           coalesce(g.strategy, '(unregistered)') as strategy
      from public.platform_retention_policy p
      join information_schema.columns c
        on c.table_schema = 'public' and c.column_name = 'deactivated_at'
       and c.table_name like p.platform || '\_%\_listings'
      left join public.ops_liveness_registry g on g.platform = p.platform
     where p.enabled
  loop
    -- The set measured is the one the ENGINE deletes from (deletion_clock_eligible_sql, the same
    -- function cleanup.py reaches through deletion_clock_candidates). The verdict below is this
    -- detector's OWN clause, deliberately not shared: if the predicate ever loses its
    -- direct-verdict requirement, this count rises and the alarm fires again.
    execute format($q$
      select
        count(*) filter (where t.last_verified_alive_at is null
                           and not exists (
                             select 1 from public.ops_stale_inactivation_probe p
                              where p.source_table = %1$L and p.ad_number = t.ad_number
                                and p.verdict = 'GONE'
                                and p.probed_at >= t.deactivated_at - interval '1 hour')),
        count(*),
        min(t.last_seen_at)
      from (%2$s) e
      join public.%1$I t on t.id = e.id
    $q$, r.tbl, public.deletion_clock_eligible_sql(r.tbl, r.min_missing_count,
           now() - (r.min_inactive_days || ' days')::interval, null))
      into v_unevid, v_total, v_oldest;

    if coalesce(v_unevid, 0) > 0 then
      -- Informational: how many absence-only rows the predicate is (correctly) holding out.
      execute format($q$
        select count(*) from public.%1$I t
         where t.active = false
           and coalesce(t.missing_count, 0) >= %2$s
           and t.last_seen_at < now() - (%3$s || ' days')::interval
      $q$, r.tbl, r.min_missing_count, r.min_inactive_days) into v_held;

      live := live || ('deletion_clock_without_evidence:' || r.tbl);
      n := n + public.mon_raise('P1', 'deletion_clock_without_evidence', r.platform,
        'deletion_clock_without_evidence:' || r.tbl,
        jsonb_build_object(
          'source_table', r.tbl,
          'liveness_strategy', r.strategy,
          'retention_window_days', r.min_inactive_days,
          'min_missing_count', r.min_missing_count,
          'require_source_recheck', r.require_source_recheck,
          'deletion_eligible_now', v_total,
          'eligible_without_any_source_verdict', v_unevid,
          'absence_only_candidates_total', v_held,
          'oldest_last_seen_at', v_oldest,
          'why', 'These rows are in the set the deletion engine draws from '
              || '(deletion_clock_eligible_sql), and NOTHING in the database records a source '
              || 'verdict about them: last_verified_alive_at is NULL and no GONE probe exists for '
              || 'their ad_number. Owner decision 2 (2026-11-03) is that such a row never enters the '
              || 'deletion clock, so the predicate has lost its direct-verdict requirement.',
          'action', 'Diff pg_get_functiondef(''public.deletion_clock_eligible_sql(text,integer,'
              || 'timestamp with time zone,integer)'') against supabase/migrations and restore the '
              || 'direct-verdict clause. Do not delete anything to make this number go down.',
          'do_not', 'Do NOT drain this backlog, raise a cap, lower a floor, or delete faster to '
              || 'make this number go down (LISTING_LIVENESS.md §7). The way this alert goes green '
              || 'is a predicate that requires a verdict, never more deletion.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys('deletion_clock_without_evidence', live);
  return n;
end;
$function$;
