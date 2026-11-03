-- mon_detect_cheap_yearly_rent_served() cried wolf on 856 correct rows (P1 open since 2026-10-31). Every one was a
-- rent whose source prints NO period, judged from its price by enforce_rent_period_judgment() (owner 2026-09-28,
-- built 2026-10-31): 300–7,999 on a home/business type = a per-month figure, served as a yearly listing ×12, flagged
-- rent_period_judged. The detector compared those rows with rent_price_annual_ar(), which leaves a period-less
-- figure as published — so muhaysini 14820560 («السعر الاجمالى 2,000», no period on the page) read as wrong at
-- 24,000 although that is exactly the rule. The invariant now expects, for a judged row with no source period,
-- what the judgment writes (figure ×12 when judge_silent_rent_period_ar says شهري, else the rule); every other row
-- is checked exactly as before. Measured after the change: 0 rows off the invariant, judged or not.
do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_cheap_yearly_rent_served'::regproc);
  rule_e constant text := 'public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type)';
  exp_e constant text := '(case when s.rent_period_judged and v.platform not in (''gathern'', ''aqarmonthly'') and v.rent_period is null and public.judge_silent_rent_period_ar(coalesce(v.price_annual, v.price_total), s.type_ar) = ''شهري'' then coalesce(v.price_annual, v.price_total) * 12 else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end)';
  a_old text := rule_e || ' as per_rule';
  b_old text := 's.price_annual is distinct from ' || rule_e;
begin
  -- the third occurrence is inside the alert's 'action' text and stays as written
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1
     or (length(d) - length(replace(d, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'mon_detect_cheap_yearly_rent_served: the two rule expressions were not found exactly once';
  end if;
  execute replace(replace(d, a_old, exp_e || ' as per_rule'), b_old, 's.price_annual is distinct from ' || exp_e);
end
$mig$;
