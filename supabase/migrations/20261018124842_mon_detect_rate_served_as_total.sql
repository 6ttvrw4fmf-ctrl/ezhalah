-- APPLIED 2026-10-18 (owner session). Companion detector of 20261018123454_wasalt_rate_is_not_the_total (that repair file
-- is already applied, so it cannot name its watcher; verify-repair-migrations-are-guarded records this companion).
--
-- WHAT IT FLAGS — OUR claim, not the source's number (feedback_a-monitor-must-flag-our-claim-not-the-sources-number):
-- a live SALE row we SERVE with a stored total (search_listings_ar.price_total) while the listing's OWN description proves
-- that number is a per-m² rate — its stated total T differs from the served price and equals price × area within 1%.
-- Per platform; today the evidence reader exists for wasalt (both tables). A platform joins by adding its arm to
-- rate_served_as_total_rows(). P1 'rate_served_as_total' (price accuracy), routed to 🔧 repair by ops_engineer_for_alert's
-- default. Rostered in mon_run_all_detectors. Apply-time proof: 0 live; one repaired row served with its rate as the total
-- in a rolled-back sub-transaction → 1.

create or replace function public.rate_served_as_total_rows()
returns table (platform text, source_table text, listing_id bigint, served_total bigint, area_m2 integer, description_total numeric)
language sql stable security definer set search_path to 'public'
as $$
  select s.platform, s.source_table, s.listing_id, s.price_total::bigint, s.area_m2, t.total
    from public.search_listings_ar s
    join public.wasalt_residential_listings w on s.source_table = 'wasalt_residential_listings' and w.id = s.listing_id
    cross join lateral (select public.wasalt_description_total(w.ar_data, w.description) as total) t
   where s.production_ready and s.deal_ar = 'بيع' and s.price_total > 0 and s.area_m2 > 0
     and t.total is not null and t.total <> s.price_total
     and abs(t.total - s.price_total::numeric * s.area_m2) <= 0.01 * s.price_total::numeric * s.area_m2
  union all
  select s.platform, s.source_table, s.listing_id, s.price_total::bigint, s.area_m2, t.total
    from public.search_listings_ar s
    join public.wasalt_commercial_listings w on s.source_table = 'wasalt_commercial_listings' and w.id = s.listing_id
    cross join lateral (select public.wasalt_description_total(w.ar_data, w.description) as total) t
   where s.production_ready and s.deal_ar = 'بيع' and s.price_total > 0 and s.area_m2 > 0
     and t.total is not null and t.total <> s.price_total
     and abs(t.total - s.price_total::numeric * s.area_m2) <= 0.01 * s.price_total::numeric * s.area_m2
$$;

create or replace function public.mon_detect_rate_served_as_total()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; v_open text; r int := 0;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'rows', n) order by n desc), '[]'::jsonb)
    into v_rows, v_by
    from (select platform, count(*) n from public.rate_served_as_total_rows() group by platform) z;
  select coalesce(sum((e->>'rows')::bigint), 0) into v_rows from jsonb_array_elements(v_by) e;
  select severity into v_open from public.alert_event
   where dedup_key = 'rate_served_as_total' and resolved_at is null order by created_at desc limit 1;
  if v_rows = 0 then
    if v_open is not null then perform public.mon_resolve('rate_served_as_total', 'price_fidelity'); end if;
  elsif v_open is null then
    r := public.mon_raise('P1', 'rate_served_as_total', 'price_fidelity', 'rate_served_as_total',
      jsonb_build_object('rows', v_rows, 'per_platform', v_by, 'for', '🔧',
        'examples', (select jsonb_agg(jsonb_build_object('source_table', x.source_table, 'listing_id', x.listing_id,
                       'served_total', x.served_total, 'area_m2', x.area_m2, 'description_total', x.description_total))
                       from (select * from public.rate_served_as_total_rows() limit 10) x),
        'why', 'We serve a per-m² RATE as the total: the listing''s own description states a total equal to the served price × area (owner 10-18, «we can get sued»). The write-path guard is trg_wrm_rate_is_not_the_total (20261018123454): check it still exists on both wasalt tables and that the sync carried price_per_meter. Never fix by hiding the price.'));
  end if;
  return r;
end $function$;

-- Roster (an unrostered detector is decoration).
do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_rate_served_as_total''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_rate_served_as_total'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_rate_served_as_total''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF: live index after the repair's sync (or before it: a served rate is exactly what this flags), then a planted one.
do $proof$
declare base bigint; planted bigint; lid bigint;
begin
  base := (select count(*) from public.rate_served_as_total_rows());
  select w.id into lid from public.wasalt_residential_listings w
   where w.listing_url ~ '-5848132$' and w.price_total is null and w.price_per_meter = 8000;
  if lid is null then raise exception 'PROOF: the repaired ad 5848132 is not in its repaired state'; end if;
  begin
    update public.search_listings_ar set price_total = 8000, area_m2 = 1225
     where source_table = 'wasalt_residential_listings' and listing_id = lid;
    planted := (select count(*) from public.rate_served_as_total_rows());
    if planted < base + 1 and not exists (select 1 from public.rate_served_as_total_rows() x where x.listing_id = lid) then
      raise exception 'PROOF: a served 8,000 «total» on a 1,225 m² plot whose description says 9,800,000 was not flagged';
    end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_rate_served_as_total') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: % served rate-as-total rows now (the index follows at the next sync); a planted one is caught; rostered', base;
end $proof$;
