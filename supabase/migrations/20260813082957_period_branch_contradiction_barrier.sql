-- Period-branch label contradiction barrier (Search & Matching QA, 2026-08-13)
--
-- THE CLASS. The Normal Filter's «سنوي» / «شهري» chips are resolved inside
-- location_search_candidates_ar by this predicate:
--
--   p_rent_period is null
--    or s.deal_ar <> 'إيجار'
--    or (p_rent_period = 'شهري' and s.payment_monthly = true)
--    or (p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي'
--          or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
--
-- Two of those arms surface a listing under a chip that contradicts the listing's OWN
-- rent_period_ar — the value the property card displays:
--   A) «سنوي» admits a rent_period_ar='شهري' row when rent_now_pay_later is true. This is the
--      deliberate RNPL / «إيجار الآن وادفع لاحقاً» carve-out: the contract is annual, paid in
--      installments (docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md §3).
--   B) «شهري» admits any payment_monthly=true row regardless of rent_period_ar, so a
--      rent_period_ar='سنوي' row can surface under «شهري».
--
-- Measured live 2026-08-13 across all 75,290 production_ready Rent rows: A = 1, B = 0. Both
-- monthly-only platforms (gathern 29,083 / aqarmonthly 1,600) are 100% consistent
-- (rent_period_ar='شهري' AND payment_monthly=true), so they never cross a branch.
--
-- WHAT THIS GUARDS. Not the existence of the carve-out — it is intended, and one row is not a
-- defect this detector may assert is wrong (source truth for that listing lives on aqar.fm and is
-- not provable from here; per the standing rules the row is NOT modified). What it guards is the
-- carve-out going SYSTEMIC: a rent-period parser regression, or a payment_monthly / rent_now_pay_later
-- write-path change, could flip thousands of rows into the wrong period chip at once. That is
-- invisible today — no detector on the 46-strong roster covers period-branch vs displayed-label
-- disagreement (rent_period_unreachable covers periods that are NEITHER value;
-- rent_period_contradicts_capture and rent_period_source_mismatch compare against the platform's own
-- capture, not against which chip surfaces the row; filter_barrier_leaks covers only hard barriers —
-- missing location/deal, impossible price/size).
--
-- The floor is deliberately well above today's known state so a quiet, intended handful stays quiet
-- and only a real regression speaks. Never widen a search or edit a row to silence it: fix the
-- write path that mislabelled the period.
create or replace function public.mon_detect_period_branch_contradiction()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_floor    constant int := 50;   -- today's observed state is 1; a regression is orders of magnitude bigger
  v_annual   bigint;               -- surfaced under «سنوي», card says «شهري» (RNPL carve-out)
  v_monthly  bigint;               -- surfaced under «شهري», card says «سنوي»
  v_total    bigint;
  v_open     text;
  n int := 0;
begin
  select
    count(*) filter (where rent_period_ar = 'شهري' and coalesce(rent_now_pay_later, false)),
    count(*) filter (where rent_period_ar = 'سنوي' and coalesce(payment_monthly, false))
    into v_annual, v_monthly
  from public.search_listings_ar
  where production_ready and deal_ar = 'إيجار';

  v_total := coalesce(v_annual, 0) + coalesce(v_monthly, 0);

  select severity into v_open
  from public.alert_event
  where dedup_key = 'period_branch_contradiction' and resolved_at is null
  order by created_at desc limit 1;

  if v_total <= v_floor then
    if v_open is not null then
      perform public.mon_resolve_key('period_branch_contradiction', 'period_branch_contradiction');
    end if;
  elsif v_open is distinct from 'P2' then
    if v_open is not null then
      perform public.mon_resolve_key('period_branch_contradiction', 'period_branch_contradiction');
    end if;
    n := n + public.mon_raise('P2', 'period_branch_contradiction', 'all', 'period_branch_contradiction',
      jsonb_build_object(
        'why', 'Rent listings are being surfaced under a period chip that contradicts the rent_period_ar '
            || 'the property card displays, at a scale past the intended RNPL carve-out. The user asks for '
            || '«سنوي» and sees a card labelled «شهري» (or the reverse). Investigate the rent-period parser '
            || 'and the payment_monthly / rent_now_pay_later write paths — never widen the search, never '
            || 'edit a source-published period to silence this.',
        'annual_chip_shows_monthly_card', v_annual,
        'monthly_chip_shows_annual_card',  v_monthly,
        'total', v_total,
        'floor', v_floor,
        'baseline_2026_08_13', 1));
  end if;

  return n;
end $function$;

comment on function public.mon_detect_period_branch_contradiction() is
  'Search & Matching QA barrier (2026-08-13): fires when the «سنوي»/«شهري» chips surface listings whose own displayed rent_period_ar contradicts the chip, past the intended RNPL carve-out (baseline 1, floor 50).';

-- Roster wiring — GUARDED NEEDLE-EDIT (scripts/verify-detector-roster-edits-are-guarded.ts).
-- Read the LIVE body, assert the anchor, splice the one new name in, execute. Never paste a
-- hand-written roster: that silently drops every entry the copy predates (it has happened 4 times).
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if position('mon_detect_period_branch_contradiction' in v_def) > 0 then return; end if;
  if position('''mon_detect_orphaned_detectors''' in v_def) = 0 then
    raise exception 'roster anchor missing';
  end if;

  v_new := replace(v_def, '    ''mon_detect_orphaned_detectors''',
    '    ''mon_detect_period_branch_contradiction'','
    || E'\n    ''mon_detect_orphaned_detectors''');
  if v_new = v_def then raise exception 'roster needle-edit produced no change'; end if;
  execute v_new;
end $$;
