-- ═══ THE MONTHLY BUDGET, MADE EXPLICIT ═══════════════════════════════════════════════════════
-- Owner 2026-08-31: "my monthly budget is 62 dollars in deepseek", and ~$2/day is the average that
-- implies. Those two numbers are the same statement: the daily ceiling already in ai_spend_config
-- ($2.00) multiplied by the longest month (31) is EXACTLY $62.00, so the existing breaker is already
-- a hard monthly bound — the month cannot overrun even in the worst case.
--
-- What was missing is visibility. A ceiling you only meet by crashing into it is not a budget; the
-- owner should be able to see where the month stands, and be told BEFORE it matters, not after.
alter table public.ai_spend_config
  add column if not exists monthly_budget_usd numeric not null default 62.00;

comment on column public.ai_spend_config.monthly_budget_usd is
  'The owner''s stated monthly DeepSeek budget (2026-08-31: $62). Informational for reporting and the '
  'burn-rate detector — the ENFORCED limits are max_usd_per_day/hour, and 2.00 x 31 = 62.00 already '
  'bounds the month. Keep the three consistent if any is changed.';

-- ═══ WHERE THE MONTH STANDS ══════════════════════════════════════════════════════════════════
-- Deliberately a SEPARATE function rather than an edit to ai_cost_dashboard(): that one is edited by
-- several sessions, and rewriting a shared function body wholesale is how a concurrent change gets
-- silently reverted (repo rule: build from the LIVE definition, needle-edit, never full-body replace).
create or replace function public.ai_budget_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with c as (select monthly_budget_usd, max_usd_per_day, max_usd_per_hour from public.ai_spend_config where id),
       m as (
         select coalesce(sum(usd), 0) as mtd,
                greatest(extract(day from now())::int, 1) as days_elapsed,
                extract(day from (date_trunc('month', now()) + interval '1 month - 1 day'))::int as days_in_month
           from public.ai_usage_costed
          where at >= date_trunc('month', now())
       )
  select jsonb_build_object(
    'month', to_char(now(), 'YYYY-MM'),
    'budget_usd', c.monthly_budget_usd,
    'spent_month_to_date_usd', round(m.mtd, 4),
    'percent_of_budget_used', round(100 * m.mtd / nullif(c.monthly_budget_usd, 0), 2),
    'remaining_usd', round(c.monthly_budget_usd - m.mtd, 4),
    'days_elapsed', m.days_elapsed,
    'days_in_month', m.days_in_month,
    -- Straight-line projection from the burn so far. Honest about being a projection, not a promise.
    'projected_month_end_usd', round(m.mtd / m.days_elapsed * m.days_in_month, 4),
    'projected_percent_of_budget',
      round(100 * (m.mtd / m.days_elapsed * m.days_in_month) / nullif(c.monthly_budget_usd, 0), 2),
    -- What the ENFORCED daily ceiling means for the month, so the two numbers are never confused.
    'enforced_daily_ceiling_usd', c.max_usd_per_day,
    'worst_case_month_usd', round(c.max_usd_per_day * m.days_in_month, 2),
    'budget_is_hard_bounded', (c.max_usd_per_day * m.days_in_month) <= c.monthly_budget_usd,
    'messages_affordable_this_month', round(c.monthly_budget_usd / 0.00036972)
  )
  from c, m;
$function$;

comment on function public.ai_budget_status() is
  'Month-to-date DeepSeek spend against the owner''s stated monthly budget, with a straight-line '
  'projection and a check that the enforced daily ceiling still hard-bounds the month.';

-- ═══ TELL ME BEFORE IT MATTERS ═══════════════════════════════════════════════════════════════
-- Alerts on the BURN RATE, not just the total: reaching 50% of the budget on day 3 is a problem
-- worth knowing about, while reaching 50% on day 25 is simply a month being used as intended.
create or replace function public.mon_detect_ai_budget_burn()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  live_keys text[] := '{}';
  st jsonb;
  pct numeric; proj_pct numeric; mtd numeric; budget numeric; day_n int;
begin
  st := public.ai_budget_status();
  pct      := (st->>'percent_of_budget_used')::numeric;
  proj_pct := (st->>'projected_percent_of_budget')::numeric;
  mtd      := (st->>'spent_month_to_date_usd')::numeric;
  budget   := (st->>'budget_usd')::numeric;
  day_n    := (st->>'days_elapsed')::int;

  -- Only meaningful once a couple of days of the month exist; a single heavy hour on day 1
  -- projects to an absurd month and would cry wolf.
  if day_n >= 3 and proj_pct is not null then
    if proj_pct >= 100 then
      n := n + public.mon_raise('P1', 'ai_cost_health', 'deepseek', 'ai_budget_projection_over',
        st || jsonb_build_object(
          'what_this_means', format('At the current burn this month lands near $%s against a $%s budget.',
                                    st->>'projected_month_end_usd', budget),
          'first_check', 'public.ai_cost_dashboard() -> calls.by_source_24h. If the volume is ci/selftest it is automation, not customers: fix the job rather than the budget.',
          'rule', 'The enforced daily ceiling still bounds the month. Raise a ceiling only as a deliberate owner decision, never to clear this alert.'));
      live_keys := live_keys || array['ai_budget_projection_over'];
    elsif pct >= 50 then
      n := n + public.mon_raise('P2', 'ai_cost_health', 'deepseek', 'ai_budget_half_spent',
        st || jsonb_build_object(
          'what_this_means', format('Half the monthly budget is gone on day %s of %s.', day_n, st->>'days_in_month'),
          'first_check', 'Is this real user growth or automation? Check by_source before treating it as either.',
          'rule', 'Informational. Growth is good news; automation burning the budget is not.'));
      live_keys := live_keys || array['ai_budget_half_spent'];
    end if;
  end if;

  -- The daily ceiling must keep the month bounded. If someone raises max_usd_per_day past
  -- budget/days, the "hard bound" quietly stops being one — that is worth saying out loud.
  if not (st->>'budget_is_hard_bounded')::boolean then
    n := n + public.mon_raise('P2', 'ai_cost_health', 'deepseek', 'ai_budget_no_longer_bounded',
      st || jsonb_build_object(
        'what_this_means', 'The enforced daily ceiling multiplied by the days in this month now EXCEEDS the stated monthly budget, so the breaker alone no longer guarantees the budget.',
        'first_check', 'select max_usd_per_day, monthly_budget_usd from public.ai_spend_config;',
        'rule', 'Either lower max_usd_per_day or raise monthly_budget_usd deliberately — but do not leave them contradicting each other.'));
    live_keys := live_keys || array['ai_budget_no_longer_bounded'];
  end if;

  perform public.mon_resolve_stale_keys('ai_cost_health_budget', live_keys);
  return n;
end
$function$;

-- Register in the twice-hourly sweep. NEEDLE EDIT off the LIVE definition, idempotent, refuses to
-- guess if the anchor moved (repo rule: never full-body-replace a shared function).
do $do$
declare src text; anchor text := '''mon_detect_ai_telemetry_health'','; hits int;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_ai_budget_burn' in src) > 0 then raise notice 'already registered'; return; end if;
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then raise exception 'anchor matched % times, expected 1', hits; end if;
  execute replace(src, anchor, anchor || chr(10) || '    ''mon_detect_ai_budget_burn'',');
end $do$;
