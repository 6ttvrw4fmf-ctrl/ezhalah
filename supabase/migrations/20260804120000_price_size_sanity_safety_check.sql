-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PRICE/SIZE SANITY SAFETY CHECK (owner 2026-08-04: "never display a wrong price or size — data must
-- match the platform or we can get sued"). ADDITIVE. Prevents a PHYSICALLY-IMPOSSIBLE price/size from
-- ever being searchable, and alerts if one ever is.
--
-- WHY: dealapp/aqarcity/eaqartabuk land listings were showing fabricated prices (e.g. 22,002,786,078,000
-- SAR = area × a mis-parsed per-meter figure) because the source's structured price field is garbage
-- while the real price lives only in the human description. Magnitude thresholds alone CANNOT separate a
-- fabrication from a source-real extreme (the owner's extreme-price-verify-then-preserve rule keeps a
-- real land ppm of 800,000 and a real total of 3.55B) — so this gate fires ONLY on values no real
-- listing on earth can have, set far above every preserved extreme:
--   • total or annual  > 50,000,000,000 SAR   (>50B for one listing / one year's rent)
--   • area             > 5,000,000 m²         (>500 ha for a single parcel)
--   • implied per-meter > 5,000,000 SAR/m²     (>13× the most expensive real estate on earth)
-- Zero false positives by construction (3.55B / 800k-ppm / 56-ha-farm all pass). This is LAYER 1
-- (the egregious tail). LAYER 2 — full source-corroboration for mid-range fabrications — requires
-- capturing each platform's own displayed price/size verbatim and is tracked separately.
--
-- ENFORCEMENT is a BEFORE trigger on search_listings_ar (not an edit to sync_search_listings_ar, whose
-- blast radius is the whole index): whatever sync computes, an impossible row is forced
-- production_ready=false, so it is withheld from every RPC — and it stays withheld across re-scrapes
-- (the trigger re-fires on each upsert). NEUTRAL: never deletes/inactivates a listing, never touches a
-- source-real price; it only declines to *display* a provably-impossible number (honest «السعر عند الطلب»
-- beats a wrong price). A row returns to search automatically once its price/size is corrected.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- shared predicate (one definition, reused by the gate + the monitor + any future check)
create or replace function public.price_size_impossible(pt numeric, pa numeric, area integer)
returns boolean language sql immutable as $$
  select coalesce(pt,0) > 50000000000
      or coalesce(pa,0) > 50000000000
      or coalesce(area,0) > 5000000
      or (area is not null and area > 0
          and greatest(coalesce(pt,0), coalesce(pa,0)) / area > 5000000);
$$;

-- the gate: a physically-impossible price/size can never be searchable
create or replace function public.enforce_price_size_sanity()
returns trigger language plpgsql as $$
begin
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2) then
    NEW.production_ready := false;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_price_size_sanity on public.search_listings_ar;
create trigger trg_price_size_sanity
  before insert or update on public.search_listings_ar
  for each row execute function public.enforce_price_size_sanity();

-- corrective: withhold the rows already displayed with an impossible price/size (291 at write time)
update public.search_listings_ar
   set production_ready = false
 where production_ready
   and public.price_size_impossible(price_total, price_annual, area_m2);

-- standing monitor: the invariant is "0 displayable rows are physically impossible". If the trigger is
-- ever dropped/bypassed, this raises P1 within ~30 min (jobid 38 sweep) and self-resolves when clear.
create or replace function public.mon_detect_impossible_price_size()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_cnt bigint; v_open boolean; n int := 0;
begin
  select count(*) into v_cnt
    from public.search_listings_ar
   where production_ready
     and public.price_size_impossible(price_total, price_annual, area_m2);
  v_open := exists (select 1 from public.alert_event
                    where dedup_key='impossible_price_size_displayed' and resolved_at is null);
  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('impossible_price_size_displayed','search_index'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P1','impossible_price_size_displayed','search_index','impossible_price_size_displayed',
      jsonb_build_object('count', v_cnt,
        'why','a SEARCHABLE listing carries a physically-impossible price or size (ppm>5M SAR/m², total/annual>50B, or area>5M m²) — data must match the source, never display a fabricated number'));
  end if;
  return n;
end $$;

-- wire the monitor into the single detector roster (array form, current live body + one entry)
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fns text[] := array[
    'mon_detect_silent_scraper_death',
    'mon_detect_zero_new_stall',
    'mon_detect_stale_active_fraction',
    'mon_detect_volume_drop',
    'mon_detect_cron_health',
    'mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables',
    'mon_detect_field_integrity',
    'mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth',
    'mon_detect_registry_orphans',
    'mon_detect_rls_reachability',
    'mon_detect_mass_inactivation',
    'mon_detect_english_district_leak',
    'mon_detect_impossible_price_size',     -- new 20260804120000: price/size sanity gate tripwire
    'mon_detect_unverified_inactivation',
    'mon_detect_deletion_spike',
    'mon_detect_search_gate_leak',
    'mon_detect_orphaned_detectors'
  ];
  fn text; raised int; result jsonb := '{}'::jsonb; failed text[] := '{}';
begin
  foreach fn in array fns loop
    begin
      execute format('select public.%I()', fn) into raised;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), raised);
    exception when others then
      failed := failed || fn;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), 'ERROR: ' || sqlerrm);
      begin
        perform public.mon_raise('P1', 'detector_crash', 'all',
          'detector_crash:' || fn || ':' || current_date,
          jsonb_build_object('detector', fn, 'sqlstate', sqlstate, 'error', sqlerrm));
      exception when others then
        null;
      end;
    end;
  end loop;
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed));
end $function$;
