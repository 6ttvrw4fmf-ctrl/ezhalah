-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BATCH 5 — DATA INTEGRITY CHECKS (hardening plan 2026-07-13, batch 5 of 8). Constraints +
-- detector + per-run field-range recalibration. OWNER CONSTRAINT honored: "do not apply
-- constraints until existing bad rows are classified and repaired or quarantined" — Phase A
-- (2026-07-16, live read-only aggregates over all 67 *_listings base tables) classified every
-- known violation class FIRST, and every constraint below was verified to have ZERO live
-- violations fleet-wide before being proposed. Nothing in this file repairs, hides, or
-- rewrites a single listing row (aggregator-fidelity + price-fidelity rules): it only
-- (1) attaches impossible-by-definition CHECK constraints where the fleet is already 100%
-- clean, (2) recalibrates the dark-deployed per-run field-range RPC so activating it does not
-- false-demote healthy runs, and (3) adds one scheduled alert-only detector for the classes a
-- constraint must NOT enforce (because the offending rows are faithful-to-source or are
-- known repair-candidates awaiting owner-approved per-row source proof).
--
-- ── PHASE A CLASSIFICATION (all counts live 2026-07-16; queries were count/group only) ──
-- CLASS 1 · bedrooms 52–500 on property_type='Building' (aqar_res 494, wasalt_res 86,
--   sanadak_res 5, aqargate_res 1) and Hotel/Office/Commercial Building on commercial tables
--   (aqar_com 28, sanadak_com 55, aqargate_com 21): FAITHFUL-TO-SOURCE artifact — sampled
--   aqar descriptions state unit/floor/shop counts ("٦ ادوار … خمس محلات و ١٠ شقق" on a
--   60-"bedroom" building; "ادوار مكتبية" on a 100-"bedroom" one): the source reuses the
--   rooms field as a unit count for whole-building listings. VERDICT: keep + alert-only on
--   NEW appearances outside those types. NO constraint (it would reject faithful raw data).
--   EXCEPTIONS inside the class (repair-candidates, need per-row source proof, NOT repaired
--   here): wasalt_res 2 Apartments with bedrooms 29,800/32,000 and sanadak_com 15 Offices
--   with bedrooms up to 23,000 (empty descriptions; almost certainly a parse artifact), plus
--   1 aqar_res 'Residential Land' with bedrooms=105. The detector below alerts on exactly
--   these shapes (bedrooms>1000 anywhere, or >50 outside the unit-count types).
-- CLASS 2 · area_m2 < 5 (aqar_res 3,691, aqar_com 1,514, wasalt_res 8, gathern 20,
--   aqarmonthly 4, eaqartabuk 2): values are the integers 1–4 (aqar_res: 2,322×"1", 779×"2",
--   405×"3", 185×"4") — seller-entered placeholders shown verbatim on the source site, not a
--   parse bug (a divide/units bug would produce scattered fractions, not clean 1–4).
--   VERDICT: faithful-to-source placeholder — keep; cards show raw truth. Constraint is
--   area_m2 >= 0 ONLY (negative is impossible-by-definition; zero live violations).
-- CLASS 3 · implausible prices. (a) active Rent price_annual<500: 91 fleet-wide, ≤4.8% of
--   any table's active Rent (aqarcity 24/502=4.8% is the max) — these sit INSIDE the
--   2026-07-15 price-repair clearance (ops_price_repair_backup_20260715: ~1,679 sub-3000-SAR
--   rows source-proven faithful placeholders and deliberately left untouched) → NOT
--   re-flagged; watched only as a table-level FRACTION (≥20%) so a new monthly-as-annual
--   regression still fires. (b) price_annual=0: 9 rows (7 active), aqar_res only — faithful
--   placeholders in the same clearance family → price CHECKs below are >= 0, NOT > 0, so
--   they stay legal; detector watches for zero-price GROWTH (>20 rows) instead. (c) active
--   price > 100M: 1,099 aqar_res + 70 wasalt_res + 13 smaller — ALL are price_total in
--   (100M, 1B] with ZERO price_total>1B and ZERO price_annual>100M: exactly the band
--   _sanitize_price() (scrapers/common/db.py) deliberately allows (its hide threshold is 1B
--   total / 100M annual). VERDICT: faithful big-ticket listings; the dark RPC's 100M
--   "absurd" line was a BUG (see recalibration below).
-- CLASS 4 · city='Other' literals on active rows (wasalt_res 64, gathern_res 5,
--   wasalt_com 2): 'other' IS in scrapers/common/placeholder_tokens.py. All 71 rows have
--   raw_captured_at <= 2026-07-10 (the day the write-time guard landed) — they are PRE-GUARD
--   leftovers, NOT a live crawl bypass: today's crawls map unknown cities to NULL before
--   write. They still show last_seen_at up to 07-15 because scrapers/wasalt/liveness.py:217
--   refreshes last_seen_at + missing_count WITHOUT rewriting city. VERDICT: ingestion-bug
--   leftovers = repair-candidates (per-row source re-resolution needs owner approval — see
--   scrapers/wasalt/recover_other.py); NOT repaired here. Detector alerts on them (and any
--   future recurrence); the per-run RPC is gated on raw_captured_at so liveness refreshes of
--   these legacy rows can never false-demote a healthy run (see recalibration below).
-- CLASS 5 · blank transaction_type / property_type / ad_number / listing_url: ZERO
--   fleet-wide (67/67 tables). The RPC's zero-tolerance blank-field check stays as-is.
--
-- ── WHY THE DARK RPC NEEDED RECALIBRATION BEFORE ACTIVATION (this batch wires its first
--    call sites via end_run(check_tables=...), so this is the last moment to fix it) ──
-- mon_check_run_field_ranges was deployed by Batch 0 with ZERO call sites. Verified against
-- live data, three of its rules would have false-demoted healthy runs the moment Batch 5
-- wired it:
--   1. absurd-price threshold was 100M for BOTH price_total and price_annual, but
--      _sanitize_price()'s owner-approved contract hides only >1B total / >100M annual.
--      1,169 faithful active rows sit in the (100M,1B] total band and are re-upserted every
--      crawl → EVERY aqar/wasalt run would have been P1-flagged + demoted ok=False, which
--      would then trip D1 silent_scraper_death on perfectly healthy scrapers. Fixed: 1B
--      total / 100M annual (identical to the Python guard).
--   2. null-price rule (≥5 nulls or >2% of touched rows) ignored that "price on request" is
--      faithful raw data this fleet KEEPS (price-fidelity rule): live baselines are jazwtn
--      136/137 Buy-null (99%), awal 107/107 (100%), mustqr 233/751 (31%), aqar_res 1,880
--      (3%), aqar_com Rent 985 (17%) … ≥14 platforms over the old line → roughly half the
--      fleet permanently demoted. Fixed: self-calibrating baseline-delta — fire only when
--      this run's touched-slice null fraction exceeds the table's own whole-table fraction
--      by ≥25 points (with ≥20 touched rows), i.e. only on a sudden parser regression, never
--      on a platform's honest steady state.
--   3. placeholder-location rule sliced by last_seen_at alone; wasalt's liveness job
--      refreshes last_seen_at on the 64 legacy city='Other' rows without rewriting them, so
--      any run overlapping a liveness tick would be P1-demoted for rows it never wrote.
--      Fixed: the placeholder count additionally requires raw_captured_at >= p_since
--      (raw_captured_at is stamped by _ensure_capture() on EVERY real upsert path and by
--      nothing else — write-evidence), so only rows this run actually WROTE can trip it.
--      All 67 tables have raw_captured_at (verified); a table without it falls back to the
--      last_seen_at slice.
-- Unchanged: tiny-rent fraction (>20% of the slice's active Rent under 500 SAR — max live
-- table-wide baseline is 4.8%, headroom is real), blank-critical-fields zero-tolerance
-- (live baseline exactly 0), dedup key 'run_field_range:'||table, raise-only (no
-- auto-resolve), never-blocks, same signature — db.py's end_run() call contract is
-- untouched.
--
-- NEUTRALITY: alert-only + reject-only-impossible. Never modifies, hides, estimates, or
-- re-ranks a listing. Cards keep showing raw source truth, including the faithful oddities
-- classified above.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Fail fast rather than queue behind a long-running ingest transaction: ADD CONSTRAINT takes
-- a brief ACCESS EXCLUSIVE lock per table; NOT VALID keeps it metadata-only, and VALIDATE
-- afterwards only needs SHARE UPDATE EXCLUSIVE (scrapers/search stay unblocked during the
-- scan). If a lock can't be had in 10s the migration errors out cleanly for a retry.
set lock_timeout = '10s';

-- ══ 1 · CHECK CONSTRAINTS — impossible-by-definition only, zero live violations verified ══
-- Rules (column IS NULL always allowed — honest NULL is the fleet's sanctioned "unknown"):
--   price_total  >= 0  (0 live violations / 67 tables; NOT ">0": price 0 is a known faithful
--                       placeholder family — see CLASS 3b — and a strict-positive check
--                       would make a future faithful 0 fail its whole upsert batch)
--   price_annual >= 0  (9 live rows are exactly 0 → legal under >=0; 0 negatives fleet-wide)
--   area_m2      >= 0  (0 live violations; 1–4 m² placeholders stay legal — CLASS 2)
--   bedrooms     >= 0  (0 live violations; unit-count reuse >50 stays legal — CLASS 1)
--   bathrooms    >= 0  (0 live violations)
-- Each table is re-verified AT APPLY TIME: if bad rows appeared between the Phase A audit
-- and this migration running, that table+rule is SKIPPED (never fails the migration, never
-- quarantines data) and a P3 alert is raised so the skip is visible on the dashboard —
-- detector coverage below still watches the class. Idempotent: existing constraints skipped.
do $b5$
declare
  t record;
  r record;
  viol bigint;
  attached int := 0;
  skipped int := 0;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name like '%\_listings' and table_type = 'BASE TABLE'
  loop
    for r in
      select * from (values
        ('chk_b5_price_total_nonneg',  'price_total',  'price_total is null or price_total >= 0'),
        ('chk_b5_price_annual_nonneg', 'price_annual', 'price_annual is null or price_annual >= 0'),
        ('chk_b5_area_m2_nonneg',      'area_m2',      'area_m2 is null or area_m2 >= 0'),
        ('chk_b5_bedrooms_nonneg',     'bedrooms',     'bedrooms is null or bedrooms >= 0'),
        ('chk_b5_bathrooms_nonneg',    'bathrooms',    'bathrooms is null or bathrooms >= 0')
      ) as v(cname, col, expr)
    loop
      -- column must exist on this table (uniform today, but never assume forever)
      if not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name=t.table_name and column_name=r.col) then
        continue;
      end if;
      -- idempotency: already attached (e.g. re-run after a partial apply)
      if exists (select 1 from pg_constraint
                 where conrelid = ('public.'||quote_ident(t.table_name))::regclass and conname = r.cname) then
        continue;
      end if;
      -- apply-time re-verification (owner constraint: never attach over live bad rows)
      execute format('select count(*) from public.%I where not (%s)', t.table_name, r.expr) into viol;
      if viol > 0 then
        skipped := skipped + 1;
        raise notice 'batch5: SKIP % on % — % live violation(s); alert raised, no constraint attached',
          r.cname, t.table_name, viol;
        perform public.mon_raise('P3', 'integrity_constraint_skipped', null,
          'integrity_constraint_skipped:'||t.table_name||':'||r.cname,
          jsonb_build_object('table', t.table_name, 'constraint', r.cname, 'rule', r.expr,
            'live_violations', viol,
            'why', 'rows appeared after the 2026-07-16 Phase A audit; classify/repair before attaching'));
        continue;
      end if;
      -- NOT VALID first (metadata-only, instant) then VALIDATE (non-blocking scan) so the
      -- ACCESS EXCLUSIVE window is as short as Postgres allows.
      execute format('alter table public.%I add constraint %I check (%s) not valid',
                     t.table_name, r.cname, r.expr);
      execute format('alter table public.%I validate constraint %I', t.table_name, r.cname);
      attached := attached + 1;
    end loop;
  end loop;
  raise notice 'batch5: constraints attached=% skipped=%', attached, skipped;
end $b5$;

-- ══ 2 · mon_check_run_field_ranges — recalibrated per-run check (SUPERSEDES the Batch 0
--    definition; same signature, same dedup, same never-blocks/raise-only contract; see the
--    header for the three live-data findings that forced each change) ══
create or replace function public.mon_check_run_field_ranges(
  p_run_id             bigint,
  p_platform           text,
  p_table              text,
  p_since              timestamptz,
  p_placeholder_tokens text[]
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  has_cap             boolean;
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
  slice_frac          numeric;
  base_frac           numeric;
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
    case when has_cap then format('raw_captured_at >= %L', p_since) else 'true' end,
    p_placeholder_tokens, p_placeholder_tokens, p_table, p_since)
  into n, buy_touched, rent_touched, buy_price_null, rent_price_null,
       absurd_price_active, rent_active_n, rent_tiny, loc_placeholder, crit_null;

  if coalesce(n, 0) = 0 then
    return false;
  end if;

  -- (a) null-price PARSE-REGRESSION check — baseline-delta, self-calibrating. "Price on
  -- request" is faithful raw data (jazwtn 99% Buy-null, awal 100%, mustqr 31% at steady
  -- state), so absolute counts can never be the signal; a broken price parser shows up as
  -- the run's slice suddenly sitting far ABOVE the table's own baseline.
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

    if buy_touched >= 20 then
      slice_frac := buy_price_null::numeric / buy_touched;
      base_frac  := coalesce(base_buy_null::numeric / nullif(base_buy, 0), 0);
      if slice_frac >= base_frac + 0.25 then
        degraded := true;
        reasons := reasons || jsonb_build_object('check','buy_price_null_regression',
          'slice_null', buy_price_null, 'slice_n', buy_touched,
          'slice_frac', round(slice_frac,3), 'table_baseline_frac', round(base_frac,3));
      end if;
    end if;
    if rent_touched >= 20 then
      slice_frac := rent_price_null::numeric / rent_touched;
      base_frac  := coalesce(base_rent_null::numeric / nullif(base_rent, 0), 0);
      if slice_frac >= base_frac + 0.25 then
        degraded := true;
        reasons := reasons || jsonb_build_object('check','rent_price_null_regression',
          'slice_null', rent_price_null, 'slice_n', rent_touched,
          'slice_frac', round(slice_frac,3), 'table_baseline_frac', round(base_frac,3));
      end if;
    end if;
  end if;

  -- (b) absurd active price — zero-tolerance, thresholds IDENTICAL to _sanitize_price()
  -- (>1B total / >100M annual). A row over these lines surviving as active means the Python
  -- guard didn't run on this write path. Live baseline today: exactly 0 rows fleet-wide.
  if absurd_price_active > 0 then
    degraded := true;
    worst_sev := 'P1';
    reasons := reasons || jsonb_build_object('check','absurd_price_while_active',
      'count', absurd_price_active, 'threshold_total_sar', 1000000000, 'threshold_annual_sar', 100000000);
  end if;

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
end $$;

-- ══ 3 · D8 · scheduled field-integrity sweep — the classes a constraint must NOT enforce ══
-- Per active-registry platform table (same registry join as D3, so retired platforms drop
-- out automatically), one cheap aggregate pass over ACTIVE rows, four sub-checks, each with
-- its own dedup key and targeted self-heal (direct dedup_key resolve, NOT mon_resolve —
-- mon_resolve clears by kind+platform and would wrongly close sibling sub-checks/tables):
--   • placeholder city/region literal on active rows        → P2 (CLASS 4 backlog + any recurrence)
--   • bedrooms>1000 anywhere, or >50 outside unit-count types → P2 (CLASS 1 exceptions)
--   • active-Rent tiny-price fraction ≥20% (n≥20)           → P1 (regression tripwire)
--   • zero-price active rows > 20                            → P2 (CLASS 3b growth watch;
--     live baseline 7 active rows, all aqar_res, all faithful)
-- EXPECTED OPEN ALERTS ON FIRST RUN (these are the classified, known-bad backlog — the alert
-- IS the quarantine-visibility the owner asked for, not noise): placeholder_loc on
-- wasalt_residential(64) / wasalt_commercial(2) / gathern_residential(5); bedrooms on
-- wasalt_residential(14) / sanadak_commercial(15) / aqar_residential(1).
create or replace function public.mon_detect_field_integrity()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record;
  n int := 0;
  -- keep in sync with scrapers/common/placeholder_tokens.py PLACEHOLDER_TOKENS (canonical)
  -- and src/data/remote.ts JUNK_LOCATION_TOKENS (display layer).
  ph constant text[] := array['other','unknown','n/a','none','null','undefined','',
                              'غير محدد','اخرى','أخرى'];
  -- property types whose bedrooms field is a faithful unit/room/floor count (CLASS 1).
  unit_types constant text[] := array['Building','Hotel','Office','Commercial Building'];
  loc_ph bigint; beds_odd bigint; rent_active bigint; rent_tiny bigint; zero_price bigint;
begin
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema = 'public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status = 'active'
  loop
    begin
      execute format($f$
        select
          count(*) filter (where active and ((city   is not null and lower(trim(city))   = any(%L::text[]))
                                          or (region is not null and lower(trim(region)) = any(%L::text[])))),
          count(*) filter (where active and (bedrooms > 1000
                                          or (bedrooms > 50 and coalesce(property_type,'') <> all(%L::text[])))),
          count(*) filter (where active and transaction_type = 'Rent'),
          count(*) filter (where active and transaction_type = 'Rent' and price_annual < 500),
          count(*) filter (where active and (price_total = 0 or price_annual = 0))
        from public.%I
      $f$, ph, ph, unit_types, rec.tn)
      into loc_ph, beds_odd, rent_active, rent_tiny, zero_price;
    exception when others then continue;  -- shape mismatch → skip table, never block
    end;

    if loc_ph > 0 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_placeholder_loc:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'active_placeholder_location_rows', loc_ph,
          'why','placeholder city/region literal on active rows — pre-guard legacy or a new guard bypass'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_placeholder_loc:'||rec.tn;
    end if;

    if beds_odd > 0 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_bedrooms:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'suspect_bedroom_rows', beds_odd,
          'why','bedrooms>1000, or >50 outside unit-count types (Building/Hotel/Office/Commercial Building) — parse-artifact repair candidates'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_bedrooms:'||rec.tn;
    end if;

    if rent_active >= 20 and rent_tiny::numeric / nullif(rent_active, 0) > 0.20 then
      n := n + public.mon_raise('P1','field_integrity', rec.platform,
        'field_integrity_tiny_rent:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'tiny_rent_rows', rent_tiny, 'active_rent', rent_active,
          'frac', round(rent_tiny::numeric / rent_active, 3),
          'why','>=20% of active Rent under 500 SAR — monthly-as-annual-shaped regression'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_tiny_rent:'||rec.tn;
    end if;

    if zero_price > 20 then
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_zero_price:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'zero_price_active_rows', zero_price,
          'why','active zero-price rows grew past 20 (faithful-placeholder baseline is 7, all aqar_res) — check for a new ingestion bug'));
    else
      update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
        and dedup_key = 'field_integrity_zero_price:'||rec.tn;
    end if;
  end loop;
  return n;
end $$;

-- ── fold D8 into the orchestrator. SUPERSEDES the Batch 2 definition (which itself
-- superseded Batch 0 + the D6 addendum): the body below is a verbatim copy of the CURRENT
-- LIVE 7-detector definition (read via pg_get_functiondef on 2026-07-16), adding only the
-- field-integrity call and its returned key. Batch 1's hourly cron job invokes
-- mon_run_all_detectors(), so D8 is live on the first tick after this migration applies —
-- no new cron entry needed.
create or replace function public.mon_run_all_detectors()
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  f := public.mon_detect_stale_refresh();
  g := public.mon_detect_legacy_alert_tables();
  h := public.mon_detect_field_integrity();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,
    'field_integrity',h,'ran_at',now());
end $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — ALL CONFIRMED in BEGIN..ROLLBACK against live prod 2026-07-16 (whole file
-- applied end-to-end, verified, then rolled back via RAISE EXCEPTION; post-check confirmed
-- zero persisted state: 0 chk_b5_% constraints, 0 new alert_event rows, live function
-- definitions unchanged). Re-run the same dry-run before merging if listing data has moved:
--   • constraints DO-loop: attached=335 skipped=0 (67 tables × 5 rules) — a skip means new
--     bad rows appeared post-audit; investigate before applying for real.
--   • select public.mon_detect_field_integrity();       -- 6 on first run (exactly the
--     classified backlog listed above), 0 on an immediate second run (dedup holds them open).
--   • select public.mon_check_run_field_ranges(0,'wasalt','wasalt_residential_listings',
--       now()-interval '2 days', array['other','unknown','n/a','none','null','undefined','',
--       'غير محدد','اخرى','أخرى']);                      -- false: the 64 legacy 'Other' rows
--     are write-gated out and the (100M,1B] prices are no longer "absurd". Same probe on
--     aqar_residential_listings: false (null-price baseline-delta self-calibrates).
--   • a synthetic in-txn garbage row (city='Other', blank listing_url, fresh
--     raw_captured_at): the RPC returned TRUE — a real future guard bypass still demotes.
--   • insert with bedrooms=-1: rejected with check_violation — the constraint has teeth.
--   • pg_get_functiondef(mon_run_all_detectors) contains 'field_integrity' (9 return keys).
--
-- ROLLBACK (additive only):
--   BEGIN;
--   -- restore mon_run_all_detectors to the Batch 2 (7-detector) body, and
--   -- mon_check_run_field_ranges to the Batch 0 body (20260713_batch0_detection_spine.sql);
--   DELETE FROM public.alert_event WHERE kind IN ('field_integrity','integrity_constraint_skipped');
--   DROP FUNCTION IF EXISTS public.mon_detect_field_integrity();
--   DO $rb$ declare t record; c text; begin
--     for t in select table_name from information_schema.tables
--              where table_schema='public' and table_name like '%\_listings' and table_type='BASE TABLE' loop
--       foreach c in array array['chk_b5_price_total_nonneg','chk_b5_price_annual_nonneg',
--                                'chk_b5_area_m2_nonneg','chk_b5_bedrooms_nonneg','chk_b5_bathrooms_nonneg'] loop
--         execute format('alter table public.%I drop constraint if exists %I', t.table_name, c);
--       end loop;
--     end loop;
--   end $rb$;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────────────────
