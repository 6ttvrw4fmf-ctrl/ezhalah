-- price_fidelity(): the headline `mismatches` counted PLATFORMS, not listings.
--
-- THE DEFECT (incident #39, P1). The aggregate ran over an ALREADY-GROUPED subquery:
--
--     select count(*), jsonb_object_agg(platform, cnt)
--       into v_mismatch, v_by_platform
--     from (select platform, count(*) cnt from mm group by platform) q;
--
-- `q` has one row per platform, so `count(*)` is the number of DISTINCT PLATFORMS. Measured live
-- 2026-09-05 05:40 UTC: the payload published `mismatches: 2` beside
-- `by_platform: {mustqr: 2, gathern: 1561}` — a breakdown summing to 1,563.
--
-- This is the dark-detector shape AGENTS.md warns about, in its purest form: the alert thresholds
-- are written against `mismatches`, and that number could never rise above the count of platforms
-- no matter how badly price fidelity degraded. A monitor that cannot see its own subject reads as
-- a clean bill of health.
--
-- THE FIX is `sum(cnt)`. It is strictly STRICTER — the detector now sees 1,563 where it saw 2 —
-- so it weakens nothing. It will alert, and that is the point: incident #40 tracks adjudicating
-- whether the 1,561 gathern rows are dynamic-pricing propagation lag or real fidelity loss. If it
-- turns out to be lag, the DETECTOR gets a sync-window exclusion; it must NOT be silenced by
-- reverting this count.
--
-- `sum()` returns numeric, so it is cast back to bigint to keep the payload's type stable for
-- every threshold and dashboard already reading it. coalesce covers the genuinely-clean case,
-- where the grouped subquery has no rows at all and sum() would return NULL — a clean run must
-- publish 0, never null, or "no mismatches" becomes indistinguishable from "did not measure".
create or replace function public.price_fidelity()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_mismatch bigint; v_by_platform jsonb; v_samples jsonb; v_last_sync timestamptz; v_sync_recent boolean;
begin
  with mm as (
    select s.platform
    from public.search_listings_ar s
    join public.listing_native_location_v2 v
      on v.source_table = s.source_table and v.listing_id = s.listing_id
    where s.price_total  is distinct from v.price_total
       or s.price_annual is distinct from v.price_annual
  )
  select coalesce(sum(cnt), 0)::bigint, coalesce(jsonb_object_agg(platform, cnt) filter (where platform is not null), '{}'::jsonb)
    into v_mismatch, v_by_platform
  from (select platform, count(*) cnt from mm group by platform) q;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_samples from (
    select s.source_table, s.listing_id,
           s.price_total as search_price_total, v.price_total as source_price_total,
           s.price_annual as search_price_annual, v.price_annual as source_price_annual
    from public.search_listings_ar s
    join public.listing_native_location_v2 v on v.source_table=s.source_table and v.listing_id=s.listing_id
    where s.price_total is distinct from v.price_total or s.price_annual is distinct from v.price_annual
    limit 10) x;
  select max(end_time) into v_last_sync from cron.job_run_details where jobid = 28 and status = 'succeeded';
  v_sync_recent := v_last_sync is not null and v_last_sync > now() - interval '90 minutes';
  return jsonb_build_object('mismatches', v_mismatch, 'by_platform', v_by_platform, 'samples', v_samples,
    'last_successful_sync_at', v_last_sync, 'sync_recent', v_sync_recent,
    'source_of_truth', 'listing_native_location_v2 (mirrors raw *_listings; price is a hard filter + primary display)',
    'measured_at', now());
end $function$;