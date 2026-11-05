-- ⚡ 2026-11-05 — DEALAPP ZERO-PADDED TWINS (backlog 1328, alert served_price_never_rechecked:dealapp_residential_listings).
--
-- Measured 05:3x UTC: the two dealapp rows the alert names (ids 1143135 «DA089639», 3063334 «DA062037», last seen
-- 2026-07-30 / 2026-07-20) are an OLD zero-padded ad_number of ads the crawl now writes unpadded: ids 6236699
-- «DA89639» and 3462088 «DA62037», both active, last seen 2026-11-05 01:15–01:29 UTC, same /ad-details/ page
-- (CI source-reread 41972383274: both pages 200, alive). enumerate_ids() canonicalises every id to str(int(..)), so
-- the padded row is never re-written; it sat served beside its fresh twin for 3+ months with a price nobody re-read
-- — the same ad shown twice. They are the only 2 «DA0…» rows in either dealapp table (both active, both served).
--
-- Repair: retire the stale padded twin (its own ad is still live and served through the fresh row), and record it in
-- ops_adjudicated_retraction so auto_recover_false_inactive() reads it as a decision, not an accident.
-- Guard: mon_detect_dealapp_zero_padded_twin() — repairs this exact shape first (padded row active, unpadded twin
-- active and seen in the last 3 days, padded row not seen for 14 days), then raises P2 for anything left.

create or replace function public.mon_detect_dealapp_zero_padded_twin()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n int := 0;
  live text[] := '{}';
  tb text;
begin
  foreach tb in array array['dealapp_residential_listings', 'dealapp_commercial_listings'] loop
    -- 1. repair: the padded row is a stale twin of a fresh unpadded row of the SAME table.
    for r in execute format($q$
      select p.id pid, p.ad_number pad, t.id tid, t.ad_number twin, p.last_seen_at p_seen, t.last_seen_at t_seen
      from public.%I p
      join public.%I t on t.ad_number = 'DA' || ltrim(substr(p.ad_number, 3), '0') and t.id <> p.id
      where p.active and p.ad_number ~ '^DA0[0-9]+$'
        and t.active and t.last_seen_at > now() - interval '3 days'
        and p.last_seen_at < now() - interval '14 days'
    $q$, tb, tb) loop
      execute format('update public.%I set active = false where id = $1 and active', tb) using r.pid;
      insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
      values (tb, r.pid, 'dealapp zero-padded twin of an active row (same ad, same page)',
              jsonb_build_object('padded', r.pad, 'twin_id', r.tid, 'twin', r.twin,
                                 'padded_last_seen', r.p_seen, 'twin_last_seen', r.t_seen,
                                 'by', 'mon_detect_dealapp_zero_padded_twin'))
      on conflict do nothing;
    end loop;
    -- 2. raise for any padded active row still left (a twin we could not prove stale).
    for r in execute format($q$
      select p.id, p.ad_number from public.%I p where p.active and p.ad_number ~ '^DA0[0-9]+$'
    $q$, tb) loop
      live := live || ('dealapp_zero_padded_twin:' || tb || ':' || r.id);
      n := n + public.mon_raise('P2', 'dealapp_zero_padded_twin', 'dealapp',
        'dealapp_zero_padded_twin:' || tb || ':' || r.id,
        jsonb_build_object('table', tb, 'listing_id', r.id, 'ad_number', r.ad_number,
          'why', 'An active dealapp row carries a zero-padded ad_number. The crawl canonicalises ids to str(int()), '
                 'so this row is never re-read; if an unpadded twin exists the same ad is served twice.',
          'action', 'Compare with DA<id without leading zeros>; retire the stale one only when its twin is fresh.'));
    end loop;
  end loop;
  perform public.mon_resolve_stale_keys('dealapp_zero_padded_twin', live);
  return n;
end
$function$;

-- The repair itself: the same function, run once now (2 rows, two small indexed tables).
select public.mon_detect_dealapp_zero_padded_twin();

-- Roster (an unrostered detector is decoration). Needle-edit of the LIVE body, read in this same step.
do $roster$
declare d text; anchor text := '''mon_detect_pin_coverage_below_floor'','; k int; fn text := 'mon_detect_dealapp_zero_padded_twin';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''' || fn || '''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''' || fn || ''', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''' || fn || '''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- Check block: both twins retired and registered, both fresh rows untouched, no padded active row left.
do $check$
begin
  if exists (select 1 from public.dealapp_residential_listings where id in (1143135, 3063334) and active) then
    raise exception 'padded twins still active';
  end if;
  if (select count(*) from public.dealapp_residential_listings where id in (6236699, 3462088) and active) <> 2 then
    raise exception 'a fresh twin is no longer active';
  end if;
  if (select count(*) from public.ops_adjudicated_retraction
       where source_table = 'dealapp_residential_listings' and listing_id in (1143135, 3063334)) <> 2 then
    raise exception 'retractions not registered';
  end if;
  if exists (select 1 from public.dealapp_residential_listings where active and ad_number ~ '^DA0[0-9]+$')
     or exists (select 1 from public.dealapp_commercial_listings where active and ad_number ~ '^DA0[0-9]+$') then
    raise exception 'a padded active row is left';
  end if;
end
$check$;
