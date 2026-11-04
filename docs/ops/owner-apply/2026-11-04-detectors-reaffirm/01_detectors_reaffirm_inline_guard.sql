-- Detectors that raised ONCE and then froze their own alert (🔧 repair 2026-11-04 PM).
-- Four detectors wrapped mon_raise() in «elsif not exists (select 1 from alert_event where dedup_key = … and
-- resolved_at is null)». mon_raise() is the ONLY writer of last_affirmed_at and the one that refreshes the
-- payload and escalates severity on an open alert, so behind that guard an open alert kept the numbers of the
-- day it was born and read as «no detector stands behind it». Measured today: served_total_below_city_floor
-- (P1, owner «we can get sued») still said 430 rows / aqar 89 derived-from-rate from 2026-10-18 with
-- last_affirmed_at NULL, while the live set is 147 / 24. The guard is replaced by «else»: the condition still
-- true → mon_raise() every sweep (it dedups itself), zero → resolve, exactly as before.
-- Barrier: scripts/verify-detectors-reaffirm-open-alerts.ts now matches this inline spelling too; production half:
-- mon_detect_alert_reaffirmation LIMB B (widened at the foot of this file).

create or replace function public.mon_detect_served_total_below_city_floor()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_rows bigint; v_owner bigint; v_by jsonb; v_ex jsonb; r int := 0;
begin
  with x as (select * from public.served_total_below_city_floor_rows())
  select count(*) filter (where not x.source_shows_it), count(*) filter (where x.source_shows_it),
         coalesce((select jsonb_agg(jsonb_build_object('platform', z.platform, 'rows', z.n, 'derived_from_rate', z.d) order by z.n desc)
                     from (select y.platform, count(*) n, count(*) filter (where y.derived_from_rate) d
                             from x y where not y.source_shows_it group by y.platform) z), '[]'::jsonb),
         (select jsonb_agg(to_jsonb(e)) from (select y.platform, y.source_table, y.listing_id, y.city_ar, y.served_total,
                                                     y.area_m2, y.served_ppm, y.city_floor_ppm
                                                from x y where not y.source_shows_it order by y.served_ppm limit 12) e)
    into v_rows, v_owner, v_by, v_ex from x;

  if v_rows = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'served_total_below_city_floor' and resolved_at is null) then
      perform public.mon_resolve('served_total_below_city_floor', 'price_fidelity');
    end if;
  else
    r := r + public.mon_raise('P1', 'served_total_below_city_floor', 'price_fidelity', 'served_total_below_city_floor',
      jsonb_build_object('rows', v_rows, 'per_platform', v_by, 'examples', v_ex, 'for', '🔧',
        'owner_list_rows', v_owner,
        'why', 'We serve a sale plot under 2% of its city''s median SAR/m² and no page read backs it — OUR claim (owner 10-18, «we can get sued»). Open the ad: (a) the page shows a per-m² rate, a placeholder, a view count or another number and we stored it as the total → fix the extractor and re-scrape (wasalt: wasalt_description_total + trg_wrm_rate_is_not_the_total; others: the per-site scraper); (b) the page itself shows that small number as the price → PRICE = SOURCE: keep it and record the read in ops_price_source_verified (it moves to owner_price_source_shows_small_total). Never hide or «fix» a price by plausibility.'));
  end if;

  if v_owner = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'source_shows_small_total' and resolved_at is null) then
      perform public.mon_resolve('source_shows_small_total', 'price_fidelity');
    end if;
  else
    r := r + public.mon_raise('P3', 'source_shows_small_total', 'price_fidelity', 'source_shows_small_total',
      jsonb_build_object('rows', v_owner, 'for', '👑 owner list', 'list', 'select * from owner_price_source_shows_small_total',
        'why', 'Sale plots whose own page shows a price under 2% of the city''s median SAR/m². Shown exactly as the source shows them (PRICE = SOURCE); listed so it never passes silently.'));
  end if;
  return r;
end $function$;

create or replace function public.mon_detect_af_view_drops_stored_answer()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_rows jsonb; r int := 0;
begin
  select jsonb_agg(to_jsonb(x) order by x.stored_answers desc) into v_rows from public.af_view_dropped_answers() x;
  if v_rows is null then
    if exists (select 1 from public.alert_event where dedup_key = 'af_view_drops_stored_answer' and resolved_at is null) then
      perform public.mon_resolve('af_view_drops_stored_answer', 'af_capture');
    end if;
  else
    r := r + public.mon_raise('P1', 'af_view_drops_stored_answer', 'af_capture', 'af_view_drops_stored_answer',
      jsonb_build_object('arms', v_rows, 'for', '🔬',
        'why', 'A listing_extra_attrs arm reads NULL for an Advanced Filter answer its table stores, so the :22 sync serves NULL and a customer asking for it never finds the listing. Point the arm at x.<column> (20261019 furnished fix is the worked example).'));
  end if;
  return r;
end $function$;

create or replace function public.mon_detect_served_pin_outside_ksa()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; r int := 0;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'rows', n) order by n desc), '[]'::jsonb)
    into v_rows, v_by
    from (select platform, count(*) n from public.search_listings_ar
           where (latitude is not null or longitude is not null)
             and not coalesce(public.point_in_ksa(latitude, longitude), false)
           group by platform) z;
  select coalesce(sum((e->>'rows')::bigint), 0) into v_rows from jsonb_array_elements(v_by) e;
  if v_rows = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'served_pin_outside_ksa' and resolved_at is null) then
      perform public.mon_resolve('served_pin_outside_ksa', 'location');
    end if;
  else
    r := public.mon_raise('P1', 'served_pin_outside_ksa', 'location', 'served_pin_outside_ksa',
      jsonb_build_object('rows', v_rows, 'per_platform', v_by, 'for', '🔧',
        'why', 'We serve a map pin outside Saudi Arabia (box 16–32.5 N, 34–56 E): the ad page draws it in the ocean, Cairo or England. The write path is sync_listing_rich_attrs() (SET/DIFF wrap latitude/longitude in point_in_ksa) — check it still does, then re-run it. Never «fix» by swapping or guessing a pin; NULL lets the page show the district border.'));
  end if;
  return r;
end $function$;

create or replace function public.mon_detect_wasalt_street_width_misread()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n bigint; v_ex jsonb; r int := 0;
begin
  -- ~20h gate (Falcon 2026-10-23, backlog 327): see the migration header. Watched by
  -- mon_detect_stalled_daily_detector so this gate cannot silently wedge shut.
  if not public.mon_claim_daily_slot('mon_detect_wasalt_street_width_misread') then
    return 0;
  end if;
  select count(*), (select jsonb_agg(to_jsonb(x)) from (select * from public.wasalt_street_width_misread() limit 8) x)
    into v_n, v_ex from public.wasalt_street_width_misread();
  if v_n = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'wasalt_street_width_misread' and resolved_at is null) then
      perform public.mon_resolve('wasalt_street_width_misread', 'wasalt');
    end if;
  else
    r := r + public.mon_raise('P1', 'wasalt_street_width_misread', 'wasalt', 'wasalt_street_width_misread',
      jsonb_build_object('rows', v_n, 'examples', v_ex, 'for', '🔬',
        'why', 'A wasalt street width is served as something other than the decimal its own propertyStreetWidth states (the 10-19 shape: the decimal point deleted, 8.1 m served as 81). A customer asking for a wide street is shown a narrow one. Fix the listing_extra_attrs_v0 wasalt arms.'));
  end if;
  return r;
end $function$;

-- The production watcher had the same blind spot: LIMB B searched only for the literal «elsif not v_open then»
-- and so never saw the inline «elsif not exists (select 1 from public.alert_event … resolved_at is null) then»
-- spelling the four detectors above used. LIMB B now matches both spellings; LIMB A is unchanged.
create or replace function public.mon_detect_alert_reaffirmation()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_key    constant text := 'alert_reaffirmation_selftest';
  fails    jsonb := '[]'::jsonb;
  n        int := 0;
  r1 int; r2 int; r3 int;
  v_detail jsonb; v_affirmed timestamptz; v_open_rows int;
  v_guarded text[];
begin
  ---------------------------------------------------------------------------------------------
  -- LIMB A — the round trip, executed.
  ---------------------------------------------------------------------------------------------
  delete from public.alert_event where dedup_key = c_key;   -- clean slate; scratch key only

  begin
    r1 := public.mon_raise('P3','alert_reaffirmation_selftest', null, c_key,
            jsonb_build_object('probe', 1));
    r2 := public.mon_raise('P3','alert_reaffirmation_selftest', null, c_key,
            jsonb_build_object('probe', 2));

    select detail, last_affirmed_at, count(*) over ()
      into v_detail, v_affirmed, v_open_rows
      from public.alert_event where dedup_key = c_key and resolved_at is null limit 1;

    if r1 <> 1 then
      fails := fails || jsonb_build_object('case','first_raise_inserts','expected',1,'got',r1);
    end if;
    if r2 <> 0 then
      fails := fails || jsonb_build_object('case','second_raise_dedups_to_zero','expected',0,'got',r2);
    end if;
    if coalesce(v_open_rows, 0) <> 1 then
      fails := fails || jsonb_build_object('case','exactly_one_open_row_per_dedup_key',
        'expected',1,'got', coalesce(v_open_rows,0));
    end if;
    -- The half the five guarded detectors were losing: the payload must be TODAY's.
    if coalesce(v_detail->>'probe','') <> '2' then
      fails := fails || jsonb_build_object('case','re_raise_refreshes_detail',
        'expected','probe=2','got', coalesce(v_detail::text,'<no row>'));
    end if;
    -- ...and the column that lets a reader tell "still standing behind this" from "raised once".
    if v_affirmed is null then
      fails := fails || jsonb_build_object('case','re_raise_stamps_last_affirmed_at',
        'expected','not null','got','null');
    end if;

    -- Resolve must RELEASE the key, or a recurrence raises nothing for ever.
    perform public.mon_resolve_key('alert_reaffirmation_selftest', c_key);
    r3 := public.mon_raise('P3','alert_reaffirmation_selftest', null, c_key,
            jsonb_build_object('probe', 3));
    if r3 <> 1 then
      fails := fails || jsonb_build_object('case','resolved_key_can_raise_again',
        'expected',1,'got',r3,
        'why','a resolved dedup key that still suppresses is worse than one that never resolved');
    end if;
  exception when others then
    fails := fails || jsonb_build_object('case','round_trip_threw','error', sqlerrm);
  end;

  delete from public.alert_event where dedup_key = c_key;   -- always clean up the scratch rows

  ---------------------------------------------------------------------------------------------
  -- LIMB B — the shape that loses LIMB A's guarantees, in any roster-reachable detector.
  -- Two spellings (2026-11-04): the v_open variable, and the inline not-exists subquery.
  ---------------------------------------------------------------------------------------------
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_guarded
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'mon\_detect\_%'
     and p.proname <> 'mon_detect_alert_reaffirmation'          -- this function names the pattern
     and (position('elsif not v_open then' in pg_get_functiondef(p.oid)) > 0
          or pg_get_functiondef(p.oid) ~* '(if|elsif)\s+not\s+exists\s*\(\s*select\s+1\s+from\s+(public\.)?alert_event\M[^;]*?resolved_at\s+is\s+null\s*\)\s*then[^;]*?\mmon_raise\s*\(')
     -- ...unless it also carries an unguarded else-arm that re-raises anyway, which is what
     -- mon_detect_zero_price_served does and is a correct (if roundabout) implementation.
     and position(E'  else\n    n := n + public.mon_raise' in pg_get_functiondef(p.oid)) = 0;

  if cardinality(v_guarded) > 0 then
    fails := fails || jsonb_build_object('case','raise_guarded_by_alert_already_open',
      'detectors', to_jsonb(v_guarded),
      'why','these detectors skip mon_raise() entirely while their own alert is open, so the '
         || 'payload never refreshes, last_affirmed_at is never stamped, and severity can never '
         || 'escalate — mon_raise() already dedups correctly and calling it unconditionally is '
         || 'both simpler and strictly safer');
  end if;

  -- Both limbs have been evaluated by the time we get here, so raise and resolve alike sit on a
  -- path that genuinely ran the condition.
  if jsonb_array_length(fails) = 0 then
    perform public.mon_resolve_key('alert_reaffirmation','alert_reaffirmation');
    return 0;
  end if;

  n := public.mon_raise('P1','alert_reaffirmation', 'monitoring', 'alert_reaffirmation',
    jsonb_build_object(
      'failures', fails,
      'why','An open alert is supposed to be re-affirmed by its detector on every sweep. That '
         || 'call is what refreshes the payload, stamps last_affirmed_at, and carries a worsening '
         || 'condition up to a higher severity with dispatch re-armed. Without it an alert is a '
         || 'claim about the day it was raised: production carried a P1 for 88 hours whose count '
         || 'was four days old and which nothing had re-checked.',
      'fix','Call mon_raise() unconditionally whenever the condition is true. It already keeps '
         || 'exactly one open row per dedup_key and already returns 0 for an open key, so nothing '
         || 'about alert volume or the sweep''s all-zero semantics changes. Do NOT fix this by '
         || 'hand-stamping last_affirmed_at or by deleting the open alert.'));
  return n;
end $function$;
