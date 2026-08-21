-- mon_check_run_field_ranges: composite per-property_type null-price baseline
-- (2026-08-21 — aqar_residential false-positive investigation)
--
-- THE FALSE POSITIVE THIS FIXES. buy_price_null_regression / rent_price_null_regression compared a
-- run's touched-row null-price fraction against ONE FLAT table-wide baseline (all property_type
-- values mixed) + a flat +0.25 margin. aqar-sweep.yml runs one begin_run/end_run PER CITY, sweeping
-- ALL property types x both deals in a single pass (scrapers/aqar/run_residential.py --all-residential
-- --city X). Per-property_type null rates on aqar_residential_listings vary hugely and are
-- STRUCTURALLY STABLE, not anomalies (measured 2026-08-21): Buy price_total-null ranges from
-- Apartment 1.37% up to House 77.50%/Residential Land 18.40%; Rent price_annual-null ranges from
-- Apartment 4.28% up to Chalet 90.57%/Room 25.14%/Rest House 17.02% -- all faithfully captured
-- (WebFetch-confirmed against 4 live sa.aqar.fm pages: house/chalet listings genuinely show no price
-- at all on the source). A city sweep whose touched slice happens to be rich in these
-- structurally-high-null types (a small/niche city producing few Apartment/Villa touches) ALWAYS
-- looks anomalous against the flat table-wide baseline (~5.9% Buy / ~6.6% Rent) even with zero
-- regression. Real trip: alert_event id=466, run 32382, rent_price_null_regression, slice_frac=31.8%
-- (Room/Chalet/Rest House-heavy touched slice) vs table_baseline_frac=6.6%.
--
-- THE FIX. Replace the single flat baseline with a COMPOSITE expected fraction: for each
-- property_type present in the touched slice, weight that type's OWN table-wide null baseline by
-- its share of the touched slice, and sum. A type's own baseline is trusted only when the table-wide
-- sample for that type/transaction_type is >= 20 rows; below that (or when property_type isn't a
-- column on p_table at all) that type's contribution falls back to the ORIGINAL flat table-wide
-- fraction -- so any OTHER check_tables caller lacking meaningful property_type variance (or lacking
-- the column) is byte-for-byte unaffected. `table_baseline_frac` is kept in the raised reasons
-- unchanged for observability; `composite_type_baseline_frac` is added alongside it. This does NOT
-- fully solve every possible skew -- a touched slice of a single property_type whose OWN table-wide
-- baseline happens to be far below its true behaviour (e.g. a hypothetical house-only sweep, where
-- Aqar's بيت URL category is mapped to canonical property_type='Villa' and so is diluted by the much
-- larger true-Villa pool) can still trip; that is a known, narrower residual case, not the pattern
-- behind any of the actual production trips investigated here (all multi-type city sweeps).
--
-- Regression coverage (proven red-on-old / green-on-new against synthetic data mirroring the real
-- per-type baselines above, matching alert 466's exact slice_n=321/slice_frac=0.318 shape):
-- scripts/verify-run-field-range-composite-baseline-live.ts.
create or replace function public.mon_check_run_field_ranges(p_run_id bigint, p_platform text, p_table text, p_since timestamp with time zone, p_placeholder_tokens text[])
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  has_cap             boolean;
  has_ptype           boolean;
  n                   bigint;
  buy_touched         bigint;
  rent_touched        bigint;
  buy_price_null      bigint;
  rent_price_null     bigint;
  absurd_price_active bigint;
  rent_active_n       bigint;
  rent_tiny           bigint;
  loc_placeholder     bigint;
  crit_null           bigint;
  base_buy            bigint;
  base_buy_null       bigint;
  base_rent           bigint;
  base_rent_null      bigint;
  composite_buy_null  numeric;
  composite_buy_n     bigint;
  composite_rent_null numeric;
  composite_rent_n    bigint;
  cap_clause          text;
  slice_frac          numeric;
  base_frac           numeric;
  composite_frac      numeric;
  degraded            boolean := false;
  worst_sev           text := 'P2';
  reasons             jsonb := '[]'::jsonb;
begin
  if p_table is null or p_since is null then
    return false;
  end if;

  -- generic across the platform tables: bail quietly if the shape doesn't fit.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = p_table
        and column_name in ('ad_number','listing_url','property_type','transaction_type',
                             'price_total','price_annual','city','region','active','last_seen_at')
     ) < 10
  then
    return false;
  end if;

  -- write-evidence column: stamped by _ensure_capture() on every real upsert, and by nothing
  -- else (liveness/enrich paths don't touch it). Present on all 67 tables today.
  select exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=p_table and column_name='raw_captured_at')
    into has_cap;

  -- composite-baseline signal: present on every *_listings table today, but checked explicitly (not
  -- assumed) so a future/foreign table missing it degrades gracefully to the flat baseline below.
  select exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name=p_table and column_name='property_type')
    into has_ptype;

  cap_clause := case when has_cap then format('raw_captured_at >= %L', p_since) else 'true' end;

  -- ONE aggregate pass over this run's touched-row slice.
  execute format($f$
    select
      count(*),
      count(*) filter (where transaction_type = 'Buy'),
      count(*) filter (where transaction_type = 'Rent'),
      count(*) filter (where transaction_type = 'Buy'  and price_total  is null),
      count(*) filter (where transaction_type = 'Rent' and price_annual is null),
      count(*) filter (where active and (coalesce(price_total,0)  > 1000000000
                                       or coalesce(price_annual,0) > 100000000)),
      count(*) filter (where transaction_type = 'Rent' and active),
      count(*) filter (where transaction_type = 'Rent' and active and price_annual < 500),
      count(*) filter (where %s
                         and ((city   is not null and lower(trim(city))   = any(%L::text[]))
                           or (region is not null and lower(trim(region)) = any(%L::text[])))),
      count(*) filter (where trim(coalesce(ad_number,''))         = ''
                          or  trim(coalesce(listing_url,''))      = ''
                          or  trim(coalesce(property_type,''))    = ''
                          or  trim(coalesce(transaction_type,'')) = '')
    from public.%I
    where last_seen_at >= %L
  $f$,
    cap_clause,
    p_placeholder_tokens, p_placeholder_tokens, p_table, p_since)
  into n, buy_touched, rent_touched, buy_price_null, rent_price_null,
       absurd_price_active, rent_active_n, rent_tiny, loc_placeholder, crit_null;

  if coalesce(n, 0) = 0 then
    return false;
  end if;

  -- (a) null-price PARSE-REGRESSION check — COMPOSITE per-property_type baseline (2026-08-21).
  -- "Price on request" is faithful raw data, and per-property_type null rates on the multi-type
  -- tables this check runs against are structurally very different from each other (measured on
  -- aqar_residential_listings: Buy 1.37%-77.50%, Rent 4.28%-90.57% depending on type) — so a single
  -- flat table-wide baseline always looks anomalous when a run's touched slice happens to be
  -- composed differently from the table average (e.g. one city's --all-residential sweep landing
  -- disproportionately on Room/Chalet/Rest House), even with zero actual regression. Comparing
  -- against a COMPOSITE baseline — each present type's own table-wide null rate, weighted by that
  -- type's share of the touched slice — keeps the check sensitive to a genuine regression (any type
  -- suddenly null far above ITS OWN historical rate) while no longer crying wolf on a normal
  -- type-composition skew. A type's own baseline is trusted only with >=20 table-wide rows for that
  -- transaction_type; below that (or when property_type isn't on p_table) it falls back to the
  -- original flat table-wide fraction, so callers without meaningful property_type variance
  -- (wasalt, aqaratikom, etc) see byte-for-byte unchanged behaviour.
  if buy_touched >= 20 or rent_touched >= 20 then
    execute format($f$
      select
        count(*) filter (where transaction_type = 'Buy'),
        count(*) filter (where transaction_type = 'Buy'  and price_total  is null),
        count(*) filter (where transaction_type = 'Rent'),
        count(*) filter (where transaction_type = 'Rent' and price_annual is null)
      from public.%I
    $f$, p_table)
    into base_buy, base_buy_null, base_rent, base_rent_null;

    if has_ptype then
      execute format($f$
        with touched as (
          select property_type,
                 count(*) filter (where transaction_type='Buy')  as buy_n,
                 count(*) filter (where transaction_type='Rent') as rent_n
          from public.%1$I
          where last_seen_at >= %2$L and %3$s
          group by property_type
        ), base as (
          select property_type,
                 count(*) filter (where transaction_type='Buy')                          as base_buy_n,
                 count(*) filter (where transaction_type='Buy'  and price_total  is null) as base_buy_null_n,
                 count(*) filter (where transaction_type='Rent')                          as base_rent_n,
                 count(*) filter (where transaction_type='Rent' and price_annual is null) as base_rent_null_n
          from public.%1$I
          group by property_type
        )
        select
          coalesce(sum(case when b.base_buy_n >= 20
                             then t.buy_n * (b.base_buy_null_n::numeric / nullif(b.base_buy_n,0))
                             else t.buy_n * %4$L::numeric end), 0),
          coalesce(sum(t.buy_n), 0),
          coalesce(sum(case when b.base_rent_n >= 20
                             then t.rent_n * (b.base_rent_null_n::numeric / nullif(b.base_rent_n,0))
                             else t.rent_n * %5$L::numeric end), 0),
          coalesce(sum(t.rent_n), 0)
        from touched t left join base b using (property_type)
      $f$, p_table, p_since, cap_clause,
           coalesce(base_buy_null::numeric / nullif(base_buy, 0), 0),
           coalesce(base_rent_null::numeric / nullif(base_rent, 0), 0))
      into composite_buy_null, composite_buy_n, composite_rent_null, composite_rent_n;
    end if;

    if buy_touched >= 20 then
      slice_frac := buy_price_null::numeric / buy_touched;
      base_frac  := coalesce(base_buy_null::numeric / nullif(base_buy, 0), 0);
      composite_frac := case when has_ptype and coalesce(composite_buy_n, 0) > 0
                              then composite_buy_null / composite_buy_n
                              else base_frac end;
      if slice_frac >= composite_frac + 0.25 then
        degraded := true;
        reasons := reasons || jsonb_build_object('check','buy_price_null_regression',
          'slice_null', buy_price_null, 'slice_n', buy_touched,
          'slice_frac', round(slice_frac,3),
          'table_baseline_frac', round(base_frac,3),
          'composite_type_baseline_frac', round(composite_frac,3));
      end if;
    end if;
    if rent_touched >= 20 then
      slice_frac := rent_price_null::numeric / rent_touched;
      base_frac  := coalesce(base_rent_null::numeric / nullif(base_rent, 0), 0);
      composite_frac := case when has_ptype and coalesce(composite_rent_n, 0) > 0
                              then composite_rent_null / composite_rent_n
                              else base_frac end;
      if slice_frac >= composite_frac + 0.25 then
        degraded := true;
        reasons := reasons || jsonb_build_object('check','rent_price_null_regression',
          'slice_null', rent_price_null, 'slice_n', rent_touched,
          'slice_frac', round(slice_frac,3),
          'table_baseline_frac', round(base_frac,3),
          'composite_type_baseline_frac', round(composite_frac,3));
      end if;
    end if;
  end if;

  -- (b) REMOVED 2026-08-03 (nightly audit). This asserted that no ACTIVE row may carry
  -- price_total > 1B or price_annual > 100M — i.e. that _sanitize_price() had force-killed it.
  -- PR#280 deleted that clause deliberately (owner rule: extreme-price verify-then-preserve), so the
  -- assertion inverted and fired exactly when the pipeline behaved CORRECTLY: it RC-B-demoted a
  -- healthy dealapp crawl to ok=False (run 22880, 2026-08-03 15:32, 1 row, sold=0 pruned=0) and
  -- would raise a false silent-scraper-death P1 on any platform touching such a row. Parse-artifact
  -- coverage is unchanged — phone/ID bands in mon_detect_field_integrity, low band in
  -- mon_buy_token_price, checks (a)/(c)/(d)/(e) below untouched. `absurd_price_active` is still
  -- selected above only to keep the aggregate's positional INTO list aligned.

  -- (c) suspicious-tiny-rent pattern — unchanged from Batch 0: >20% of the slice's ACTIVE
  -- Rent rows under 500 SAR (max live table-wide baseline: 4.8%). Catches a NEW
  -- monthly-as-annual-shaped regression without re-flagging the cleared faithful
  -- placeholders (ops_price_repair_backup_20260715 clearance).
  if rent_active_n >= 20 and rent_tiny::numeric / rent_active_n > 0.20 then
    degraded := true;
    reasons := reasons || jsonb_build_object('check','rent_annual_suspiciously_tiny',
      'count', rent_tiny, 'of_active_rent', rent_active_n,
      'frac', round(rent_tiny::numeric / rent_active_n, 3));
  end if;

  -- (d) placeholder location — zero-tolerance, WRITE-GATED (raw_captured_at >= p_since): a
  -- placeholder in rows this run actually wrote means guard_location_update /
  -- _reject_placeholder_location was bypassed. The 71 known pre-guard legacy rows (CLASS 4)
  -- can no longer trip this via liveness last_seen_at refreshes; the scheduled detector owns
  -- watching those.
  if loc_placeholder > 0 then
    degraded := true;
    worst_sev := 'P1';
    reasons := reasons || jsonb_build_object('check','placeholder_location_written',
      'count', loc_placeholder);
  end if;

  -- (e) critical required fields — zero-tolerance (live baseline exactly 0 fleet-wide).
  if crit_null > 0 then
    degraded := true;
    worst_sev := 'P1';
    reasons := reasons || jsonb_build_object('check','missing_critical_field',
      'count', crit_null,
      'fields', array['ad_number','listing_url','property_type','transaction_type']);
  end if;

  if degraded then
    perform public.mon_raise(worst_sev, 'run_field_range', p_platform,
      'run_field_range:'||p_table,
      jsonb_build_object('table', p_table, 'run_id', p_run_id, 'since', p_since,
                         'touched', n, 'reasons', reasons));
  end if;

  return degraded;
end $function$;
