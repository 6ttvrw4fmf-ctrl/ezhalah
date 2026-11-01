-- price_fidelity() is the last v2-reaching maintenance routine still EXECUTE-able by anon.
-- It stayed public only because scripts/verify-detector-total-matches-its-breakdown-live.ts calls
-- it with the publishable key, and verify-live-checks-self-sufficient.ts requires every scheduled
-- live check to use that key. A public caller could make the database plan v2 on demand.
--
-- Fix: the hourly detector (cron job 42, mon_detect_price_fidelity) already computes the payload.
-- It now also saves it into a one-row, anon-READABLE table. The live check reads that row instead
-- of running the function, so no extra v2 work is added. Once the check reads the snapshot,
-- EXECUTE on price_fidelity() is revoked from public/anon/authenticated (separate migration).

create table if not exists public.price_fidelity_snapshot (
  id       smallint primary key default 1 check (id = 1),
  payload  jsonb not null,
  taken_at timestamptz not null default now()
);
alter table public.price_fidelity_snapshot enable row level security;
revoke all on public.price_fidelity_snapshot from anon, authenticated;
grant select on public.price_fidelity_snapshot to anon, authenticated;
drop policy if exists price_fidelity_snapshot_read on public.price_fidelity_snapshot;
create policy price_fidelity_snapshot_read on public.price_fidelity_snapshot
  for select to anon, authenticated using (true);

-- Body identical to the live definition (md5 4652076691fa7424f3434114feb1d881 before this change)
-- plus ONE statement: save the payload it already computed.
CREATE OR REPLACE FUNCTION public.mon_detect_price_fidelity()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s jsonb; v_mismatch bigint; v_target text; v_open_sev text; n int := 0;
        v_dropped bigint; v_ppm_target text; v_ppm_open_sev text;
begin
  s := public.price_fidelity();
  insert into public.price_fidelity_snapshot (id, payload, taken_at) values (1, s, now())
    on conflict (id) do update set payload = excluded.payload, taken_at = excluded.taken_at;
  v_mismatch := (s->>'mismatches')::bigint;
  if    v_mismatch > 250 then v_target := 'P1';
  elsif v_mismatch >  25 then v_target := 'P2';
  else  v_target := null; end if;
  select severity into v_open_sev from public.alert_event
   where dedup_key = 'price_drift' and resolved_at is null order by created_at desc limit 1;
  if v_target is null then
    if v_open_sev is not null then perform public.mon_resolve('price_drift','price_fidelity'); end if;
  elsif v_open_sev is distinct from v_target then
    if v_open_sev is not null then perform public.mon_resolve('price_drift','price_fidelity'); end if;
    n := n + public.mon_raise(v_target, 'price_drift', 'price_fidelity', 'price_drift',
      s || jsonb_build_object('why','Ezhalah card price diverged from the source platform price; search is serving stale/incorrect prices. Source of truth = raw listing via listing_native_location_v2.'));
  end if;

  -- ppm_source_dropped: the source PUBLISHES «سعر المتر» but we store NULL.
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
    if v_ppm_open_sev is not null then perform public.mon_resolve('ppm_source_dropped','price_fidelity'); end if;
  elsif v_ppm_open_sev is distinct from v_ppm_target then
    if v_ppm_open_sev is not null then perform public.mon_resolve('ppm_source_dropped','price_fidelity'); end if;
    n := n + public.mon_raise(v_ppm_target, 'ppm_source_dropped', 'price_fidelity', 'aqar',
      jsonb_build_object('dropped_rows', v_dropped,
        'why','A source-published «سعر المتر» is stored as NULL. The page prints a per-meter price and Ezhalah is discarding it (regression of the 2026-07-26 trg_aqar_parse fidelity fix).'));
  end if;

  return n;
end $function$;
