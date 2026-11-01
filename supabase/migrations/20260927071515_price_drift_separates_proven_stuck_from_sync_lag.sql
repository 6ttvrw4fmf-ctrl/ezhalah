-- PRICE DRIFT: TELL "THE SYNC HAS NOT GOT THERE YET" APART FROM "THE SYNC HAD ITS CHANCE AND FAILED".
--
-- THE DEFECT (routine #3, 2026-09-27). price_fidelity() computed a raw set difference between
-- search_listings_ar and listing_native_location_v2 and mon_detect_price_fidelity() thresholded the
-- row count at >250 -> P1, >25 -> P2, under the payload text "search is serving stale/incorrect
-- prices". Nothing in the predicate asked the one question that separates a defect from ordinary
-- cadence: had the sync ALREADY SEEN the source value it is accused of not serving?
--
-- It had not, essentially every time. Measured this run: 282 rows mismatched at 07:07Z; ONE ordinary
-- sync_search_listings_ar() pass took every one of them to 0 (aqarmonthly 278 -> 0, abralosol 4 -> 0).
-- The scrape that wrote those rows ran 06:17-06:24Z, straddling the 06:22 sync, so the sync committed
-- a snapshot that was already superseded before the 06:47 detector read it. That is the crawl and the
-- hourly sync interleaving, not a fidelity fault.
--
-- The history says the same thing 45 times: 45 price_drift alerts since 2026-09-05, 44 resolved, the
-- overwhelming majority within a single sync cycle, and the platform set swinging wildly between
-- sweeps (gathern 2,996 -> aqar 958 -> ksaaqar 834 -> aqarmonthly 278). A P1 a day, self-healing.
--
-- WHY THAT IS A BUG AND NOT MERELY NOISE -- THE MASKING. mon_raise() keeps exactly one open row per
-- dedup key, and this detector used the single global key 'price_drift', banded only by the FLEET-WIDE
-- total. So while a P1 stood open on one platform's transient lag, a genuinely stuck cohort on any
-- other platform raised NOTHING: the key was already open and the count band did not move. The
-- payload's own numbers prove the band cannot serve as a change signal -- it swings by thousands on
-- cadence alone. The condition this detector exists to catch has therefore never been observable,
-- which is the shape AGENTS.md names: absence cannot be compared, so silence reads as health.
--
-- THE REPAIR. A row is PROVEN STUCK only when the sync demonstrably had the value and did not write
-- it: an earlier observation recorded the source value, a sync pass has COMPLETED since that
-- observation, the source STILL publishes exactly that value, and the index still disagrees. Then the
-- sync read that value and left the index wrong -- no timing story can explain it. Everything else is
-- PENDING (first sighting, or the source moved again), reported and not raised.
--
-- ops_price_drift_probe is what makes that a measurement rather than an inference: it remembers the
-- source value each observation saw, alongside the sync-pass timestamp AT that moment. The per-row
-- "when did raw change" signal does not exist on listing_native_location_v2 (no last_seen_at), and
-- widening that heavily-read view to get one would be a far larger change than the question needs.
--
-- WHAT THIS DOES NOT WEAKEN (AGENTS.md / ENGINEER_ROUTINES.md §G.7). A sync that STOPS is covered
-- independently and still is: mon_detect_stale_refresh() reads the sync's own
-- mon_mv_refresh_log.search_listings_ar_sync_pass row, mon_detect_search_writer_starved() watches the
-- writer lock, and mon_detect_sync_ran_against_stale_snapshot() watches the snapshot it read. This
-- change only stops calling ordinary cadence a P1 -- and makes the real class raiseable for the first
-- time, per platform, so one platform can no longer hide another.
--
-- 'mismatches' and 'by_platform' KEEP their meaning (the full population, one set summarised twice)
-- because scripts/verify-detector-total-matches-its-breakdown-live.ts holds that pair to
-- total == sum(breakdown) and goes UNPAIRABLE on a second by_* key. The new cohort is therefore
-- published as confirmed_stuck / pending_lag / confirmed_by_platform / confirmed_samples -- none of
-- which is a TOTAL_KEYS name or a by_* key, so that barrier keeps binding exactly what it bound.

create table if not exists public.ops_price_drift_probe (
  source_table      text        not null,
  listing_id        bigint      not null,
  platform          text,
  src_total         numeric,
  src_annual        numeric,
  idx_total         numeric,
  idx_annual        numeric,
  -- The sync-pass timestamp as it stood WHEN THIS OBSERVATION WAS TAKEN. Confirmation compares it
  -- against the current pass timestamp; that strict inequality is the whole proof that a sync ran
  -- in between and therefore had the source value below in hand.
  sync_pass_at      timestamptz not null,
  first_observed_at timestamptz not null default now(),
  observed_at       timestamptz not null default now(),
  primary key (source_table, listing_id)
);

comment on table public.ops_price_drift_probe is
  'Per-row memory for price_fidelity(): the source price an earlier observation saw, plus the sync-pass timestamp at that moment. Lets a proven-stuck row be told apart from ordinary crawl/sync interleaving. Written only by price_fidelity_advance_probe() (called from mon_detect_price_fidelity()); price_fidelity() itself stays read-only so a live barrier can call it without mutating state.';

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
           -- PROVEN STUCK: an earlier observation recorded this same source value, a sync pass has
           -- COMPLETED since that observation, and the index still disagrees. The sync therefore
           -- read this value and left search wrong -- no timing story can explain that.
           exists (
             select 1 from public.ops_price_drift_probe p
              where p.source_table = s.source_table
                and p.listing_id   = s.listing_id
                and v_last_sync is not null
                and p.sync_pass_at < v_last_sync
                and p.src_total  is not distinct from v.price_total
                and p.src_annual is not distinct from v.price_annual) as confirmed
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

-- Records the CURRENT mismatch set as the next observation. Separate from price_fidelity() so that
-- reading the metric never mutates the evidence it is read against: a live barrier calls the
-- read-only function, and only the hourly detector advances the probe.
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

  insert into public.ops_price_drift_probe as p
    (source_table, listing_id, platform, src_total, src_annual, idx_total, idx_annual, sync_pass_at, observed_at)
  select s.source_table, s.listing_id, s.platform,
         v.price_total, v.price_annual, s.price_total, s.price_annual, v_last_sync, now()
  from public.search_listings_ar s
  join public.listing_native_location_v2 v
    on v.source_table = s.source_table and v.listing_id = s.listing_id
  where s.price_total  is distinct from v.price_total
     or s.price_annual is distinct from v.price_annual
  on conflict (source_table, listing_id) do update set
    platform = excluded.platform,
    src_total = excluded.src_total, src_annual = excluded.src_annual,
    idx_total = excluded.idx_total, idx_annual = excluded.idx_annual,
    sync_pass_at = excluded.sync_pass_at,
    observed_at = excluded.observed_at;   -- first_observed_at deliberately preserved
  get diagnostics n = row_count;

  -- A row that has converged is no longer evidence of anything. Drop it so a future mismatch on the
  -- same listing starts its own clock instead of inheriting a stale observation and confirming on
  -- sight.
  delete from public.ops_price_drift_probe p
   where not exists (
     select 1 from public.search_listings_ar s
     join public.listing_native_location_v2 v
       on v.source_table = s.source_table and v.listing_id = s.listing_id
      where s.source_table = p.source_table and s.listing_id = p.listing_id
        and (s.price_total is distinct from v.price_total or s.price_annual is distinct from v.price_annual));
  return n;
end $function$;

create or replace function public.mon_detect_price_fidelity()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s jsonb; v_target text; v_open_sev text; n int := 0;
        v_dropped bigint; v_ppm_target text; v_ppm_open_sev text;
        v_confirmed bigint; rec record;
begin
  s := public.price_fidelity();
  insert into public.price_fidelity_snapshot (id, payload, taken_at) values (1, s, now())
    on conflict (id) do update set payload = excluded.payload, taken_at = excluded.taken_at;

  v_confirmed := (s->>'confirmed_stuck')::bigint;

  -- PER PLATFORM, so one platform's transient lag can no longer hold the only dedup key open and
  -- hide a genuinely stuck cohort somewhere else. Thresholded on the PROVEN cohort only: a
  -- pending row is the crawl and the sync interleaving, which the next pass converges.
  for rec in select key as platform, value::text::bigint as cnt
               from jsonb_each(s->'confirmed_by_platform') loop
    if    rec.cnt >= 25 then v_target := 'P1';
    elsif rec.cnt >=  1 then v_target := 'P2';
    else  v_target := null; end if;
    select severity into v_open_sev from public.alert_event
     where dedup_key = 'price_drift:' || rec.platform and resolved_at is null
     order by created_at desc limit 1;
    if v_target is not null and v_open_sev is distinct from v_target then
      if v_open_sev is not null then perform public.mon_resolve('price_drift', rec.platform); end if;
      n := n + public.mon_raise(v_target, 'price_drift', rec.platform, 'price_drift:' || rec.platform,
        s || jsonb_build_object('platform', rec.platform, 'confirmed_stuck_this_platform', rec.cnt,
          'why', format('%s listing(s) on %s are PROVEN stuck: an earlier observation saw the same source price, a sync pass has completed since, and search still serves a different one. The sync had the value and did not write it.', rec.cnt, rec.platform)));
    end if;
  end loop;

  -- Resolve any open price_drift row whose platform is now clean, including the LEGACY global row
  -- (raised with platform='price_fidelity' before this split existed).
  for rec in select distinct platform from public.alert_event
              where kind = 'price_drift' and resolved_at is null and platform is not null loop
    if rec.platform = 'price_fidelity'
       or coalesce((s->'confirmed_by_platform'->>rec.platform)::bigint, 0) = 0 then
      perform public.mon_resolve('price_drift', rec.platform);
    end if;
  end loop;

  perform public.price_fidelity_advance_probe();

  -- ppm_source_dropped: the source PUBLISHES «سعر المتر» but we store NULL. Predicate unchanged.
  -- The resolve arm's platform is corrected from 'price_fidelity' to 'aqar' to MATCH the platform
  -- mon_raise() writes below: mon_resolve() matches on (kind, platform), so the old pairing could
  -- never clear its own alert. Latent, not live -- no ppm_source_dropped row is open today.
  select count(*) into v_dropped from (
    select 1 from public.aqar_residential_listings
      where active and price_per_meter is null
        and source_capture->>'source_text' like '%سعر المتر%'
        and public.aqar_published_ppm(source_capture->>'source_text') is not null
    union all
    select 1 from public.aqar_commercial_listings
      where active and price_per_meter is null
        and source_capture->>'source_text' like '%سعر المتر%'
        and public.aqar_published_ppm(source_capture->>'source_text') is not null
  ) d;
  if v_dropped > 200 then v_ppm_target := 'P2'; else v_ppm_target := null; end if;
  select severity into v_ppm_open_sev from public.alert_event
   where dedup_key = 'ppm_source_dropped' and resolved_at is null order by created_at desc limit 1;
  if v_ppm_target is null then
    if v_ppm_open_sev is not null then perform public.mon_resolve('ppm_source_dropped','aqar'); end if;
  elsif v_ppm_open_sev is distinct from v_ppm_target then
    if v_ppm_open_sev is not null then perform public.mon_resolve('ppm_source_dropped','aqar'); end if;
    n := n + public.mon_raise(v_ppm_target, 'ppm_source_dropped', 'aqar', 'ppm_source_dropped',
      jsonb_build_object('dropped_rows', v_dropped,
        'why','A source-published «سعر المتر» is stored as NULL. The page prints a per-meter price and Ezhalah is discarding it (regression of the 2026-07-26 trg_aqar_parse fidelity fix).'));
  end if;

  return n;
end $function$;
