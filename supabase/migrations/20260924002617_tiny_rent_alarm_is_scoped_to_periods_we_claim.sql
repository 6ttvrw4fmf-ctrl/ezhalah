-- THE TINY-RENT ALARM NOW ASKS WHOSE CLAIM THE NUMBER IS.
--
-- Check (c) of mon_check_run_field_ranges demotes a run when >20% of the slice's ACTIVE Rent rows
-- carry price_annual < 500. It exists for ONE regression shape: a MONTHLY figure stored as an
-- ANNUAL one. That shape is always a claim WE made — the fleet stores monthly × 12, so a monthly
-- price surfacing untouched in price_annual means our own conversion or our own period is wrong.
--
-- WHAT IT ACTUALLY CAUGHT, 2026-09-21..23: gomenassat. Its source publishes rents of «80», «170»,
-- «300» with NO period anywhere on the page, so the scraper stores the figure verbatim with
-- rent_period NULL (PERIOD = SOURCE; owner 2026-09-21: «if the price says it in yearly then its
-- yearly simple», silence stays silence). 7 of its 24 active rents are under 500 = 29% > 20%, so
-- every single run was demoted to ok=False with 142 perfectly faithful rows written. Three nights
-- running. A daily false P2 on a healthy platform is how a real silent-death alert gets ignored.
--
-- WE ARE PLUMBERS: we publish what the source publishes, at any magnitude (owner 2026-08-03, no
-- plausibility floor). So the fix is NOT to hide those prices, not to exempt a platform by name
-- (an allowlist never re-checks itself), and not to move the 500 line — it is to scope the alarm to
-- the rows where the number is OUR assertion:
--
--   rent_period IS NOT NULL  →  we told the user this is a yearly/monthly rent. A sub-500 annual
--                               then contradicts our own conversion. STILL FLAGGED, unchanged.
--   rent_period IS NULL      →  the source stated no period and we invented none. The figure is the
--                               advertiser's own, passed through untouched. NOT our defect.
--
-- The monthly-as-annual regression the check was built for sets a period (that is what makes it a
-- misclassification), so it stays caught — proven below by executing the real function on both
-- shapes. Every other check in the function is untouched.
--
-- All 143 *_listings tables carry rent_period (introspected 2026-09-24), so the predicate is safe
-- fleet-wide. The body is patched from the LIVE definition rather than pasted from a migration:
-- this function is redefined by many migrations and pasting an older body would silently revert
-- whoever changed it last.
do $patch$
declare
  src     text;
  patched text;
  old_a   constant text := '      count(*) filter (where transaction_type = ''Rent'' and active),
      count(*) filter (where transaction_type = ''Rent'' and active and price_annual < 500),';
  new_a   constant text := '      count(*) filter (where transaction_type = ''Rent'' and active and rent_period is not null),
      count(*) filter (where transaction_type = ''Rent'' and active and rent_period is not null and price_annual < 500),';
begin
  src := pg_get_functiondef('public.mon_check_run_field_ranges(bigint,text,text,timestamptz,text[])'::regprocedure);

  if position(new_a in src) > 0 then
    raise notice 'tiny-rent check is already scoped to claimed periods — nothing to patch';
    return;
  end if;
  if (length(src) - length(replace(src, old_a, ''))) / length(old_a) <> 1 then
    raise exception 'the tiny-rent counters were not found exactly once in the live body — refusing to guess';
  end if;

  patched := replace(src, old_a, new_a);
  -- keep the prose beside the code honest, in the same edit
  patched := replace(patched,
    '  -- (c) suspicious-tiny-rent pattern — unchanged from Batch 0: >20% of the slice''s ACTIVE',
    '  -- (c) suspicious-tiny-rent pattern — SCOPED 2026-09-24 to rows where rent_period is NOT NULL,
  -- i.e. where the annual figure is OUR claim. A period-silent rent is the advertiser''s own number
  -- stored verbatim (PERIOD = SOURCE) and is not evidence of a parse defect; gomenassat published
  -- three nights of false P2s that way. The monthly-as-annual regression this guards still sets a
  -- period, so it stays caught — see mon_selftest_rent_tiny_gate().
  -- Original wording: >20% of the slice''s ACTIVE');
  execute patched;
end
$patch$;

-- ── the barrier: it EXECUTES the real function on both shapes, and says which one it is ──────────
-- Everything runs inside a subtransaction that is always rolled back, so the fixture table, and any
-- alert mon_raise() writes on the positive case, leave no production residue.
create or replace function public.mon_selftest_rent_tiny_gate()
 returns text language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_silent   boolean;   -- 7 tiny rents, NO period stated by the source  → must NOT degrade
  v_claimed  boolean;   -- the same 7, with rent_period='annual'          → MUST degrade
  v_monthly  boolean;   -- the same 7, with rent_period='monthly'         → MUST degrade
  v_clean    boolean;   -- claimed periods, no tiny rent                  → must NOT degrade
  v_result   text := 'PASS';
begin
  begin
    create table public.mon_selftest_rent_rows (
      ad_number text, listing_url text, property_type text, transaction_type text,
      price_total bigint, price_annual bigint, city text, region text,
      active boolean, last_seen_at timestamptz, raw_captured_at timestamptz, rent_period text);

    -- 24 active rents: 7 under 500 (the gomenassat shape: 80, 170, 300, 350, 390, 470, 499).
    insert into public.mon_selftest_rent_rows
    select 'SELFTEST-' || i, 'https://example.test/' || i, 'Apartment', 'Rent',
           null, case when i <= 7 then (array[80,170,300,350,390,470,499])[i] else 60000 end,
           'الرياض', 'منطقة الرياض', true, now(), now(), null
      from generate_series(1, 24) i;

    v_silent := public.mon_check_run_field_ranges(
      -1, 'selftest', 'mon_selftest_rent_rows', now() - interval '1 hour', array['غير محدد']::text[]);

    update public.mon_selftest_rent_rows set rent_period = 'annual';
    v_claimed := public.mon_check_run_field_ranges(
      -1, 'selftest', 'mon_selftest_rent_rows', now() - interval '1 hour', array['غير محدد']::text[]);

    update public.mon_selftest_rent_rows set rent_period = 'monthly';
    v_monthly := public.mon_check_run_field_ranges(
      -1, 'selftest', 'mon_selftest_rent_rows', now() - interval '1 hour', array['غير محدد']::text[]);

    update public.mon_selftest_rent_rows set price_annual = 60000;
    v_clean := public.mon_check_run_field_ranges(
      -1, 'selftest', 'mon_selftest_rent_rows', now() - interval '1 hour', array['غير محدد']::text[]);

    if v_silent then
      v_result := 'FAIL: a period-SILENT tiny rent (the source''s own figure, stored verbatim) '
               || 'demoted the run — the plumber rule is broken';
    elsif not v_claimed then
      v_result := 'FAIL: a sub-500 annual rent we CLAIMED as annual did not degrade — the '
               || 'monthly-as-annual regression would now ship unnoticed';
    elsif not v_monthly then
      v_result := 'FAIL: a sub-500 annual rent we claimed as monthly did not degrade';
    elsif v_clean then
      v_result := 'FAIL: claimed periods with no tiny rent degraded anyway — the check cries wolf';
    end if;

    raise exception 'selftest rollback';          -- always: no residue, ever
  exception when others then
    if sqlerrm <> 'selftest rollback' then
      v_result := 'FAIL: ' || sqlerrm;
    end if;
  end;
  return v_result;
end
$fn$;

-- A reverting CREATE OR REPLACE is exactly how this defect would come back, and it would come back
-- silently. The detector re-runs the proof on a schedule and raises like any other monitor.
create or replace function public.mon_detect_rent_tiny_gate_reverted()
 returns text language plpgsql security definer set search_path to 'public'
as $fn$
declare v text;
begin
  v := public.mon_selftest_rent_tiny_gate();
  if v <> 'PASS' then
    perform public.mon_raise('P2', 'monitor_integrity', 'fleet', 'rent_tiny_gate_reverted',
      jsonb_build_object('selftest', v,
        'means', 'mon_check_run_field_ranges check (c) no longer distinguishes a period we CLAIM '
              || 'from a price the source published with no period; healthy platforms will be '
              || 'demoted to ok=False daily (gomenassat, 2026-09-21..23)'));
  end if;
  return v;
end
$fn$;

do $run$
declare v text;
begin
  v := public.mon_selftest_rent_tiny_gate();
  if v <> 'PASS' then
    raise exception 'tiny-rent gate selftest did not pass: %', v;
  end if;
  raise notice 'tiny-rent gate: period-silent rents pass, claimed-period tiny rents still degrade';
end
$run$;

select cron.schedule('mon-rent-tiny-gate-reverted', '35 6 * * *',
  $$select public.mon_detect_rent_tiny_gate_reverted();$$);
