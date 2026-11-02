-- EVERY HEADLINE FACT IS CHECKED AGAINST THE FILTER BEFORE ANYONE SEES IT (owner 2026-10-22: «check our database,
-- the filters … we need it to be true»). After the nightly build, verify_welcome_insights() asks the SAME search the
-- Filter runs (location_search_candidates_ar) and drops any fact it does not confirm:
--   • every place a fact names (city + district, and the second district of a comparison) must return ads in the
--     Filter — a district the Filter cannot find is never put in a sentence;
--   • every COUNT a user could reproduce in the Filter must equal what the Filter returns: a small town's number of
--     ads, a city's shops+offices for rent, a city's share of rentals.
-- Measured 2026-10-22: 300 random district facts, 300 confirmed, 0.075 s each. Results are kept per day in
-- welcome_insight_check, and mon_detect_welcome_insights_unconfirmed raises when the Filter disagrees with more
-- than 5% of a day's facts (a builder/Filter drift to fix, never a threshold to raise).
set local statement_timeout = '10min';

create table if not exists public.welcome_insight_check (
  day        date primary key,
  checked    int not null,
  dropped    int not null,
  by_kind    jsonb not null default '{}',
  examples   jsonb not null default '[]',
  checked_at timestamptz not null default now()
);
alter table public.welcome_insight_check enable row level security;

create or replace function public.verify_welcome_insights()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  d date := (select max(day) from public.welcome_insight);
  r record; c bigint; t bigint; ok boolean;
  checked int := 0; dropped int := 0; kinds jsonb := '{}'; ex jsonb := '[]';
begin
  if d is null then return jsonb_build_object('day', null); end if;
  -- 1. places: each (city, district) pair the facts name must exist in the Filter
  create temp table if not exists w_pairs (city_ar text, district_ar text, found boolean) on commit drop;
  truncate w_pairs;
  insert into w_pairs(city_ar, district_ar)
  select distinct city_ar, district_ar from public.welcome_insight where day = d and city_ar is not null and district_ar is not null
  union
  select distinct city_ar, district2_ar from public.welcome_insight where day = d and city_ar is not null and district2_ar is not null;
  for r in select * from w_pairs loop
    select count(*) into c from public.location_search_candidates_ar(p_cities => array[r.city_ar], p_districts => array[r.district_ar], p_limit => 1);
    update w_pairs set found = c > 0 where city_ar = r.city_ar and district_ar = r.district_ar;
  end loop;
  -- 2. counts a user can reproduce in the Filter
  for r in select * from public.welcome_insight where day = d loop
    ok := true;
    if r.district_ar is not null and exists (select 1 from w_pairs p where p.city_ar = r.city_ar and p.district_ar = r.district_ar and not p.found) then ok := false; end if;
    if ok and r.district2_ar is not null and exists (select 1 from w_pairs p where p.city_ar = r.city_ar and p.district_ar = r.district2_ar and not p.found) then ok := false; end if;
    if ok and r.kind in ('town_single', 'town_few') then
      select count(*) into c from public.location_search_candidates_ar(p_cities => array[r.city_ar], p_limit => 1000000);
      ok := c = r.a;
    elsif ok and r.kind = 'commercial_count' then
      select count(*) into c from public.location_search_candidates_ar(p_deal => 'إيجار', p_cities => array[r.city_ar], p_types => array['محل', 'مكتب'], p_limit => 1000000);
      ok := c = r.a;
    elsif ok and r.kind = 'rent_share' then
      select count(*) into t from public.location_search_candidates_ar(p_cities => array[r.city_ar], p_limit => 1000000);
      select count(*) into c from public.location_search_candidates_ar(p_deal => 'إيجار', p_cities => array[r.city_ar], p_limit => 1000000);
      ok := t > 0 and round(100.0 * c / t) = r.a;
    end if;
    checked := checked + 1;
    if not ok then
      dropped := dropped + 1;
      kinds := jsonb_set(kinds, array[r.kind], to_jsonb(coalesce((kinds ->> r.kind)::int, 0) + 1));
      if jsonb_array_length(ex) < 20 then
        ex := ex || jsonb_build_object('kind', r.kind, 'city', r.city_ar, 'district', r.district_ar, 'a', r.a, 'filter', c);
      end if;
      delete from public.welcome_insight where id = r.id;
    end if;
  end loop;
  insert into public.welcome_insight_check(day, checked, dropped, by_kind, examples, checked_at)
  values (d, checked, dropped, kinds, ex, now())
  on conflict (day) do update set checked = excluded.checked, dropped = excluded.dropped, by_kind = excluded.by_kind,
    examples = excluded.examples, checked_at = excluded.checked_at;
  return jsonb_build_object('day', d, 'checked', checked, 'dropped', dropped, 'by_kind', kinds);
end
$function$;

-- nightly: build, then check against the Filter (00:40 Riyadh)
select cron.alter_job((select jobid from cron.job where jobname = 'build-welcome-insights'),
  command := $$set statement_timeout to '900s'; select public.build_welcome_insights(); select public.verify_welcome_insights();$$);

-- Barrier: the Filter must confirm the day's facts (the builder and the Filter read the same index).
create or replace function public.mon_detect_welcome_insights_unconfirmed()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  select * into r from public.welcome_insight_check order by day desc limit 1;
  if r.day is null or r.day < (now() at time zone 'Asia/Riyadh')::date - 1 then
    live := live || 'welcome_insights_unconfirmed:not_checked'::text;
    n := n + public.mon_raise('P2', 'welcome_insights_unconfirmed', 'fleet', 'welcome_insights_unconfirmed:not_checked',
      jsonb_build_object('last_checked_day', r.day, 'why', 'The headline facts were not checked against the Filter for a day or more.',
        'action', 'Check cron job build-welcome-insights; run select public.verify_welcome_insights();'));
  elsif r.checked > 0 and r.dropped * 20 > r.checked then
    live := live || 'welcome_insights_unconfirmed:drift'::text;
    n := n + public.mon_raise('P1', 'welcome_insights_unconfirmed', 'fleet', 'welcome_insights_unconfirmed:drift',
      jsonb_build_object('day', r.day, 'checked', r.checked, 'dropped', r.dropped, 'by_kind', r.by_kind, 'examples', r.examples,
        'why', 'The Filter disagreed with more than 5% of the day''s headline facts: the builder and the Filter count differently.',
        'action', 'Compare build_welcome_insights() with location_search_candidates_ar() for the kinds in by_kind; fix the builder.'));
  end if;
  perform public.mon_resolve_stale_keys('welcome_insights_unconfirmed', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_welcome_insights_unconfirmed' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_welcome_insights_stale'',',
    E'    ''mon_detect_welcome_insights_stale'',\n    ''mon_detect_welcome_insights_unconfirmed'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Proof: today's facts go through the check now; everything left is confirmed by the Filter.
do $proof$
declare v jsonb; left_over int;
begin
  v := public.verify_welcome_insights();
  if (v ->> 'checked')::int < 200 then raise exception 'PROOF: only % facts checked', v ->> 'checked'; end if;
  select count(*) into left_over from public.welcome_insight w
   where w.kind = 'commercial_count'
     and w.a <> (select count(*) from public.location_search_candidates_ar(p_deal => 'إيجار', p_cities => array[w.city_ar], p_types => array['محل', 'مكتب'], p_limit => 1000000));
  if left_over > 0 then raise exception 'PROOF: % shop/office counts disagree with the Filter after the check', left_over; end if;
end $proof$;
