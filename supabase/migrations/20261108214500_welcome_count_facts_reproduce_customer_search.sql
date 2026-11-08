-- 🔧 2026-11-08 (owner followups 3291/3298/3299): every welcome COUNT fact names the ONE Filter search a customer
-- runs to reach its number, and verify_welcome_insights() checks EVERY such kind against that search (it used to
-- check only town_single/town_few/commercial_count/rent_share, so city_land «84» in الخفجي passed while
-- «شراء → الأراضي السكنية» returns 72: the fact counted plain «أرض», rent land and commercial land too).
--   repro_bound = 'exact'           the sentence states the number: shown number := the search's total (repaired), and
--                                   «أكثر حي» := the district the same search ranks first (repaired), else hidden
--   repro_bound = 'at_least'        «ما لا يقل عن a»: the customer's search must hold >= a
--   repro_bound = 'at_least_district' same, inside the fact's district
--   repro_bound = 'at_least_b'      yesterday: the city's search must hold >= b
--   repro_bound = 'district_count'  «في a من أحيائها»: the city must show >= a districts
-- A count kind with no repro_bound is never shown (verify drops it) and its line is refused by
-- welcome_template_problem() (trigger + the P1 wording audit), so a new kind cannot skip the check.
-- Counts read total_count (location_search_candidates_ar caps its ROWS at 5,000; count(*) lied for big cities).

alter table public.welcome_kind_stat add column if not exists repro_bound text
  check (repro_bound in ('exact', 'at_least', 'at_least_district', 'at_least_b', 'district_count'));
alter table public.welcome_kind_stat add column if not exists repro_deal text;
alter table public.welcome_kind_stat add column if not exists repro_types text[];
alter table public.welcome_insight_check add column if not exists checked_by_kind jsonb;
alter table public.welcome_insight_check add column if not exists repaired int;

update public.welcome_kind_stat set repro_bound = 'exact', repro_deal = 'بيع', repro_types = null where kind = 'city_sale';
update public.welcome_kind_stat set repro_bound = 'exact', repro_deal = 'بيع', repro_types = array['أرض سكنية', 'أرض سكني', 'حوش'] where kind = 'city_land';
update public.welcome_kind_stat set repro_bound = 'at_least', repro_deal = 'بيع', repro_types = null where kind in ('week_land', 'week_bld_sale');
update public.welcome_kind_stat set repro_bound = 'at_least', repro_deal = 'بيع', repro_types = array['شقة'] where kind = 'week_apt_sale';
update public.welcome_kind_stat set repro_bound = 'at_least_district' where kind = 'hot_district';
update public.welcome_kind_stat set repro_bound = 'at_least_b' where kind = 'yesterday';
update public.welcome_kind_stat set repro_bound = 'district_count' where kind = 'city_new_districts';
-- city_bld_sale: «عمارة» is split across «عمارة سكنية» and «مباني تجارية» in the Filter — no ONE search reaches it.
update public.welcome_template set active = false where kind = 'city_bld_sale' and active;

-- the land line now says exactly what its search returns
update public.welcome_template
   set ar = '{g} {n}، تدري إن عدد إعلانات الأراضي السكنية المعروضة للبيع في {city} {a}، وأكثر حي فيها {district}؟',
       en = '{g} {n}, did you know {city} has {a} residential land listings for sale, the most in {district}?'
 where kind = 'city_land';

-- builder and independent auditor count the same set as that search
do $m$
declare v text; n text;
begin
  v := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  n := replace(v, $o$'city_land', 'type_ar like ''أرض%''', 20)$o$,
                  $o$'city_land', 'deal_ar = ''بيع'' and type_ar in (''أرض سكنية'', ''أرض سكني'', ''حوش'')', 20)$o$);
  if n = v then raise exception 'build_welcome_insights: city_land predicate not found'; end if;
  execute n;
  v := pg_get_functiondef('public.audit_welcome_insights()'::regprocedure);
  n := replace(v, $o$when 'city_land' then b.type_ar like 'أرض%'$o$,
                  $o$when 'city_land' then b.deal_ar = 'بيع' and b.type_ar in ('أرض سكنية', 'أرض سكني', 'حوش')$o$);
  if n = v then raise exception 'audit_welcome_insights: city_land predicate not found'; end if;
  execute n;
  -- a kind whose facts keep failing their own search raises P1 (repair first, raise only what could not be repaired)
  v := pg_get_functiondef('public.mon_detect_welcome_insights_audit()'::regprocedure);
  n := replace(v, $o$  perform public.mon_resolve_stale_keys('welcome_insights_audit', live);$o$,
$o$  for w in select e.key kind, e.value::int dropped, coalesce((c.checked_by_kind ->> e.key)::int, 0) checked
             from public.welcome_insight_check c, jsonb_each_text(c.by_kind) e
            where c.day = (select max(day) from public.welcome_insight_check) loop
    continue when w.checked = 0 or w.dropped * 2 < w.checked;
    live := live || ('welcome_insights_audit:repro:' || w.kind);
    n := n + public.mon_raise('P1', 'welcome_insights_audit', 'fleet', 'welcome_insights_audit:repro:' || w.kind,
      jsonb_build_object('kind', w.kind, 'checked', w.checked, 'dropped', w.dropped,
        'why', 'Half or more of this kind''s home facts state a number the customer cannot reach with the fact''s own Filter search; they were hidden.',
        'action', 'Compare welcome_kind_stat.repro_* for the kind with the builder; fix the builder or the declared search, never the checker.'));
  end loop;
  perform public.mon_resolve_stale_keys('welcome_insights_audit', live);$o$);
  if n = v then raise exception 'mon_detect_welcome_insights_audit: anchor not found'; end if;
  execute n;
end
$m$;

create or replace function public.welcome_search_total(p_deal text, p_city text, p_districts text[], p_types text[])
 returns bigint
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(max(total_count), 0)
    from public.location_search_candidates_ar(p_deal => p_deal, p_cities => array[p_city], p_districts => p_districts,
                                              p_types => p_types, p_limit => 1);
$function$;

create or replace function public.welcome_template_problem(p_kind text, p_ar text, p_en text)
 returns text
 language plpgsql
 stable
 set search_path to ''
as $function$
declare s public.welcome_kind_stat;
begin
  select * into s from public.welcome_kind_stat k where k.kind = p_kind;
  if s.kind is null then return 'kind has no declared statistic in welcome_kind_stat'; end if;
  if s.stat = 'count' and s.repro_bound is null then
    return 'a count line must name the Filter search a customer runs to reach its number (welcome_kind_stat.repro_bound)'; end if;
  if s.stat <> 'mean' and (p_ar ~ 'متوسط' or p_en ~* '\m(average|mean)\M') then
    return format('says «متوسط/average» but the number is a %s', s.stat); end if;
  if s.stat = 'mean' and not (p_ar ~ 'متوسط' and p_en ~* '\maverage\M') then return 'a mean must say «متوسط» / "average"'; end if;
  if p_en ~* '\mmedian\M' then return 'say what a median means («نص … أو أقل»), not the word'; end if;
  if s.stat = 'median' and not (p_ar ~ 'نص' and p_ar ~ 'أو أقل' and p_en ~* '\mhalf\M' and p_en ~* 'or (less|smaller)') then
    return 'a median must read «نص … أو أقل» / "half … or less"'; end if;
  if s.stat <> 'median' and p_ar ~ 'أو أقل' then return '«أو أقل» belongs to a median line'; end if;
  if p_ar ~ '(هذا الأسبوع|هذا الشهر|الشهر الماضي|الأسبوع الماضي)' or p_en ~* '\m(this|last) (week|month)\M' then
    return 'a calendar word over a rolling window'; end if;
  if s.time_window = '7d' and not (p_ar ~ 'آخر 7 أيام' and p_en ~* 'last 7 days') then return 'a 7-day line must say «آخر 7 أيام» / "last 7 days"'; end if;
  if s.time_window = '30d' and not (p_ar ~ 'آخر 30 يوم' and p_en ~* 'last 30 days') then return 'a 30-day line must say «آخر 30 يوم» / "last 30 days"'; end if;
  if s.time_window = 'yesterday' and not (p_ar ~ 'أمس' and p_en ~* 'yesterday') then return 'a yesterday line must say «أمس» / "yesterday"'; end if;
  if p_ar ~ 'أكثرها' or p_en ~* 'most of them' then return '«أكثرها» / "most of them" reads as a majority'; end if;
  if s.plurality and not (p_ar ~ 'أكثر حي' and p_en ~* 'the most') then return 'name the district with the most: «أكثر حي» / "the most"'; end if;
  if s.steady_sites and not (p_ar ~ 'بانتظام' and p_en ~* 'steadily') then return 'the change is measured on steadily-read sites: say so'; end if;
  if s.known_age_only and not (p_ar ~ 'عمرها' and p_en ~* '\mage\M') then return 'the share is among listings that state their age: say so'; end if;
  return null;
end
$function$;

create or replace function public.verify_welcome_insights()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  d date := (select max(day) from public.welcome_insight);
  r record; k record; c bigint; t bigint; ok boolean; v numeric;
  t1d text; t1n bigint; t2n bigint;
  checked int := 0; dropped int := 0; repaired int := 0; kinds jsonb := '{}'; seen jsonb := '{}'; ex jsonb := '[]';
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
  -- 2. every count a fact states is reproduced with the customer's own Filter search
  for r in select * from public.welcome_insight where day = d loop
    ok := true; c := null;
    select * into k from public.welcome_kind_stat s where s.kind = r.kind;
    if r.district_ar is not null and exists (select 1 from w_pairs p where p.city_ar = r.city_ar and p.district_ar = r.district_ar and not p.found) then ok := false; end if;
    if ok and r.district2_ar is not null and exists (select 1 from w_pairs p where p.city_ar = r.city_ar and p.district_ar = r.district2_ar and not p.found) then ok := false; end if;
    if ok and r.kind in ('town_single', 'town_few') then
      c := public.welcome_search_total(null, r.city_ar, null, null);
      ok := c = r.a;
    elsif ok and r.kind = 'commercial_count' then
      c := public.welcome_search_total('إيجار', r.city_ar, null, array['محل', 'مكتب']);
      ok := c = r.a;
    elsif ok and r.kind = 'rent_share' then
      t := public.welcome_search_total(null, r.city_ar, null, null);
      c := public.welcome_search_total('إيجار', r.city_ar, null, null);
      ok := t > 0 and round(100.0 * c / t) = r.a;
    elsif ok and k.stat = 'count' and k.repro_bound is null then
      ok := false;                                   -- no search a customer can run: never shown
    elsif ok and k.repro_bound = 'exact' then
      c := public.welcome_search_total(k.repro_deal, r.city_ar, null, k.repro_types);
      if c < 3 then ok := false;
      else
        if c <> r.a then update public.welcome_insight set a = c where id = r.id; repaired := repaired + 1; end if;
        if k.plurality then
          select max(z.district_ar) filter (where z.rn = 1), max(z.n) filter (where z.rn = 1), max(z.n) filter (where z.rn = 2)
            into t1d, t1n, t2n
            from (select s.district_ar, count(*) n, row_number() over (order by count(*) desc) rn
                    from public.search_listings_ar s
                   where s.production_ready and s.city_ar = r.city_ar
                     and (k.repro_deal is null or s.deal_ar = k.repro_deal)
                     and (k.repro_types is null or s.type_ar = any(k.repro_types))
                     and nullif(nullif(trim(s.district_ar), ''), 'غير معروف') is not null
                   group by s.district_ar) z;
          if t1d is null or t1n < 3 or t1n <= coalesce(t2n, 0) then ok := false;
          elsif public.welcome_search_total(k.repro_deal, r.city_ar, array[t1d], k.repro_types) <> t1n then ok := false;
          elsif t1d is distinct from r.district_ar then
            update public.welcome_insight set district_ar = t1d where id = r.id; repaired := repaired + 1;
          end if;
        end if;
      end if;
    elsif ok and k.repro_bound in ('at_least', 'at_least_district', 'at_least_b') then
      v := case when k.repro_bound = 'at_least_b' then r.b else r.a end;
      c := public.welcome_search_total(k.repro_deal, r.city_ar,
             case when k.repro_bound = 'at_least_district' then array[r.district_ar] end, k.repro_types);
      ok := v is not null and r.city_ar is not null and c >= v;
    elsif ok and k.repro_bound = 'district_count' then
      select count(distinct s.district_ar) into c from public.search_listings_ar s
       where s.production_ready and s.city_ar = r.city_ar and nullif(nullif(trim(s.district_ar), ''), 'غير معروف') is not null;
      ok := c >= r.a;
    end if;
    checked := checked + 1;
    seen := jsonb_set(seen, array[r.kind], to_jsonb(coalesce((seen ->> r.kind)::int, 0) + 1));
    if not ok then
      dropped := dropped + 1;
      kinds := jsonb_set(kinds, array[r.kind], to_jsonb(coalesce((kinds ->> r.kind)::int, 0) + 1));
      if jsonb_array_length(ex) < 20 then
        ex := ex || jsonb_build_object('kind', r.kind, 'city', r.city_ar, 'district', r.district_ar, 'a', r.a, 'filter', c);
      end if;
      delete from public.welcome_insight where id = r.id;
    end if;
  end loop;
  insert into public.welcome_insight_check(day, checked, dropped, by_kind, examples, checked_at, checked_by_kind, repaired)
  values (d, checked, dropped, kinds, ex, now(), seen, repaired)
  on conflict (day) do update set checked = excluded.checked, dropped = excluded.dropped, by_kind = excluded.by_kind,
    examples = excluded.examples, checked_at = excluded.checked_at, checked_by_kind = excluded.checked_by_kind, repaired = excluded.repaired;
  return jsonb_build_object('day', d, 'checked', checked, 'dropped', dropped, 'repaired', repaired, 'by_kind', kinds);
end
$function$;
