-- af_coverage_cliff was watching the wrong columns and had no evidence floor (owner, 2026-08-29).
--
-- WHAT IT GOT WRONG. The detector built its field set from `_rich_attr_columns()` — every rich
-- attribute a scraper captures — and then told the reader "every new listing since the cliff is
-- unreachable by that AF predicate". For most of those columns there IS no AF predicate. On
-- 2026-08-29 it raised P2 on `postal_code` / aqar_residential_listings; `postal_code` appears ZERO
-- times in af_eligibility_clause(), so no Advanced Filter question can filter on it and nothing
-- became unreachable. Its "baseline" was 3 rows in 30 days out of ~25,000 — a rate of 0.01%.
--
-- FIX 1 — THE FIELD SET IS DERIVED FROM THE REAL PREDICATE SURFACE. Monitored columns are now the
-- columns af_eligibility_clause() actually filters on, intersected with search_listings_ar. That is
-- the same clause the search RPC and every AF count RPC run, so "this field went dark" now always
-- means "this predicate lost its inventory" — the sentence the alert has always claimed.
-- Nothing is hand-listed: add a predicate to the clause and it is monitored on the next run.
--
-- This STRENGTHENS coverage detection rather than weakening it. Measured at the time of writing:
--   29 columns monitored before → 39 after
--   +35 newly monitored, every one a live AF predicate the old set never watched, among them
--      street_width_m · rating · reviews_count · direction_ar · bathrooms · property_age ·
--      furnished · unit_subtype_ar · floor_number · license_number · tenant_ar · elevator ·
--      parking · kitchen · air_conditioner · maid_room · driver_room · private_entrance ·
--      price_total · price_annual · area_m2 · bedrooms
--   -25 dropped, none of them filterable by AF (postal_code, pool, gym, balcony, latitude,
--      longitude, total_floors, kitchen_status, parking_count, …). Capture health for those is a
--      DIFFERENT question with different wording; this detector is about AF reachability, and
--      claiming they make listings unreachable was simply false.
-- The >= 20 sanity refusal is kept and now also refuses an empty clause parse, so a future rewrite
-- of af_eligibility_clause() that this regex cannot read FAILS CLOSED instead of monitoring nothing.
--
-- FIX 2 — AN EVIDENCE FLOOR, so a baseline that never existed cannot look like a collapse.
-- A cliff now needs the prior 30-day window to show a real baseline:
--     prior_with_value >= 30            (absolute)  AND  prior_with_value >= 10% of prior rows
-- Both limbs are load-bearing, and each is exercised by a real case measured today:
--   * wasalt_commercial · furnished       1 of 40   (2.50%) — caught by the absolute limb
--   * sanadak_residential · floor_number  1 of 63   (1.59%) — caught by the absolute limb
--   * dealapp_residential · bedrooms     32 of 4840 (0.66%) — passes 30, caught by the rate limb
--
-- PROVEN NOT TO BLIND A REAL CLIFF (historical positive). dealapp_residential_listings · bedrooms
-- genuinely collapsed in the week of 2026-08-03. Evaluated in this detector's own window shape as
-- of 2026-08-10: recent 237 rows / 0 with a value, prior 132 rows / 118 with a value = 89.39%.
-- 118 >= 30 and 89.39% >= 10%, so the new rule STILL FIRES on it. What the floor suppresses today
-- is the stale echo of that same cliff four weeks later, once the prior window has itself decayed
-- to 0.66% — which is the detector re-reporting old news, not a new signal.
--
-- The payload now carries prior_rows and prior_rate_pct so the next reader can judge the baseline
-- without re-deriving it, and the thresholds are named in the payload so a barrier can pin them.

create or replace function public.mon_detect_af_coverage_cliff()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- The evidence floor. Both must hold before a drop to zero counts as a cliff.
  MIN_PRIOR_ROWS  constant int := 30;    -- absolute: fewer than this is not a baseline
  MIN_PRIOR_PCT   constant numeric := 10.0;  -- rate: a trickle is not a baseline either
  cols text[]; agg text; q text; r record; c text;
  rv bigint; pv bigint; prior_rows bigint; rate numeric;
  n int := 0; v_bad jsonb := '[]'::jsonb; v_cliffs int := 0;
begin
  if not public.mon_claim_daily_slot('af_coverage_cliff') then return 0; end if;

  -- THE MONITORED SET IS THE REAL AF PREDICATE SURFACE, read from the clause itself.
  select array_agg(z.c order by z.c) into cols from (
    select distinct m[1] c
      from (select public.af_eligibility_clause() t) src,
           regexp_matches(src.t, 's\.([a-z_0-9]+)', 'g') m
    intersect
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'search_listings_ar') z;

  -- FAIL CLOSED: an unreadable or shrunken predicate surface must stop the run loudly, never
  -- silently monitor nothing. (A detector that cannot fire reads as a clean bill of health.)
  if cols is null or array_length(cols, 1) < 20 then
    raise exception 'refusing to run: AF predicate column set looks wrong (%)', cols;
  end if;

  select string_agg(format(
      'count(*) filter (where first_seen_at > now()-interval ''7 days'' and %I is not null) as r_%s,'
      ' count(*) filter (where first_seen_at <= now()-interval ''7 days'''
      ' and first_seen_at > now()-interval ''37 days'' and %I is not null) as p_%s', x, x, x, x), ', ')
    into agg from unnest(cols) x;

  q := format('select source_table,
                 count(*) filter (where first_seen_at > now()-interval ''7 days'') as recent_rows,
                 count(*) filter (where first_seen_at <= now()-interval ''7 days''
                   and first_seen_at > now()-interval ''37 days'') as prior_rows, %s
               from public.search_listings_ar group by 1', agg);

  for r in execute q loop
    if (to_jsonb(r)->>'recent_rows')::bigint >= 50 then
      prior_rows := (to_jsonb(r)->>'prior_rows')::bigint;
      foreach c in array cols loop
        rv := (to_jsonb(r)->>('r_'||c))::bigint;
        pv := (to_jsonb(r)->>('p_'||c))::bigint;
        rate := round(100.0 * pv / nullif(prior_rows, 0), 2);
        -- A cliff is a drop to zero FROM A REAL BASELINE, not from a trickle.
        if rv = 0 and pv >= MIN_PRIOR_ROWS and coalesce(rate, 0) >= MIN_PRIOR_PCT then
          v_cliffs := v_cliffs + 1;
          v_bad := v_bad || jsonb_build_object(
            'source_table', r.source_table, 'af_field', c,
            'new_listings_last_7d', (to_jsonb(r)->>'recent_rows')::bigint,
            'with_value_last_7d', 0,
            'with_value_prior_30d', pv,
            'prior_rows_30d', prior_rows,
            'prior_rate_pct', rate);
        end if;
      end loop;
    end if;
  end loop;

  update public.ops_detector_last_full_run set last_result = v_cliffs where detector = 'af_coverage_cliff';

  if v_cliffs = 0 then
    perform public.mon_resolve_key('af_coverage_cliff','af_coverage_cliff');
    return 0;
  end if;

  n := public.mon_raise('P2','af_coverage_cliff','all','af_coverage_cliff',
    jsonb_build_object('cliffs', v_cliffs, 'offenders', v_bad,
      'monitored_fields', array_length(cols, 1),
      'floor', jsonb_build_object('min_prior_rows', MIN_PRIOR_ROWS, 'min_prior_pct', MIN_PRIOR_PCT),
      'why','An Advanced Filter PREDICATE field was arriving on this platform''s new listings from a '
         || 'real baseline and has stopped completely, while the platform is still producing '
         || 'listings. That is a parser, mapping or source-shape break -- not a quiet market, '
         || 'because the row count proves the crawl is running. Every new listing since the cliff is '
         || 'unreachable by that AF predicate. The monitored set is derived from '
         || 'af_eligibility_clause() itself, so every field named here IS filterable.',
      'adjudicate','Find the LAYER that stopped: compare the raw payload of a new listing against the '
         || 'same platform''s listing_rich_attrs branch and then against search_listings_ar. Fix the '
         || 'layer, never the rows. If the SOURCE genuinely stopped publishing it, prove that with a '
         || 'live probe read through the production parser AND validated on a known-good control row '
         || 'first -- a failed fetch is indistinguishable from a source omission -- then record the '
         || 'verdict so this stays quiet honestly.'));
  return n;
end
$function$;
