-- Correcting mon_detect_sync_pass_left_rows_unindexed() from the SAME run that shipped it.
--
-- As first written it measured an INSTANT: "rows in listing_native_location_v2 with a buy/rent deal
-- that are not in search_listings_ar right now". That cohort is never legitimately empty between
-- passes -- rows keep entering v2 while the index only moves when jobid 28 runs hourly at :22. The
-- settled-window gate does not help: at the :59 roster sweep the last pass finished ~:24, the gate
-- opens, and every row scraped in the intervening 35 minutes reads as a defect.
--
-- That is exactly §24b ("a barrier must measure the thing it protects, never a downstream stage's
-- clock") and §23a: a detector that is red for half of every hour cannot report the real thing,
-- because mon_raise() returns 0 for a dedup key that is already open. Caught before the first
-- false raise, by asking what the cohort's membership actually depends on rather than by watching
-- it flap.
--
-- The fix is to measure a DURATION. ops_sync_unindexed_watch starts a clock the first time a row is
-- observed missing in a settled window and clears it the moment the row is indexed. Only a row that
-- has stayed missing for 90 minutes -- long enough to have had a full hourly pass, with runtime to
-- spare -- is a propagation failure. §3's "stuck longer than its expected propagation SLA", with
-- one sync cycle as the SLA, stated rather than assumed.
--
-- Against the defect this was born from: the arkaan cohort would first be clocked at the 05:59
-- settled window and raise at 07:29, inside the 2h12m the rows were actually unreachable.

create table if not exists public.ops_sync_unindexed_watch (
  source_table     text        not null,
  listing_id       bigint      not null,
  first_missing_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);

comment on table public.ops_sync_unindexed_watch is
  'Per-row clock for mon_detect_sync_pass_left_rows_unindexed(). A row enters when it is first seen '
  'in v2 but not in search_listings_ar during a settled window, and leaves the moment it is indexed. '
  'Age here is how long a listing has been unreachable, which is the thing worth alerting on -- the '
  'instantaneous cohort is never empty between hourly passes and would flap (§24b).';

create or replace function public.mon_detect_sync_pass_left_rows_unindexed()
returns int language plpgsql as $fn$
declare
  n int := 0;
  v_fin timestamptz;
  v_status text;
  v_stuck bigint;
  v_watching bigint;
  v_samples jsonb;
begin
  select d.end_time, d.status into v_fin, v_status
    from cron.job_run_details d
   where d.jobid = 28
   order by d.start_time desc
   limit 1;

  -- Not a settled window: do not evaluate, do NOT resolve, and do not touch the clocks (§23a).
  if v_fin is null or v_status is distinct from 'succeeded'
     or v_fin > now() - interval '10 minutes'
     or v_fin < now() - interval '55 minutes' then
    return 0;
  end if;

  create temp table _unindexed on commit drop as
  select v.source_table, v.listing_id, v.platform, v.production_ready
    from public.listing_native_location_v2 v
   where lower(v.transaction_type) in ('buy','rent')
     and not exists (select 1 from public.search_listings_ar s
                      where s.source_table = v.source_table and s.listing_id = v.listing_id);

  -- A row that reached the index stops the clock. This runs BEFORE the insert so a row that is
  -- indexed and later legitimately re-enters the cohort starts a fresh clock rather than inheriting
  -- an old one.
  delete from public.ops_sync_unindexed_watch w
   where not exists (select 1 from _unindexed u
                      where u.source_table = w.source_table and u.listing_id = w.listing_id);

  insert into public.ops_sync_unindexed_watch (source_table, listing_id)
  select u.source_table, u.listing_id from _unindexed u
  on conflict (source_table, listing_id) do nothing;

  select count(*) into v_watching from public.ops_sync_unindexed_watch;

  select count(*), coalesce(jsonb_agg(to_jsonb(x) order by x.first_missing_at) filter (where x.rn <= 20), '[]'::jsonb)
    into v_stuck, v_samples
  from (
    select w.source_table, w.listing_id, w.first_missing_at,
           round(extract(epoch from now() - w.first_missing_at) / 60)::int minutes_unreachable,
           row_number() over (order by w.first_missing_at) rn
      from public.ops_sync_unindexed_watch w
     where w.first_missing_at < now() - interval '90 minutes'
  ) x;

  if v_stuck > 0 then
    n := n + public.mon_raise('P1', 'sync_pass_left_rows_unindexed', 'search',
      'sync_pass_left_rows_unindexed',
      jsonb_build_object(
        'stuck', v_stuck,
        'watching', v_watching,
        'samples', v_samples,
        'last_pass_finished', v_fin,
        'why', 'These listings have been in listing_native_location_v2 with a buy/rent deal, and '
            || 'absent from the served index, for over 90 minutes -- more than a full hourly sync '
            || 'cycle. They are in no user-facing result: not the Normal Filter, not a city or '
            || 'district count, not Trending. Ezhalah holds them and no user can reach them.',
        'action', 'Read cron.job_run_details for jobid 28: a pass that FAILED rolls back its own '
            || 'INSERT, and a pass that started before jobid 17 committed its REFRESH read a stale '
            || 'snapshot and skipped rows while still reporting success (ops_incident #354).',
        'do_not', 'Do NOT insert into search_listings_ar by hand. sync_search_listings_ar() is its '
            || 'only writer; a hand-written row is not reproducible and drifts on the next pass. '
            || 'Do NOT widen the 90-minute clock to silence this -- that is the SLA, not a knob.'));
  else
    perform public.mon_resolve_stale_keys('sync_pass_left_rows_unindexed', array[]::text[]);
  end if;

  return n;
end $fn$;

comment on function public.mon_detect_sync_pass_left_rows_unindexed() is
  'P1. Every listing_native_location_v2 row with a buy/rent deal must reach search_listings_ar '
  'within one hourly sync cycle. Measures a DURATION via ops_sync_unindexed_watch (90-minute SLA), '
  'not the instantaneous cohort, which is never empty between passes and would flap (§24b). '
  'Evaluates only in a settled window (last jobid-28 pass succeeded, finished 10..55 min ago) and '
  'never resolves on a path it did not evaluate (§23a). Measured cost 2026-09-20: ~7.25 s idle; '
  '60 s+ is a real regression. Born from the 2026-09-20 arkaan cohort: 16 rows unreachable 2h12m.';
