-- THE GUARD ON THE GUARD, for the predicate that now decides whether a price mismatch is a defect.
--
-- The migration before this one gave price_fidelity() a confirmation test: a mismatch counts as a
-- defect only when an earlier observation saw the SAME source price, a sync pass has COMPLETED since,
-- and search still disagrees. Everything turns on that predicate. Written inline inside a CTE it
-- could only ever be read, never executed against a case chosen to break it -- and this repo's
-- standing lesson is that a barrier which reads source text passes for exactly as long as the defect
-- is live (AGENTS.md: "Barriers for this class must EXECUTE the function against an injected
-- failure"). So the predicate is lifted out PURE and the self-test runs the REAL one.
--
--   price_drift_confirmed(...)                    <- PURE. Decides. Writes nothing. Takes injected
--                                                    values, so it can be run against any case.
--   price_fidelity()                              <- CALLS it. The production decision and the
--                                                    tested decision are now the same code.
--   mon_detect_price_drift_predicate_is_blind()   <- NEW. Executes it both directions and raises if
--                                                    it stops telling them apart.
--
-- BOTH DIRECTIONS, because either half alone is worthless. A predicate that answered "confirmed" to
-- everything would satisfy the positive case and reinstate the 45-false-P1-a-month behaviour this
-- replaced; one that answered "never" would satisfy every negative case and silently switch the
-- detector off, which is the failure mode AGENTS.md calls a dark detector reading as a clean bill of
-- health. The negative control that matters most is NEGATIVE B: it is the aqarmonthly case measured
-- on 2026-09-27, the exact shape that produced those false P1s.

create or replace function public.price_drift_confirmed(
  p_probe_src_total  numeric,
  p_probe_src_annual numeric,
  p_probe_sync_at    timestamptz,
  p_cur_src_total    numeric,
  p_cur_src_annual   numeric,
  p_last_sync        timestamptz)
returns boolean
language sql
immutable
as $function$
  -- A sync pass completed AFTER the observation (so it necessarily read the source row), and the
  -- source still publishes exactly what that observation recorded (so the value the sync read is the
  -- value still standing). The caller has already established that search disagrees with it.
  select p_last_sync     is not null
     and p_probe_sync_at is not null
     and p_probe_sync_at  <  p_last_sync
     and p_probe_src_total  is not distinct from p_cur_src_total
     and p_probe_src_annual is not distinct from p_cur_src_annual;
$function$;

comment on function public.price_drift_confirmed(numeric,numeric,timestamptz,numeric,numeric,timestamptz) is
  'PURE confirmation test for price_fidelity(): is this price mismatch PROVEN stuck rather than ordinary crawl/sync interleaving? Executed against injected cases by mon_detect_price_drift_predicate_is_blind().';

-- price_fidelity(), identical to the version applied minutes ago except that the inline confirmation
-- test is replaced by a call to the pure predicate above. Nothing else changes.
create or replace function public.price_fidelity()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_last_sync timestamptz; v_sync_recent boolean; v_result jsonb;
begin
  -- ops_incident #37: "the cron job succeeded" is NOT "the sync wrote". Read the writer's own
  -- record, which sync_search_listings_ar() writes only past its single-writer lock gate.
  select refreshed_at into v_last_sync
    from public.mon_mv_refresh_log where object_name = 'search_listings_ar_sync_pass';
  v_sync_recent := v_last_sync is not null and v_last_sync > now() - interval '90 minutes';

  with mm as (
    select s.platform, s.source_table, s.listing_id,
           s.price_total as idx_total, s.price_annual as idx_annual,
           v.price_total as src_total, v.price_annual as src_annual,
           exists (
             select 1 from public.ops_price_drift_probe p
              where p.source_table = s.source_table
                and p.listing_id   = s.listing_id
                and public.price_drift_confirmed(
                      p.src_total, p.src_annual, p.sync_pass_at,
                      v.price_total, v.price_annual, v_last_sync)) as confirmed
    from public.search_listings_ar s
    join public.listing_native_location_v2 v
      on v.source_table = s.source_table and v.listing_id = s.listing_id
    where s.price_total  is distinct from v.price_total
       or s.price_annual is distinct from v.price_annual
  ),
  -- 'mismatches' counts LISTINGS, not platforms (ops_incident #36), and stays paired with
  -- 'by_platform' over the same set.
  agg as (
    select coalesce(sum(cnt), 0)::bigint as tot,
           coalesce(jsonb_object_agg(platform, cnt) filter (where platform is not null), '{}'::jsonb) as byp
      from (select platform, count(*) cnt from mm group by platform) q),
  cagg as (
    select coalesce(sum(cnt), 0)::bigint as tot,
           coalesce(jsonb_object_agg(platform, cnt) filter (where platform is not null), '{}'::jsonb) as byp
      from (select platform, count(*) cnt from mm where confirmed group by platform) q),
  samp as (
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as j from (
      select source_table, listing_id,
             idx_total as search_price_total,   src_total  as source_price_total,
             idx_annual as search_price_annual, src_annual as source_price_annual
        from mm limit 10) x),
  csamp as (
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as j from (
      select source_table, listing_id, platform,
             idx_total as search_price_total,   src_total  as source_price_total,
             idx_annual as search_price_annual, src_annual as source_price_annual
        from mm where confirmed limit 10) x)
  select jsonb_build_object(
    'mismatches', agg.tot, 'by_platform', agg.byp, 'samples', samp.j,
    'confirmed_stuck', cagg.tot,
    'confirmed_by_platform', cagg.byp,
    'confirmed_samples', csamp.j,
    'pending_lag', agg.tot - cagg.tot,
    'last_successful_sync_at', v_last_sync, 'sync_recent', v_sync_recent,
    'sync_evidence', 'mon_mv_refresh_log.search_listings_ar_sync_pass — the pass that actually ran the upsert, NOT cron job status',
    'source_of_truth', 'listing_native_location_v2 (mirrors raw *_listings; price is a hard filter + primary display)',
    'confirmed_meaning', 'confirmed_stuck = an earlier observation saw this same source price, a sync pass has completed since, and the index still disagrees — so the sync had the value and did not write it. pending_lag = first sighting or the source moved again; the next pass is expected to converge it and is not a defect.',
    'measured_at', now())
    into v_result
  from agg, cagg, samp, csamp;

  return v_result;
end $function$;

create or replace function public.mon_detect_price_drift_predicate_is_blind()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; blind text[] := '{}';
  t1 constant timestamptz := '2026-09-27 06:22:00+00';  -- sync pass at the observation
  t2 constant timestamptz := '2026-09-27 07:22:00+00';  -- a later, completed sync pass
begin
  -- POSITIVE: the thing it exists to notice. The source has published 1,000,000 all along, a sync
  -- pass ran after we last saw that, and the index still disagrees => the sync had the value and
  -- did not write it.
  if not public.price_drift_confirmed(1000000, null, t1, 1000000, null, t2) then
    blind := blind || 'a PROVEN stuck row (source unchanged, a sync pass completed since) was not confirmed';
  end if;
  -- The same, on the annual column, so a repair that only handles price_total cannot pass.
  if not public.price_drift_confirmed(null, 332046, t1, null, 332046, t2) then
    blind := blind || 'a PROVEN stuck row on price_annual was not confirmed';
  end if;

  -- NEGATIVE A: no sync pass has completed since the observation. Nothing has had a chance to be
  -- wrong yet.
  if public.price_drift_confirmed(1000000, null, t2, 1000000, null, t2) then
    blind := blind || 'a mismatch with NO sync pass since the observation was confirmed as stuck';
  end if;

  -- NEGATIVE B -- THE ONE THIS WAS BUILT FOR. The source moved again between the observation and
  -- now, so the value the sync wrote was already superseded. This is the aqarmonthly shape measured
  -- 2026-09-27 (probe saw 333,195; source now 332,046), 278 rows of it, every one of which converged
  -- on a single ordinary sync pass. If this returns true the detector is back to a P1 a day.
  if public.price_drift_confirmed(333195, null, t1, 332046, null, t2) then
    blind := blind || 'ordinary crawl/sync interleaving (the source changed again) was confirmed as stuck -- the false-P1 class is back';
  end if;
  if public.price_drift_confirmed(null, 333195, t1, null, 332046, t2) then
    blind := blind || 'ordinary interleaving on price_annual was confirmed as stuck';
  end if;

  -- NEGATIVE C: no sync evidence at all. Absence cannot be compared, so it must not be read as
  -- proof of anything (AGENTS.md, LISTING_LIVENESS §9).
  if public.price_drift_confirmed(1000000, null, t1, 1000000, null, null) then
    blind := blind || 'a mismatch with NO recorded sync pass was confirmed as stuck';
  end if;

  -- NEGATIVE D: one column held still while the other moved. A partial match is not a match.
  if public.price_drift_confirmed(1000000, 500000, t1, 1000000, 600000, t2) then
    blind := blind || 'a row whose annual price moved was confirmed on the strength of its total alone';
  end if;

  if array_length(blind, 1) > 0 then
    n := public.mon_raise('P1', 'price_drift_predicate_blind', 'all', 'price_drift_predicate_blind',
      jsonb_build_object('failures', to_jsonb(blind), 'count', array_length(blind, 1),
        'why', 'price_drift_confirmed() no longer separates a PROVEN stuck price from ordinary '
            || 'crawl/sync interleaving. Either price_fidelity() is about to resume raising a P1 a '
            || 'day on cadence (masking real drift on other platforms, since mon_raise dedups per '
            || 'key), or it has gone dark and a genuinely stuck price will never be raised at all. '
            || 'The named failures say which direction.',
        'measured_at', now()));
  else
    perform public.mon_resolve('price_drift_predicate_blind', 'all');
  end if;
  return n;
end $function$;

-- Reached on the same cadence as the thing it guards: mon_detect_price_fidelity() runs hourly on
-- cron jobid 42, and the guard on a guard is worth nothing if it runs less often than the guard.
-- Appended by a needle edit rather than a full-body replace so a concurrent session's change to this
-- function cannot be clobbered (the pattern of 20260817072028).
do $mig$
declare def text; anchor constant text := '  perform public.price_fidelity_advance_probe();'; a int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_detect_price_fidelity';
  if def is null then
    raise exception 'mon_detect_price_fidelity() not found -- refusing to wire the self-test blind';
  end if;
  if position('mon_detect_price_drift_predicate_is_blind' in def) > 0 then
    return;   -- already wired; idempotent re-apply
  end if;
  a := position(anchor in def);
  if a = 0 then
    raise exception 'needle anchor not found in the LIVE mon_detect_price_fidelity() -- refusing to full-body-replace it';
  end if;
  def := substr(def, 1, a - 1)
      || '  -- The guard on the guard: prove the confirmation predicate still tells a proven-stuck' || chr(10)
      || '  -- price apart from ordinary crawl/sync interleaving, every time we rely on it.' || chr(10)
      || '  n := n + public.mon_detect_price_drift_predicate_is_blind();' || chr(10)
      || anchor
      || substr(def, a + length(anchor));
  execute def;
end $mig$;
