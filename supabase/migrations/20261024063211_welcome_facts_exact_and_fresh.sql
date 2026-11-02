-- HOME HEADLINE FACTS: EXACT AND FRESH, part 1 — the math (owner-approved 2026-10-24: «we can get sued», accuracy first).
--
-- What was wrong (measured 2026-10-24):
--   * every «متوسط» number is a MEDIAN (8 percentile_cont(0.5), 0 avg()); the words are fixed in part 2;
--   * the facts were built once a night (cron 21:40 UTC), so by evening «this week» numbers were a day old
--     (Khobar حي الخزامى hot_district said 17 new / 10%; live 27 / 13%).
--
-- This part:
--   1. public.welcome_kind_stat — ONE declared registry of what each line's number IS (median / count / share /
--      pct_change), its time window (rolling 7 days, rolling 30 days, yesterday), and for medians the exact
--      population (predicate + value over the checker's de-duplicated rows). Part 2's wording guard reads it.
--   2. Medians are shown ROUNDED UP (ceil), never to the nearest: the sentence says «نص … {a} أو أقل» ("half …
--      {a} or less"), and at least half of the values are ≤ ceil(median) for ANY data. Nearest rounding can make
--      it false (two middle values 337.2 / 337.6 → median 337.4 → 337: only n/2 − 1 values are ≤ 337).
--      Builder + its two helpers + the checker change together (welcome_shown()).
--   3. The independent checker (audit_welcome_insights, same build transaction) now also tests each median
--      line's LITERAL claim on its own rows (welcome_claim_holds): at least half ≤ a (and ≤ b). A false claim is
--      removed before anyone sees it, like a number the checker cannot reproduce.
--   4. Any checker disagreement is P1 (was P1 only above 1%). Freshness: rebuilt every 3 hours at :45
--      (after the :22 index sync and its :33/:35 rebuilds); a build older than 3h30 is P2, older than 6h30 P1.
--      A failed build rolls back inside its own transaction, so the previous facts stay served.
--
-- Needle edits of the live definitions (exactly one occurrence each, or nothing changes). Apply-time proof below.
create table if not exists public.welcome_kind_stat (
  kind text primary key,
  stat text not null check (stat in ('median', 'mean', 'count', 'share', 'pct_change')),
  time_window text check (time_window in ('7d', '30d', 'yesterday')),
  plurality boolean not null default false,  -- «the district with the most», never «most of them»
  steady_sites boolean not null default false, -- measured on the sites read steadily both weeks only
  known_age_only boolean not null default false, -- share among listings that state their age
  scope text check (scope in ('city', 'district', 'gap', 'month_city', 'month_district')),
  pred_sql text,   -- medians: the rows (over the checker's a_b, alias b) the number is the median of
  value_sql text,  -- medians: the value
  check ((stat = 'median') = (scope is not null and pred_sql is not null and value_sql is not null))
);
alter table public.welcome_kind_stat enable row level security;
comment on table public.welcome_kind_stat is
  'What each home-headline fact''s number IS. Part 2''s template guard requires the words to say exactly this (a median reads «نص … أو أقل», never «متوسط»).';

insert into public.welcome_kind_stat (kind, stat, time_window, plurality, steady_sites, known_age_only, scope, pred_sql, value_sql) values
  ('city_new_districts', 'count', '7d', false, false, false, null, null, null),
  ('hot_district',       'count', '7d', false, false, false, null, null, null),
  ('yesterday',          'count', 'yesterday', false, false, false, null, null, null),
  ('city_land',          'count', null, true, false, false, null, null, null),
  ('city_sale',          'count', null, true, false, false, null, null, null),
  ('city_bld_sale',      'count', null, true, false, false, null, null, null),
  ('week_land',          'count', '7d', true, false, false, null, null, null),
  ('week_apt_sale',      'count', '7d', true, false, false, null, null, null),
  ('week_bld_sale',      'count', '7d', true, false, false, null, null, null),
  ('land_share',         'share', null, false, false, false, null, null, null),
  ('new_build',          'share', null, false, false, true,  null, null, null),
  ('wow_land_up',        'pct_change', '7d', false, true, false, null, null, null),
  ('wow_land_down',      'pct_change', '7d', false, true, false, null, null, null),
  ('wow_apt_sale_up',    'pct_change', '7d', false, true, false, null, null, null),
  ('wow_apt_sale_down',  'pct_change', '7d', false, true, false, null, null, null),
  ('wow_bld_up',         'pct_change', '7d', false, true, false, null, null, null),
  ('wow_bld_down',       'pct_change', '7d', false, true, false, null, null, null),
  ('land_ppm_city',  'median', null,  false, false, false, 'city',
     $p$b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000$p$, 'b.price_per_meter'),
  ('land_gap',       'median', null,  false, false, false, 'gap',
     $p$b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000$p$, 'b.price_per_meter'),
  ('rent_apt',       'median', null,  false, false, false, 'district',
     $p$b.deal_ar = 'إيجار' and b.type_ar = 'شقة' and b.price_annual between 6000 and 500000 and b.platform not in ('gathern', 'aqarmonthly')$p$, 'b.price_annual'),
  ('rent_gap',       'median', null,  false, false, false, 'gap',
     $p$b.deal_ar = 'إيجار' and b.type_ar = 'شقة' and b.price_annual between 6000 and 500000 and b.platform not in ('gathern', 'aqarmonthly')$p$, 'b.price_annual'),
  ('villa_area',     'median', null,  false, false, false, 'district',
     $p$b.type_ar = 'فيلا' and b.area_m2 between 100 and 5000$p$, 'b.area_m2'),
  ('shop_rent',      'median', null,  false, false, false, 'district',
     $p$b.deal_ar = 'إيجار' and b.type_ar = 'محل' and b.price_annual between 3000 and 2000000$p$, 'b.price_annual'),
  ('apt_sale_ppm',   'median', null,  false, false, false, 'district',
     $p$b.deal_ar = 'بيع' and b.type_ar = 'شقة' and b.price_total between 100000 and 20000000 and b.area_m2 between 30 and 1000$p$, 'b.price_total / b.area_m2'),
  ('villa_price',    'median', null,  false, false, false, 'district',
     $p$b.deal_ar = 'بيع' and b.type_ar = 'فيلا' and b.price_total between 200000 and 50000000$p$, 'b.price_total'),
  ('bld_price',      'median', null,  false, false, false, 'district',
     $p$b.deal_ar = 'بيع' and b.type_ar = 'عمارة' and b.price_total between 300000 and 200000000$p$, 'b.price_total'),
  ('month_apt_ppm',  'median', '30d', false, false, false, 'month_district',
     $p$b.deal_ar = 'بيع' and b.type_ar = 'شقة' and b.price_total between 100000 and 20000000 and b.area_m2 between 30 and 1000$p$, 'b.price_total / b.area_m2'),
  ('month_land_ppm', 'median', '30d', false, false, false, 'month_city',
     $p$b.deal_ar = 'بيع' and b.type_ar like 'أرض%' and b.price_per_meter between 10 and 50000$p$, 'b.price_per_meter'),
  ('month_bld_ppm',  'median', '30d', false, false, false, 'month_city',
     $p$b.deal_ar = 'بيع' and b.type_ar = 'عمارة' and b.price_total between 300000 and 200000000 and b.area_m2 between 100 and 20000$p$, 'b.price_total / b.area_m2')
on conflict (kind) do nothing;

-- The number a line shows: a median rounded UP (so «half … or less» is true), everything else to the nearest.
create or replace function public.welcome_shown(p_kind text, p_v numeric) returns numeric
language sql stable set search_path to '' as $f$
  select case when (select s.stat from public.welcome_kind_stat s where s.kind = p_kind) = 'median' then ceil(p_v) else round(p_v) end
$f$;

-- A median line's literal claim, on the checker's own rows (temp table a_b of audit_welcome_insights): at least half
-- of the values are ≤ a (and ≤ b for the second district / the previous 30 days). Not a median → nothing to test.
create or replace function public.welcome_claim_holds(p_kind text, p_city_id int, p_district text, p_district2 text, p_a numeric, p_b numeric)
returns boolean language plpgsql volatile set search_path to public, pg_temp as $f$
declare s record; ok boolean := true;
  q constant text := 'select count(*) > 0 and count(*) filter (where (%s) <= $4) * 2 >= count(*) from a_b b where b.city_id = $1 and (%s) and (%s)';
begin
  select * into s from public.welcome_kind_stat k where k.kind = p_kind;
  if s.stat is distinct from 'median' then return true; end if;
  if p_a is null then return false; end if;
  case s.scope
    when 'city' then
      execute format(q, s.value_sql, s.pred_sql, 'true') into ok using p_city_id, p_district, p_district2, p_a;
    when 'district' then
      execute format(q, s.value_sql, s.pred_sql, 'b.dist = $2') into ok using p_city_id, p_district, p_district2, p_a;
    when 'gap' then
      execute format(q, s.value_sql, s.pred_sql, 'b.dist = $2') into ok using p_city_id, p_district, p_district2, p_a;
      if ok then execute format(q, s.value_sql, s.pred_sql, 'b.dist = $3') into ok using p_city_id, p_district, p_district2, p_b; end if;
    when 'month_city' then
      execute format(q, s.value_sql, s.pred_sql, 'b.is_m1') into ok using p_city_id, p_district, p_district2, p_a;
      if ok then execute format(q, s.value_sql, s.pred_sql, 'b.is_m0') into ok using p_city_id, p_district, p_district2, p_b; end if;
    when 'month_district' then
      execute format(q, s.value_sql, s.pred_sql, 'b.is_m1 and b.dist = $2') into ok using p_city_id, p_district, p_district2, p_a;
      if ok then execute format(q, s.value_sql, s.pred_sql, 'b.is_m0 and b.dist = $2') into ok using p_city_id, p_district, p_district2, p_b; end if;
  end case;
  return coalesce(ok, false);
end
$f$;
revoke all on function public.welcome_claim_holds(text, int, text, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.welcome_shown(text, numeric) from public, anon, authenticated;

do $mig$
declare
  def text; n int;
  edits constant text[][] := array[
    -- [function, needle, replacement, expected occurrences]
    array['public.build_welcome_insights()', 'round(percentile_cont(0.5)', 'ceil(percentile_cont(0.5)', '4'],
    array['public.build_welcome_insights()', 'round(max(m)::numeric) hiv, round(min(m)::numeric) lov', 'ceil(max(m)::numeric) hiv, ceil(min(m)::numeric) lov', '1'],
    array['public.build_welcome_insights()', $n$'rent_apt', region_ar, city_ar, city_id, district_ar, round(m::numeric)$n$, $r$'rent_apt', region_ar, city_ar, city_id, district_ar, ceil(m::numeric)$r$, '1'],
    array['public.build_welcome_insights()', 'round(hiv::numeric), round(lov::numeric)', 'ceil(hiv::numeric), ceil(lov::numeric)', '1'],
    array['public.welcome_district_median(date,text,text,text,integer)', 'round(percentile_cont(0.5)', 'ceil(percentile_cont(0.5)', '1'],
    array['public.welcome_month(date,text,boolean,text,text,timestamp with time zone)', 'round(m1::numeric), round(m0::numeric)', 'ceil(m1::numeric), ceil(m0::numeric)', '1'],
    array['public.audit_welcome_insights()',
      $n$    if why is null and (x is null or round(x) <> r.a or (r.b is not null and (y is null or round(y) <> r.b))) then
      why := 'number_differs';
    end if;$n$,
      $r$    -- a median is shown rounded UP (welcome_shown), so «half … or less» stays true (2026-10-24)
    if why is null and (x is null or public.welcome_shown(r.kind, x) <> r.a or (r.b is not null and (y is null or public.welcome_shown(r.kind, y) <> r.b))) then
      why := 'number_differs';
    end if;
    -- the sentence's literal claim on these rows: at least half ≤ a (and ≤ b)
    if why is null and not public.welcome_claim_holds(r.kind, r.city_id, r.district_ar, r.district2_ar, r.a, r.b) then
      why := 'claim_false';
    end if;$r$, '1'],
    array['public.mon_detect_welcome_insights_audit()', $n$case when a.failed * 100 > a.checked then 'P1' else 'P2' end$n$, $r$'P1'$r$, '1']
  ];
  i int;
begin
  for i in 1 .. array_length(edits, 1) loop
    def := pg_get_functiondef(edits[i][1]::regprocedure);
    n := (length(def) - length(replace(def, edits[i][2], ''))) / length(edits[i][2]);
    if n <> edits[i][4]::int then
      raise exception 'welcome exact: % carries the needle «%» % times (expected %) — refusing', edits[i][1], left(edits[i][2], 60), n, edits[i][4];
    end if;
    execute replace(def, edits[i][2], edits[i][3]);
  end loop;
  if position('avg(' in pg_get_functiondef('public.build_welcome_insights()'::regprocedure)) > 0 then
    raise exception 'welcome exact: the builder computes a mean somewhere — every line must then say so';
  end if;
end
$mig$;

-- Freshness alarm: the facts are rebuilt every 3 hours; a build older than 3h30 is P2, older than 6h30 (two missed) P1.
do $mig$
declare def text; needle constant text := $n$  if last_day is null or last_day < (now() at time zone 'Asia/Riyadh')::date - 1 or kinds < 15 or rows_ < 200 then
    live := live || 'welcome_insights_stale:fleet'::text;
    n := n + public.mon_raise('P2', 'welcome_insights_stale', 'fleet', 'welcome_insights_stale:fleet',$n$;
  replacement constant text := $r$  -- rebuilt every 3 hours since 2026-10-24: older than 3h30 = one build missed (P2), 6h30 = two (P1)
  if last_day is null or kinds < 15 or rows_ < 200
     or coalesce((select max(built_at) from public.welcome_insight_build), '-infinity') < now() - interval '3 hours 30 minutes' then
    live := live || 'welcome_insights_stale:fleet'::text;
    n := n + public.mon_raise(case when last_day is null
                                     or coalesce((select max(built_at) from public.welcome_insight_build), '-infinity') < now() - interval '6 hours 30 minutes'
                                   then 'P1' else 'P2' end,
      'welcome_insights_stale', 'fleet', 'welcome_insights_stale:fleet',$r$;
begin
  def := pg_get_functiondef('public.mon_detect_welcome_insights_stale()'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'welcome exact: the stale detector changed under us — refusing';
  end if;
  execute replace(def, needle, replacement);
end
$mig$;

-- Every 3 hours, after the :22 index sync (≈4 min) and its :33/:35 rebuilds; 21:45 UTC = 00:45 Riyadh starts the new day.
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'build-welcome-insights'), schedule := '45 */3 * * *');

-- Apply-time proof (no side effects: synthetic rows in a temp a_b, a detector run inside a rolled-back block).
do $chk$
declare fired boolean := false; sev text;
begin
  if (select schedule from cron.job where jobname = 'build-welcome-insights') <> '45 */3 * * *' then
    raise exception 'welcome exact: schedule not applied';
  end if;
  if (select count(*) from public.welcome_template t where t.active and not exists (select 1 from public.welcome_kind_stat s where s.kind = t.kind)) > 0 then
    raise exception 'welcome exact: an active line has no declared statistic';
  end if;
  if public.welcome_shown('villa_area', 337.4) <> 338 or public.welcome_shown('hot_district', 12.4) <> 12 then
    raise exception 'welcome exact: welcome_shown does not round a median up / a count to the nearest';
  end if;

  drop table if exists a_b;
  create temp table a_b (city_id int, dist text, deal_ar text, type_ar text, platform text, price_annual numeric, price_total numeric,
                         price_per_meter numeric, area_m2 numeric, is_m1 boolean, is_m0 boolean);
  insert into a_b (city_id, dist, type_ar, area_m2) values
    (-1, 'X', 'فيلا', 300), (-1, 'X', 'فيلا', 338), (-1, 'X', 'فيلا', 338), (-1, 'X', 'فيلا', 338), (-1, 'X', 'فيلا', 400),
    (-1, 'Y', 'فيلا', 337.2), (-1, 'Y', 'فيلا', 337.6);
  if not public.welcome_claim_holds('villa_area', -1, 'X', null, 338, null) then raise exception 'claim check: a true median claim reads false'; end if;
  -- MUTATIONS: «half ≤ 337» is false for X (1 of 5); nearest rounding of Y's 337.4 → 337 is false (0 of 2): both caught
  if public.welcome_claim_holds('villa_area', -1, 'X', null, 337, null) then raise exception 'claim check: missed a false claim'; end if;
  if public.welcome_claim_holds('villa_area', -1, 'Y', null, round(337.4), null) then raise exception 'claim check: missed nearest-rounding'; end if;
  if not public.welcome_claim_holds('villa_area', -1, 'Y', null, public.welcome_shown('villa_area', 337.4), null) then raise exception 'claim check: ceil should hold'; end if;
  if not public.welcome_claim_holds('hot_district', -1, 'X', null, 1, null) then raise exception 'claim check: a count line has no median claim'; end if;
  drop table a_b;

  -- MUTATION: one disagreement on the newest build raises P1 (rolled back by the sentinel)
  begin
    insert into public.welcome_insight_build(day, built_at) values (date '2099-01-01', now());
    insert into public.welcome_insight_audit(day, checked, failed, by_reason, examples, audited_at)
    values (date '2099-01-01', 1000, 1, '{"number_differs": 1}', '[]', now());
    perform public.mon_detect_welcome_insights_audit();
    select e.severity into sev from public.alert_event e
     where e.dedup_key = 'welcome_insights_audit:disagree' and e.resolved_at is null order by e.id desc limit 1;
    fired := sev = 'P1';
    raise exception 'welcome-proof-sentinel';
  exception when raise_exception then
    if sqlerrm <> 'welcome-proof-sentinel' then raise; end if;
  end;
  if not fired then raise exception 'welcome exact: one checker disagreement (0.1%%) did not raise P1'; end if;
end
$chk$;
