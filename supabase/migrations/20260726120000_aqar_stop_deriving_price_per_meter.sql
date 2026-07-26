-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- aqar: stop DERIVING price_per_meter, preserve the SOURCE-PUBLISHED «سعر المتر»
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2026-07-26. Root-cause fix for a listing-fidelity violation on `price_per_meter`.
--
-- THE BUG
-- aqar listing pages print a «سعر المتر» value in their structured «تفاصيل الإعلان» spec row.
-- scrapers/aqar/enrich_residential.py:141 parse_price_per_meter() extracts it correctly (label-
-- anchored since the 2026-07-16 bug-B2 fix) and scrapers/common/db.py upserts it verbatim. The
-- BEFORE INSERT OR UPDATE trigger `aqar_parse_bi` → public.trg_aqar_parse() then threw it away:
--
--     if NEW.transaction_type='Buy' then
--       ...
--       if coalesce(NEW.area_m2,0) > 0 and final_price is not null then
--         NEW.price_per_meter := public.safe_int(round(final_price::numeric / NEW.area_m2)::text);
--       else
--         NEW.price_per_meter := null;      -- destroyed the parsed source value
--       end if;
--     else
--       NEW.price_per_meter := null;        -- Rent: destroyed unconditionally
--     end if;
--
-- Measured consequence on live ACTIVE rows before this migration:
--   * 42,088 residential + 670 commercial rows hold a number the source NEVER printed
--     (pure round(price_total/area_m2) arithmetic) in a column named after a source field.
--   * 3,476 residential + 3 commercial rows hold a derived number that CONTRADICTS the value the
--     page actually prints.
--   *  9,283 residential +  6 commercial merely coincide with the printed value.
--   => ZERO of the 54,847 stored aqar values were source-published. All were internally derived.
--   * 1,077 rows (822 residential + 255 commercial) publish a «سعر المتر» that is stored as NULL,
--     purely because this trigger nulled it. That is the user-visible data loss.
--
-- Deriving a value into a source-named column is itself the fidelity violation
-- (CLAUDE.md: "never modify/estimate/infer/round listing data"), so the derivation is removed
-- outright rather than kept as a fallback. NOTHING computes price_total from price_per_meter here;
-- that operation stays forbidden.
--
-- SCOPE
-- The identical trigger `aqar_parse_bi` is attached to BOTH aqar_residential_listings and
-- aqar_commercial_listings, and scrapers/aqar/run_commercial.py:30 imports the same
-- enrich_residential() enricher — so one function fixes both tables with no commercial gap.
--
-- Bodies below are built from `pg_get_functiondef` of the LIVE objects pulled 2026-07-26
-- (trg_aqar_parse md5 0fda805b1bee5234ea30d9520f37d436, backfill_aqar_res md5
-- 115510f48d74fd2d6c64c1a568e059f2, mon_detect_price_fidelity md5
-- f164b30e84dcb50a6942db6ecafd7e94), NOT from repo files — these three objects had no committed
-- definition at all before this migration (live-only drift). Signatures are unchanged, so
-- CREATE OR REPLACE mints no new overload (no PGRST203 hazard).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Applied via supabase apply_migration, which already wraps the whole file in one transaction —
-- so there is no explicit BEGIN/COMMIT here (a nested one would abort the outer block). Either
-- every statement below lands or none does.

-- ── 1. the root cause ──────────────────────────────────────────────────────────────────────────
-- Only the pricing block changes: the derivation and BOTH `price_per_meter := null` arms are
-- deleted, and the now-unused `final_price` variable is dropped. Buy price_total ownership and
-- every other assignment are preserved byte-for-byte from the live body.
CREATE OR REPLACE FUNCTION public.trg_aqar_parse()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare p jsonb; parsed_price bigint;
begin
  if NEW.source_capture->>'source_text' is null then return NEW; end if;
  if TG_OP='UPDATE' and NEW.source_capture is not distinct from OLD.source_capture and NEW.fullparse_done then
    return NEW;
  end if;
  begin
    p := aqar_parse(NEW.source_capture->>'source_text');
  exception when others then
    return NEW;
  end;

  NEW.direction       := p->>'direction';
  NEW.last_update     := coalesce(p->>'last_update', NEW.last_update);
  NEW.date_added      := coalesce(p->>'date_added', NEW.date_added);
  NEW.license_number  := p->>'license_number';
  NEW.license_expiry  := p->>'license_expiry';
  NEW.ad_source       := p->>'ad_source';
  NEW.plan_parcel     := p->>'plan_parcel';
  NEW.deed_area_m2    := public.safe_numeric(p->>'deed_area_m2');
  NEW.views_count     := public.safe_int(p->>'views_count');
  NEW.tenant_category := p->>'tenant_category';
  NEW.num_apartments  := public.safe_int(p->>'num_apartments');
  NEW.floor_number    := public.safe_int(p->>'floor_number');
  NEW.furnished       := public.safe_bool(p->>'furnished');
  NEW.discount_pct    := public.safe_int(p->>'discount_pct');
  NEW.price_original  := public.safe_bigint(p->>'price_original');

  if NEW.transaction_type='Buy' then
    parsed_price := public.safe_bigint(p->>'price');
    if parsed_price is not null then
      NEW.price_total := parsed_price;         -- trigger fully owns Buy total (source-parsed)
    end if;
  end if;
  -- price_per_meter is deliberately NOT touched here. It is a SOURCE-PUBLISHED field («سعر المتر»)
  -- parsed by scrapers/aqar/enrich_residential.py:141 parse_price_per_meter() and supplied on the
  -- incoming row. Any assignment in this trigger can only overwrite source truth with arithmetic.
  -- Do not reintroduce one; scripts/verify-aqar-trigger-preserves-source-ppm.ts fails the build.

  NEW.fullparse_done := true;
  return NEW;
end
$function$;

-- ── 2. the second destroyer ────────────────────────────────────────────────────────────────────
-- public.backfill_aqar_res() is an operator-invoked (not cron'd) live procedure that re-derives
-- price_per_meter exactly the same way; left alone it would silently re-corrupt every row this
-- migration repairs the next time an operator ran it. It had no committed definition either —
-- this brings it under version control with only the price_per_meter clause removed.
CREATE OR REPLACE PROCEDURE public.backfill_aqar_res(IN _batch integer DEFAULT 2000)
 LANGUAGE plpgsql
 SET statement_timeout TO '300000'
AS $procedure$
begin
  with src as (
    select id as pid, aqar_parse(source_capture->>'source_text') as pj
    from aqar_residential_listings
    where source_capture->>'source_text' is not null and fullparse_done = false
    order by id limit _batch
  )
  update aqar_residential_listings t set
    direction=src.pj->>'direction', last_update=src.pj->>'last_update', date_added=src.pj->>'date_added',
    license_number=src.pj->>'license_number', license_expiry=src.pj->>'license_expiry', ad_source=src.pj->>'ad_source',
    plan_parcel=src.pj->>'plan_parcel', deed_area_m2=nullif(src.pj->>'deed_area_m2','')::numeric,
    views_count=nullif(src.pj->>'views_count','')::int, tenant_category=src.pj->>'tenant_category',
    num_apartments=nullif(src.pj->>'num_apartments','')::int, furnished=(src.pj->>'furnished')::boolean,
    floor_number=nullif(src.pj->>'floor_number','')::int, discount_pct=nullif(src.pj->>'discount_pct','')::int,
    price_original=nullif(src.pj->>'price_original','')::bigint,
    price_total = case when t.transaction_type='Buy' and (src.pj ? 'discount_pct') and nullif(src.pj->>'price','')::bigint >= 50000
                       then (src.pj->>'price')::bigint else t.price_total end,
    -- price_per_meter deliberately NOT set: source-published field, see trg_aqar_parse().
    fullparse_done=true
  from src where t.id=src.pid;
end $procedure$;

-- ── 3. rollback ledger ─────────────────────────────────────────────────────────────────────────
-- Records exactly which rows the backfill below fills, so the data half of this migration is
-- exactly reversible (set price_per_meter = null for these ids). Only NULLs are ever filled, so
-- no pre-existing value is at risk.
CREATE TABLE IF NOT EXISTS public.ops_bk_aqar_ppm_20260726 (
  src_table text NOT NULL,
  id        bigint NOT NULL,
  PRIMARY KEY (src_table, id)
);

INSERT INTO public.ops_bk_aqar_ppm_20260726 (src_table, id)
SELECT 'aqar_residential_listings', id FROM public.aqar_residential_listings
 WHERE price_per_meter IS NULL AND source_capture->>'source_text' LIKE '%سعر المتر%'
ON CONFLICT DO NOTHING;

INSERT INTO public.ops_bk_aqar_ppm_20260726 (src_table, id)
SELECT 'aqar_commercial_listings', id FROM public.aqar_commercial_listings
 WHERE price_per_meter IS NULL AND source_capture->>'source_text' LIKE '%سعر المتر%'
ON CONFLICT DO NOTHING;

-- ── 4. backfill by RE-EXTRACTION (never by computation) ────────────────────────────────────────
-- source_capture->>'source_text' already holds the de-tagged page text captured at scrape time, so
-- the published value is recoverable WITHOUT a re-scrape. This reads the string the source printed;
-- it does not compute anything from price or area. Mirrors parse_price_per_meter() exactly:
--   * translate()  — Python's \d matches Arabic-Indic digits and int() parses them
--   * replace('متوسط سعر', ...) — stands in for the (?<!متوسط ) lookbehind PG lacks, neutralising
--     the market-average stats block only ("متوسط سعر المتر ...") and nothing else
--   * same capture group, same to_int() semantics (strip ',', truncate at '.')
-- The Python second-chance _PPM_RATE_RE ("N §/متر") fallback is intentionally NOT reimplemented:
-- all 4 no-match shapes present in this population return None in Python too, so SQL and Python
-- agree on every row here. Any residual self-heals on the next enrich.
CREATE OR REPLACE FUNCTION public.aqar_published_ppm(txt text)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
           split_part(
             replace(
               (regexp_match(
                  replace(translate($1, '٠١٢٣٤٥٦٧٨٩', '0123456789'), 'متوسط سعر', 'متوسط ***'),
                  'سعر\s*المتر(?:\s*المربع)?\s*:?\s*(\d[\d,]*(?:\.\d+)?)'))[1],
               ',', ''),
             '.', 1),
           '')::bigint;
$$;
COMMENT ON FUNCTION public.aqar_published_ppm(text) IS
  'Re-extracts the SOURCE-PUBLISHED «سعر المتر» from captured aqar page text. Mirrors '
  'scrapers/aqar/enrich_residential.py parse_price_per_meter(). Never derives from price/area.';

UPDATE public.aqar_residential_listings t
   SET price_per_meter = v.ppm
  FROM (SELECT id, public.aqar_published_ppm(source_capture->>'source_text') AS ppm
          FROM public.aqar_residential_listings
         WHERE price_per_meter IS NULL
           AND source_capture->>'source_text' LIKE '%سعر المتر%') v
 WHERE t.id = v.id AND v.ppm IS NOT NULL AND v.ppm <= 2147483647;   -- expect 822 rows

UPDATE public.aqar_commercial_listings t
   SET price_per_meter = v.ppm
  FROM (SELECT id, public.aqar_published_ppm(source_capture->>'source_text') AS ppm
          FROM public.aqar_commercial_listings
         WHERE price_per_meter IS NULL
           AND source_capture->>'source_text' LIKE '%سعر المتر%') v
 WHERE t.id = v.id AND v.ppm IS NOT NULL AND v.ppm <= 2147483647;   -- expect 255 rows

-- ── 5. monitoring: make this bug impossible to lose silently ───────────────────────────────────
-- The existing price_fidelity() comparison is structurally blind to it: it diffs search_listings_ar
-- against listing_native_location_v2, which are two projections of the SAME raw row — a corrupted
-- raw value agrees with itself. This adds a source-vs-stored check that reads the captured page
-- text, the only place the truth lives. Rebuilt from the LIVE mon_detect_price_fidelity() body;
-- the existing price_drift block is preserved verbatim. Already on cron jobid 42 (hourly :45), so
-- no new job and no mon_run_all_detectors edit.
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

  -- ppm_source_dropped: the source PUBLISHES «سعر المتر» but we store NULL. Post-backfill floor is
  -- 0; a non-zero value means an ingestion path is discarding a published price signal again.
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
