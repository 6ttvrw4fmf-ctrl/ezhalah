-- Data Integrity Engineer, 2026-09-06. §4/§15.
--
-- THE FALSE POSITIVE. mon_unverified_inactivations_24h counts every row that went active=false
-- with missing_count < 3, on the contract that a time-based sweep must never flip an unverified
-- row. Today it raised a P1 on sadin_commercial_listings 5695670
-- (https://www.sadin.com.sa/property/XLKDP, deactivated 2026-09-05T23:31:56 inside scrape_runs
-- 41800, missing_count 0, last_verified_alive_at null) -- which looks exactly like a time-based
-- kill and is not one. The SAME listing_url is row 598977 of sadin_residential_listings, active,
-- last_seen 2026-09-06. The listing had been misfiled as commercial; the residential/commercial
-- collision repair moved it and switched the stale copy off. Nothing left the searchable
-- inventory, so nothing was killed unverified.
--
-- WHY THIS MATTERS BEYOND ONE ROW. The barrier's subject is "a listing was made invisible without
-- source evidence". A row whose own URL is still ACTIVE in its platform's sibling table is not
-- invisible -- a user reaches it through the surviving copy -- so counting it does not protect a
-- listing, it spends a P1. The exclusion is decided per row against live state, never a waiver
-- list.
--
-- THE EXCLUSION IS NARROW, MEASURED, AND VISIBLE. Over the last 90 days, 1,143 rows meet the
-- unverified-inactivation shape fleet-wide (after the existing ops_adjudicated_listing exclusion);
-- 6 of them (0.52%) have an active twin; 1,137 remain counted. It cannot become a hiding place
-- either: the count of excluded rows is PUBLISHED as its own column, carried in the alert payload,
-- and mon_detect_unverified_inactivation raises a separate P2 when de-duplication starts to
-- dominate the day's population -- a flood of duplicate copies is a finding of its own, not
-- something to absorb silently.
--
-- (The first attempt at this migration asserted 1,148/11, numbers measured WITHOUT the adjudication
-- exclusion the view has always applied. The proof block below refused to apply it. The numbers
-- above are the re-measured ones; the proof is left strict rather than loosened to fit.)
create or replace function public.mon_unverified_inactivation_counts(p_since interval)
 returns table(unverified bigint, deduplicated bigint)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  with t as (
    select tablename,
           case when tablename like '%\_commercial\_listings' then
                  regexp_replace(tablename, '_commercial_listings$', '_residential_listings')
                else regexp_replace(tablename, '_residential_listings$', '_commercial_listings') end as sibling
      from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
  ), s as (
    select t.tablename, t.sibling,
           exists (select 1 from pg_tables p where p.schemaname = 'public' and p.tablename = t.sibling) as sib_exists
      from t
  ), counted as (
    select q.n, q.n_twin
      from s,
      lateral (
        select (xpath('/row/c/text()', query_to_xml(format(
                 'select count(*) c from public.%I x'
              || ' where x.active = false and coalesce(x.missing_count,0) < 3'
              || '   and x.deactivated_at >= now() - %L::interval'
              || '   and not exists (select 1 from public.ops_adjudicated_listing j'
              || '                    where j.tbl = %L and j.listing_id = x.id)',
                 s.tablename, p_since, s.tablename), false, true, '')))[1]::text::bigint as n,
               case when s.sib_exists then
                 (xpath('/row/c/text()', query_to_xml(format(
                    'select count(*) c from public.%I x'
                 || ' where x.active = false and coalesce(x.missing_count,0) < 3'
                 || '   and x.deactivated_at >= now() - %L::interval'
                 || '   and not exists (select 1 from public.ops_adjudicated_listing j'
                 || '                    where j.tbl = %L and j.listing_id = x.id)'
                 || '   and exists (select 1 from public.%I y'
                 || '                where y.listing_url = x.listing_url and y.active)',
                    s.tablename, p_since, s.tablename, s.sibling), false, true, '')))[1]::text::bigint
               else 0::bigint end as n_twin
      ) q
  )
  select coalesce(sum(c.n - c.n_twin), 0)::bigint, coalesce(sum(c.n_twin), 0)::bigint from counted c;
end $function$;

create or replace view public.mon_unverified_inactivations_24h as
select unverified::integer as unverified_inactivations_24h,
       deduplicated::integer as deduplicated_copies_24h
  from public.mon_unverified_inactivation_counts(interval '24 hours');

create or replace function public.mon_detect_unverified_inactivation()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; cnt int; dedup int;
begin
  select unverified_inactivations_24h, deduplicated_copies_24h
    into cnt, dedup
    from public.mon_unverified_inactivations_24h;

  if coalesce(cnt, 0) > 0 then
    -- Day-scoped dedup key: one alert per breach-day; a resolved alert never blocks a new day's breach.
    n := public.mon_raise('P1', 'unverified_inactivation', 'all',
      'unverified_inactivation:' || current_date,
      jsonb_build_object('count_24h', cnt,
        'deduplicated_copies_24h', dedup,
        'contract', 'mark-stale detect-only (PR#256): time-based sweeps must never flip active on unverified rows',
        'excluded', 'deduplicated_copies_24h rows are NOT counted above: each one''s listing_url is still ACTIVE in the same platform''s sibling table, so the listing never left searchable inventory (res/com collision repair). Decided per row against live state, never a waiver list.',
        'hint', 'query per-row detail: recent active=false with missing_count=0 and deactivated_at≈last_seen_at'));
  end if;

  -- The escape hatch may not become the road. If de-duplication accounts for most of the day's
  -- deactivations, that is a finding about the collision repair, not something to absorb quietly.
  if coalesce(dedup, 0) >= 5 and coalesce(dedup, 0) >= coalesce(cnt, 0) then
    n := n + public.mon_raise('P2', 'deduplicated_copy_flood', 'all',
      'deduplicated_copy_flood:' || current_date,
      jsonb_build_object('deduplicated_copies_24h', dedup, 'unverified_inactivations_24h', cnt,
        'why', 'Most of today''s sub-grace deactivations were duplicate copies whose URL stays active in the sibling table. Individually benign, but at this rate the res/com classifier is misfiling listings on ingest and should be looked at.'));
  end if;

  -- Point-in-time events: auto-resolve after ~2 days, same pattern as mass_inactivation.
  update public.alert_event set resolved_at = now()
   where kind in ('unverified_inactivation', 'deduplicated_copy_flood') and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $function$;

-- ── PROOF, EXECUTED AGAINST PRODUCTION, BOTH DIRECTIONS ─────────────────────────────────────────
-- Not a source-text tripwire: the function is CALLED, over a 90-day window wide enough to contain
-- both classes, and the migration REFUSES to apply unless the numbers hold.
do $do$
declare v_unver bigint; v_dedup bigint;
begin
  select unverified, deduplicated into v_unver, v_dedup
    from public.mon_unverified_inactivation_counts(interval '90 days');

  -- direction 1: the exclusion is not vacuous — it really removes the twin class.
  if v_dedup < 1 then
    raise exception 'PROOF FAILED: no de-duplicated copies found in 90 days, so the new exclusion is untested (dedup=%)', v_dedup;
  end if;

  -- direction 2: it does NOT swallow the population the barrier exists for.
  if v_unver < 1000 then
    raise exception 'PROOF FAILED: only % unverified inactivations remain counted over 90 days; measured 1,137 before applying, so the exclusion is far wider than the twin class', v_unver;
  end if;

  -- direction 3: nothing is lost between the two buckets.
  if (v_unver + v_dedup) < 1143 then
    raise exception 'PROOF FAILED: buckets sum to % but 1,143 rows meet the shape — rows vanished rather than being classified', v_unver + v_dedup;
  end if;

  raise notice 'PROOF OK: 90d unverified=% deduplicated=% total=%', v_unver, v_dedup, v_unver + v_dedup;
end $do$;
