-- price_fidelity() MUST NOT REPORT THE SANITY TRIGGER'S OWN DELIBERATE WRITE AS DRIFT.
--
-- Caught in the same run that created it (routine #3, 2026-09-27). 20260927074523 taught
-- enforce_price_size_sanity() to drop an exact price mirror from the column its deal type does not
-- use. That write is intentional and correct -- but price_fidelity() compares search_listings_ar
-- against listing_native_location_v2 RAW, and v2 still publishes the mirrored figure. So the four
-- repaired rows (abeea 1, satel 1, mustqr 2) immediately showed up as a price mismatch: the
-- 07:47 snapshot read `mismatches: 4, pending_lag: 4` on exactly those platforms.
--
-- Left alone this would have become WORSE than noise. The sync re-writes price_total from v2 on every
-- pass and the trigger nulls it again, so the difference is permanent; and the new confirmation test
-- would have found, on the very next observation, an unchanged source value across a completed sync
-- pass with the index still disagreeing -- the definition of PROVEN STUCK. The detector built this
-- morning to stop crying wolf would have started raising a P2 per platform, for ever, over a write
-- the system makes on purpose. A self-inflicted alert that can never be resolved is precisely the
-- 'unresolvable alert kind' shape this repo already carries five of.
--
-- THE FIX. Compare the index against what the write path is SUPPOSED to produce, not against the raw
-- view: run the v2 side through the same price_inapplicable_mirror() the trigger uses, then compare.
-- One predicate, one definition of the expected value, used by the writer and by the checker -- so
-- they cannot disagree. A REAL stale price still shows, because normalisation only ever clears a
-- column the trigger itself would have cleared.
--
-- v2 has no deal_ar, so the deal is derived from transaction_type exactly as sync_search_listings_ar()
-- derives it (buy -> بيع, rent -> إيجار); anything else yields NULL and normalises nothing, which is
-- the safe direction.

create or replace function public.price_fidelity_expected(
  p_transaction_type text, p_total numeric, p_annual numeric)
returns record
language sql
immutable
as $function$
  -- The (price_total, price_annual) pair the sanity trigger would leave in search_listings_ar for
  -- this source row. Same predicate as the trigger; see 20260927074523.
  select exp_total, exp_annual from (
    select case when m = 'price_total'  then null else p_total  end as exp_total,
           case when m = 'price_annual' then null else p_annual end as exp_annual
      from (select public.price_inapplicable_mirror(
                     case when lower(p_transaction_type) = 'buy'  then 'بيع'
                          when lower(p_transaction_type) = 'rent' then 'إيجار' end,
                     p_total, p_annual) as m) k
  ) q;
$function$;

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

  with src as (
    select v.platform, v.source_table, v.listing_id,
           -- EXPECTED, not raw: the pair the sanity trigger would leave behind. Without this the
           -- trigger's own deliberate mirror-drop reads as drift (see this migration's header).
           case when public.price_inapplicable_mirror(
                       case when lower(v.transaction_type)='buy' then 'بيع'
                            when lower(v.transaction_type)='rent' then 'إيجار' end,
                       v.price_total, v.price_annual) = 'price_total'
                then null else v.price_total end  as src_total,
           case when public.price_inapplicable_mirror(
                       case when lower(v.transaction_type)='buy' then 'بيع'
                            when lower(v.transaction_type)='rent' then 'إيجار' end,
                       v.price_total, v.price_annual) = 'price_annual'
                then null else v.price_annual end as src_annual
      from public.listing_native_location_v2 v
  ),
  mm as (
    select s.platform, s.source_table, s.listing_id,
           s.price_total as idx_total, s.price_annual as idx_annual,
           x.src_total, x.src_annual,
           exists (
             select 1 from public.ops_price_drift_probe p
              where p.source_table = s.source_table
                and p.listing_id   = s.listing_id
                and public.price_drift_confirmed(
                      p.src_total, p.src_annual, p.sync_pass_at,
                      x.src_total, x.src_annual, v_last_sync)) as confirmed
    from public.search_listings_ar s
    join src x on x.source_table = s.source_table and x.listing_id = s.listing_id
    where s.price_total  is distinct from x.src_total
       or s.price_annual is distinct from x.src_annual
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
    'source_of_truth', 'listing_native_location_v2, NORMALISED through price_inapplicable_mirror() so the sanity trigger''s own deliberate mirror-drop is not counted as drift',
    'confirmed_meaning', 'confirmed_stuck = an earlier observation saw this same source price, a sync pass has completed since, and the index still disagrees — so the sync had the value and did not write it. pending_lag = first sighting or the source moved again; the next pass is expected to converge it and is not a defect.',
    'measured_at', now())
    into v_result
  from agg, cagg, samp, csamp;

  return v_result;
end $function$;

-- The probe must remember the SAME normalised value the checker compares against, or a row would be
-- confirmed against a figure that was never the expectation.
create or replace function public.price_fidelity_advance_probe()
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_last_sync timestamptz; n bigint;
begin
  select refreshed_at into v_last_sync
    from public.mon_mv_refresh_log where object_name = 'search_listings_ar_sync_pass';
  if v_last_sync is null then return 0; end if;   -- no sync evidence => nothing can be proven yet

  with src as (
    select v.platform, v.source_table, v.listing_id,
           case when public.price_inapplicable_mirror(
                       case when lower(v.transaction_type)='buy' then 'بيع'
                            when lower(v.transaction_type)='rent' then 'إيجار' end,
                       v.price_total, v.price_annual) = 'price_total'
                then null else v.price_total end  as src_total,
           case when public.price_inapplicable_mirror(
                       case when lower(v.transaction_type)='buy' then 'بيع'
                            when lower(v.transaction_type)='rent' then 'إيجار' end,
                       v.price_total, v.price_annual) = 'price_annual'
                then null else v.price_annual end as src_annual
      from public.listing_native_location_v2 v
  )
  insert into public.ops_price_drift_probe as p
    (source_table, listing_id, platform, src_total, src_annual, idx_total, idx_annual, sync_pass_at, observed_at)
  select s.source_table, s.listing_id, s.platform,
         x.src_total, x.src_annual, s.price_total, s.price_annual, v_last_sync, now()
  from public.search_listings_ar s
  join src x on x.source_table = s.source_table and x.listing_id = s.listing_id
  where s.price_total  is distinct from x.src_total
     or s.price_annual is distinct from x.src_annual
  on conflict (source_table, listing_id) do update set
    platform = excluded.platform,
    src_total = excluded.src_total, src_annual = excluded.src_annual,
    idx_total = excluded.idx_total, idx_annual = excluded.idx_annual,
    sync_pass_at = excluded.sync_pass_at,
    observed_at = excluded.observed_at;   -- first_observed_at deliberately preserved
  get diagnostics n = row_count;

  -- A row that has converged is no longer evidence of anything. Drop it so a future mismatch on the
  -- same listing starts its own clock instead of inheriting a stale observation and confirming on
  -- sight. This is also what clears the four rows the mirror repair briefly made look drifted.
  delete from public.ops_price_drift_probe p
   where not exists (
     select 1
       from public.search_listings_ar s
       join public.listing_native_location_v2 v
         on v.source_table = s.source_table and v.listing_id = s.listing_id
      where s.source_table = p.source_table and s.listing_id = p.listing_id
        and (s.price_total is distinct from
               (case when public.price_inapplicable_mirror(
                            case when lower(v.transaction_type)='buy' then 'بيع'
                                 when lower(v.transaction_type)='rent' then 'إيجار' end,
                            v.price_total, v.price_annual) = 'price_total'
                     then null else v.price_total end)
          or s.price_annual is distinct from
               (case when public.price_inapplicable_mirror(
                            case when lower(v.transaction_type)='buy' then 'بيع'
                                 when lower(v.transaction_type)='rent' then 'إيجار' end,
                            v.price_total, v.price_annual) = 'price_annual'
                     then null else v.price_annual end)));
  return n;
end $function$;

drop function if exists public.price_fidelity_expected(text, numeric, numeric);
