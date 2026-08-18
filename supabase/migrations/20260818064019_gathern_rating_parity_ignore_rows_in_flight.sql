-- FALSE P1, structurally guaranteed to recur EVERY DAY. mon_detect_gathern_rating_source_truth
-- compares search_listings_ar against gathern_residential_listings.additional_info, but those two
-- are updated by DIFFERENT jobs, and the detector ran in the gap between them:
--
--   04:40-04:47  gh-gathern-daily (jobid 15) re-crawls gathern; 9,896 rows get a fresh
--                additional_info (ratings move as reviews accumulate)
--   04:59        mon-detectors-and-dispatch (jobid 38) compares -> 1,240 rows "diverge" -> P1
--                raised. The last index sync was 04:14, BEFORE the crawl.
--   05:14        sync-search-listings-ar (jobid 28) propagates the new values
--   05:29        next detector sweep -> clean -> alert auto-resolves
--
-- Confirmed from cron.job_run_details and alert_event id 684 (created 04:59:00, resolved 05:29:00 —
-- a 30-minute life). The 1,240 divergent rows are a strict subset of the 9,896 re-crawled in that
-- window. Nothing was wrong with the data: the detector measured across an async boundary. The
-- daily engineer escalated it in good faith as issue #744 at 05:16, mid-window.
--
-- This fires at 04:59 every day, because the crawl always lands between two hourly syncs. A P1 that
-- cries wolf daily on a USER-FACING filter is how a real rating defect eventually gets ignored.
--
-- FIX: make the parity limbs skip rows that are legitimately IN FLIGHT — re-seen by the crawler
-- more recently than the last successful index sync. This is NOT silencing the barrier:
--   * Outside the brief post-crawl window it excludes NOTHING (measured at apply time: 0 of 31,970
--     rows excluded), so sensitivity is unchanged for ~23 hours of every day.
--   * A row whose index entry IS current but still disagrees is NOT in flight, so a genuine sync or
--     parser defect is still caught immediately — that is the case this detector exists for.
--   * The three pure index invariants (rating on a non-gathern platform, reviews without a rating,
--     rating outside the source scale) are NOT gated at all; they cannot be explained by sync lag.
--
-- AND A GUARD ON THE GUARD: if the sync itself stops running, the watermark freezes and the gate
-- would progressively blind the detector — the "monitor that cannot fire reads as clean" trap. So a
-- watermark older than 3 hours (the sync is hourly) raises its own P1 instead of being trusted.

create or replace function public.mon_detect_gathern_rating_source_truth()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parity bigint; v_label bigint; v_nongathern bigint; v_pairing bigint; v_scale bigint;
  v_fresh_total bigint; v_fresh_rated bigint; v_fresh_pct numeric; n int := 0; bad jsonb := '[]'::jsonb;
  v_sync_at timestamptz; v_sync_age interval; v_inflight bigint;
begin
  -- Watermark: when did the index last successfully ingest? Read from pg_cron itself, so there is
  -- no second copy of this fact to drift.
  select max(d.start_time) into v_sync_at
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'sync-search-listings-ar' and d.status = 'succeeded';
  v_sync_age := now() - v_sync_at;

  -- If the sync is missing or stalled, do NOT quietly trust the gate — say so.
  if v_sync_at is null or v_sync_age > interval '3 hours' then
    bad := bad || jsonb_build_object('kind','rating_sync_watermark_stale',
      'last_sync_at', v_sync_at, 'age', coalesce(v_sync_age::text,'never'),
      'why','the hourly sync-search-listings-ar watermark is stale, so the in-flight gate below '
         || 'cannot be trusted and the parity limbs may be blind. Fix the sync, not this detector.');
  end if;

  select count(*) into v_inflight from gathern_residential_listings g
   where v_sync_at is not null and g.last_seen_at > v_sync_at;

  with raw as (
    select g.id, g.last_seen_at,
      case when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
           when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$'
            and (g.additional_info->>'rating')::numeric between 1 and 10
             then round((g.additional_info->>'rating')::numeric,1) end r,
      case when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
           when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$'
            and (g.additional_info->>'rating')::numeric between 1 and 10
            and g.additional_info->>'reviews_count' ~ '^[0-9]+$'
             then (g.additional_info->>'reviews_count')::int end rc,
      nullif(btrim(coalesce(g.additional_info->>'unit_type_ar','')),'') st,
      btrim(coalesce(g.additional_info->>'rate_text','')) label
    from gathern_residential_listings g
  )
  select
    count(*) filter (where s.rating is distinct from raw.r
                        or s.reviews_count is distinct from raw.rc
                        or s.unit_subtype_ar is distinct from raw.st),
    count(*) filter (where raw.label = 'لا يوجد تقييم' and s.rating is not null)
  into v_parity, v_label
  from search_listings_ar s join raw on raw.id = s.listing_id
  where s.source_table = 'gathern_residential_listings'
    -- IN-FLIGHT GATE: re-crawled after the last index sync, so a difference is expected and
    -- transient. Everything else is compared exactly as before.
    and not (v_sync_at is not null and raw.last_seen_at > v_sync_at);

  select count(*) into v_nongathern from search_listings_ar
   where rating is not null and source_table <> 'gathern_residential_listings';
  select count(*) into v_pairing from search_listings_ar
   where reviews_count is not null and rating is null;
  select count(*) into v_scale from search_listings_ar
   where rating is not null and (rating < 1 or rating > 10);

  if v_parity > 0 then bad := bad || jsonb_build_object('kind','index_diverges_from_source','rows',v_parity,
                                        'in_flight_excluded', v_inflight); end if;
  if v_label  > 0 then bad := bad || jsonb_build_object('kind','no_rating_label_ignored','rows',v_label); end if;
  if v_nongathern > 0 then bad := bad || jsonb_build_object('kind','rating_on_non_gathern_platform','rows',v_nongathern); end if;
  if v_pairing > 0 then bad := bad || jsonb_build_object('kind','reviews_without_rating','rows',v_pairing); end if;
  if v_scale > 0 then bad := bad || jsonb_build_object('kind','rating_outside_source_scale','rows',v_scale); end if;

  -- 6. fresh-capture collapse
  select count(*), count(*) filter (where rating is not null)
    into v_fresh_total, v_fresh_rated
  from search_listings_ar
  where source_table='gathern_residential_listings' and production_ready
    and first_seen_at >= now() - interval '7 days';
  if v_fresh_total >= 100 then
    v_fresh_pct := round(100.0 * v_fresh_rated / v_fresh_total, 1);
    -- The standing all-time rate is ~85%. Fresh listings legitimately start unrated (no reviews yet),
    -- so this is a COLLAPSE detector, not a coverage target: it fires only if essentially nothing
    -- fresh carries a rating, which means the capture broke rather than the market changed.
    if v_fresh_pct < 15 then
      bad := bad || jsonb_build_object('kind','fresh_rating_capture_collapse',
        'fresh_rows', v_fresh_total, 'fresh_rated', v_fresh_rated, 'pct', v_fresh_pct);
    end if;
  end if;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1','gathern_rating_source_truth','gathern','gathern_rating_source_truth',
      jsonb_build_object('failures', bad,
        'why','The Gathern rating is a user-facing filter. It must equal the source exactly, must be '
           || 'NULL whenever Gathern says «لا يوجد تقييم», must never appear on a platform that does '
           || 'not publish ratings, and UNKNOWN must never be searchable as rated. Fix the sync or '
           || 'the parser — never the displayed number.'));
  else
    perform public.mon_resolve_key('gathern_rating_source_truth','gathern_rating_source_truth');
  end if;
  return n;
end $function$;

-- Prove it, in both directions.
do $$
declare v int; v_sync timestamptz; v_excluded bigint; v_window bigint; v_diverge bigint;
begin
  -- 1. Clean now, and the gate is costing NOTHING right now (full sensitivity retained).
  select public.mon_detect_gathern_rating_source_truth() into v;
  if v <> 0 then raise exception 'detector raised % on a known-clean state', v; end if;

  select max(d.start_time) into v_sync from cron.job_run_details d
    join cron.job j on j.jobid=d.jobid
   where j.jobname='sync-search-listings-ar' and d.status='succeeded';
  select count(*) into v_excluded from gathern_residential_listings where last_seen_at > v_sync;
  if v_excluded <> 0 then
    raise exception 'gate is excluding % rows outside a crawl window — it must cost nothing here', v_excluded;
  end if;

  -- 2. The gate WOULD have covered the false alarm: every row the 04:40 crawl touched is in flight
  --    against the 04:14 watermark, and the 1,240 divergent rows were a subset of those.
  select count(*) into v_window from gathern_residential_listings
   where last_seen_at > '2026-08-18 04:14:00+00' and last_seen_at <= '2026-08-18 04:59:00+00';
  if v_window < 1240 then
    raise exception 'in-flight set (%) does not cover the 1240 that diverged — gate would not have suppressed it', v_window;
  end if;

  -- 3. A genuine divergence on a NOT-in-flight row must still be visible. Sensitivity check: with
  --    the gate applied, the parity limb still compares essentially the whole table.
  select count(*) into v_diverge from search_listings_ar s
    join gathern_residential_listings g on g.id = s.listing_id
   where s.source_table='gathern_residential_listings'
     and not (v_sync is not null and g.last_seen_at > v_sync);
  if v_diverge < 29000 then
    raise exception 'gate shrank the compared population to % rows — far too few', v_diverge;
  end if;
end $$;
