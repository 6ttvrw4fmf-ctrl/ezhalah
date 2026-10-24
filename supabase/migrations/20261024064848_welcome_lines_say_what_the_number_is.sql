-- HOME HEADLINE FACTS: EXACT AND FRESH, part 2 — the words say exactly what the number is (owner 2026-10-24:
-- «make sure we fix ALL of those, it's very important»; seen live: «متوسط السعر المعروض للعمائر في حي العارض بالرياض
-- 14,000,000 ريال» — 99 buildings, MEDIAN 14,000,000, MEAN 17,098,956: right number, wrong word).
--
-- WORDING = MATH, for every active line (registry: public.welcome_kind_stat, part 1):
--   * a MEDIAN reads «نص … {a} … أو أقل» / "half … {a} … or less" — never «متوسط» / "average". «أو أقل» and not
--     «أقل من»: with an odd count or ties at the middle, «half are UNDER {a}» is false (5 buildings at 13M, 14M, 14M,
--     14M, 15M: only one is under 14M), while «half are {a} or less» is true for any data once {a} is rounded up
--     (part 1). The owner's «نص الفلل … مساحتها أقل من {a} م²» kept, made exact by those two words.
--   * a rolling window says so: «خلال آخر 7 أيام» / "in the last 7 days", «خلال آخر 30 يوم» / "in the last 30 days"
--     (never «هذا الأسبوع / هذا الشهر / الشهر الماضي», which read as calendar periods).
--   * counts stay ADS («إعلانات» / "listings", owner 2026-10-22), exact cross-site copies removed, so a count is never
--     more than the Filter shows; «{a} من الإعلانات» keeps the number off a singular noun («14 إعلان» is wrong Arabic).
--   * «the district with the most» is a plurality: «وأكثر حي فيه منها {district}» / "with the most in", never «أكثرها في»
--     / "most of them" (which reads as a majority).
--   * the week-on-week change is measured on the sites read steadily both weeks: «في المواقع اللي نقرأها بانتظام» /
--     "on the sites we read steadily".
--   * «% … جديدة» is a share among listings that state their age: «اللي مذكور عمرها» / "that state their age".
--
-- THE GUARD: a trigger refuses an active template whose words do not match its kind's declared statistic, and
-- mon_detect_welcome_insights_audit (in the hourly roster) raises P1 if one ever gets through (trigger disabled,
-- a kind with no declaration, the builder computing a mean). Apply-time proof below.

-- 1. what a template's words must say for its kind (null = fine)
create or replace function public.welcome_template_problem(p_kind text, p_ar text, p_en text) returns text
language plpgsql stable set search_path to '' as $f$
declare s public.welcome_kind_stat;
begin
  select * into s from public.welcome_kind_stat k where k.kind = p_kind;
  if s.kind is null then return 'kind has no declared statistic in welcome_kind_stat'; end if;
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
$f$;
revoke all on function public.welcome_template_problem(text, text, text) from public, anon, authenticated;

-- 2. the lines (ar + en, each the translation of the other). Upsert by id; a row whose kind differs is left alone
--    (the apply-time proof then fails: every active line must pass the guard).
insert into public.welcome_template(id, kind, personal, ar, en) values
 (3, 'city_new_districts', false, '{g} {n}، تدري إن {city} أُضيفت فيها إعلانات جديدة خلال آخر 7 أيام في {a} من أحيائها؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {city} got new listings in {a} of its districts in the last 7 days? Discover them with Ezhalah.'),
 (6, 'land_ppm_city', false, '{g} {n}، تدري إن نص الأراضي المعروضة للبيع في {city} سعر المتر فيها {a} ريال أو أقل؟ اكتشف أراضيها مع إزهله.',
   '{g} {n}, did you know half of the land for sale in {city} is listed at {a} SAR per m² or less? Discover its land with Ezhalah.'),
 (7, 'land_share', false, '{g} {n}، تدري إن {a}% من إعلانات {city} أراضٍ؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {a}% of the listings in {city} are land? Discover them with Ezhalah.'),
 (8, 'land_gap', false, '{g} {n}، تدري إن نص الأراضي المعروضة للبيع في {district} ب{city} سعر المتر فيها {a} ريال أو أقل، ونص أراضي {district2} {b} ريال أو أقل؟ اكتشف الفرق مع إزهله.',
   '{g} {n}, did you know half of the land for sale in {district}, {city} is listed at {a} SAR per m² or less, and half of the land in {district2} at {b} SAR or less? Discover the difference with Ezhalah.'),
 (10, 'rent_apt', false, '{g} {n}، تدري إن نص الشقق المعروضة للإيجار في {district} ب{city} إيجارها السنوي {a} ريال أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the apartments for rent in {district}, {city} ask {a} SAR a year or less? Discover them with Ezhalah.'),
 (11, 'rent_gap', false, '{g} {n}، تدري إن نص الشقق المعروضة للإيجار في {district} ب{city} إيجارها السنوي {a} ريال أو أقل، ونص شقق {district2} {b} ريال أو أقل؟ اكتشف الفرق مع إزهله.',
   '{g} {n}, did you know half of the apartments for rent in {district}, {city} ask {a} SAR a year or less, and half of those in {district2} ask {b} SAR or less? Discover the difference with Ezhalah.'),
 (15, 'villa_area', false, '{g} {n}، تدري إن نص الفلل المعروضة في {district} ب{city} مساحتها {a} م² أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the villas listed in {district}, {city} are {a} m² or smaller? Discover them with Ezhalah.'),
 (19, 'new_build', false, '{g} {n}، تدري إن {a}% من العقارات المعروضة في {district} ب{city} اللي مذكور عمرها جديدة؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {a}% of the properties listed in {district}, {city} that state their age are brand new? Discover them with Ezhalah.'),
 (20, 'shop_rent', false, '{g} {n}، تدري إن نص المحلات المعروضة للإيجار في {district} ب{city} إيجارها السنوي {a} ريال أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the shops for rent in {district}, {city} ask {a} SAR a year or less? Discover them with Ezhalah.'),
 (22, 'hot_district', false, '{g} {n}، تدري إن {district} ب{city} أُضيف فيه خلال آخر 7 أيام {a} من الإعلانات الجديدة، أي {b}% من إعلاناته؟ اكتشفه مع إزهله.',
   '{g} {n}, did you know {district}, {city} got {a} new listings in the last 7 days, {b}% of all its listings? Discover it with Ezhalah.'),
 (23, 'yesterday', false, '{g} {n}، تدري إن عدد الإعلانات الجديدة في المملكة أمس بلغ {a}، منها {b} في {city}؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {a} new listings were added across the Kingdom yesterday, {b} of them in {city}? Discover them with Ezhalah.'),
 (28, 'hot_district', true, '{g} {n}، تدري إن {district} أُضيف فيه خلال آخر 7 أيام {a} من الإعلانات الجديدة؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {district} got {a} new listings in the last 7 days? Discover them with Ezhalah.'),
 (30, 'new_build', true, '{g} {n}، تدري إن {a}% من العقارات المعروضة في {district} اللي مذكور عمرها جديدة؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {a}% of the properties listed in {district} that state their age are brand new? Discover them with Ezhalah.'),
 (32, 'city_land', false, '{g} {n}، تدري إن عدد إعلانات الأراضي المعروضة في {city} {a}، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {city} has {a} land listings on offer, with the most in {district}? Discover them with Ezhalah.'),
 (33, 'week_land', false, '{g} {n}، تدري إن {city} أُضيف فيها خلال آخر 7 أيام {a} من إعلانات الأراضي الجديدة للبيع، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {city} got {a} new land-for-sale listings in the last 7 days, with the most in {district}? Discover them with Ezhalah.'),
 (38, 'wow_land_up', false, '{g} {n}، تدري إن إعلانات الأراضي الجديدة للبيع في {city} زادت {a}% خلال آخر 7 أيام عن الـ7 أيام اللي قبلها، في المواقع اللي نقرأها بانتظام؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know new land-for-sale listings in {city} rose {a}% in the last 7 days compared with the 7 days before, on the sites we read steadily? Discover them with Ezhalah.'),
 (39, 'wow_land_down', false, '{g} {n}، تدري إن إعلانات الأراضي الجديدة للبيع في {city} قلّت {a}% خلال آخر 7 أيام عن الـ7 أيام اللي قبلها، في المواقع اللي نقرأها بانتظام؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know new land-for-sale listings in {city} fell {a}% in the last 7 days compared with the 7 days before, on the sites we read steadily? Discover them with Ezhalah.'),
 (42, 'week_apt_sale', false, '{g} {n}، تدري إن {city} أُضيف فيها خلال آخر 7 أيام {a} من إعلانات الشقق الجديدة للبيع، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {city} got {a} new apartment-for-sale listings in the last 7 days, with the most in {district}? Discover them with Ezhalah.'),
 (43, 'wow_apt_sale_up', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للبيع في {city} زادت {a}% خلال آخر 7 أيام عن الـ7 أيام اللي قبلها، في المواقع اللي نقرأها بانتظام؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know new apartment-for-sale listings in {city} rose {a}% in the last 7 days compared with the 7 days before, on the sites we read steadily? Discover them with Ezhalah.'),
 (44, 'wow_apt_sale_down', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للبيع في {city} قلّت {a}% خلال آخر 7 أيام عن الـ7 أيام اللي قبلها، في المواقع اللي نقرأها بانتظام؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know new apartment-for-sale listings in {city} fell {a}% in the last 7 days compared with the 7 days before, on the sites we read steadily? Discover them with Ezhalah.'),
 (45, 'apt_sale_ppm', false, '{g} {n}، تدري إن نص الشقق المعروضة للبيع في {district} ب{city} سعر المتر فيها {a} ريال أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the apartments for sale in {district}, {city} are listed at {a} SAR per m² or less? Discover them with Ezhalah.'),
 (46, 'month_apt_ppm', false, '{g} {n}، تدري إن نص الشقق اللي انعرضت للبيع خلال آخر 30 يوم في {district} ب{city} سعر المتر فيها {a} ريال أو أقل، وفي الـ30 يوم اللي قبلها {b} ريال أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the apartments listed for sale in {district}, {city} in the last 30 days ask {a} SAR per m² or less, against {b} SAR or less in the 30 days before? Discover them with Ezhalah.'),
 (47, 'month_land_ppm', false, '{g} {n}، تدري إن نص الأراضي اللي انعرضت للبيع خلال آخر 30 يوم في {city} سعر المتر فيها {a} ريال أو أقل، وفي الـ30 يوم اللي قبلها {b} ريال أو أقل؟ اكتشف أراضيها مع إزهله.',
   '{g} {n}, did you know half of the land listed for sale in {city} in the last 30 days asks {a} SAR per m² or less, against {b} SAR or less in the 30 days before? Discover its land with Ezhalah.'),
 (48, 'week_bld_sale', false, '{g} {n}، تدري إن {city} أُضيف فيها خلال آخر 7 أيام {a} من إعلانات العمائر الجديدة للبيع، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {city} got {a} new building-for-sale listings in the last 7 days, with the most in {district}? Discover them with Ezhalah.'),
 (49, 'city_bld_sale', false, '{g} {n}، تدري إن عدد إعلانات العمائر المعروضة للبيع في {city} {a}، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {city} has {a} building-for-sale listings, with the most in {district}? Discover them with Ezhalah.'),
 (50, 'wow_bld_up', false, '{g} {n}، تدري إن إعلانات العمائر الجديدة للبيع في {city} زادت {a}% خلال آخر 7 أيام عن الـ7 أيام اللي قبلها، في المواقع اللي نقرأها بانتظام؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know new building-for-sale listings in {city} rose {a}% in the last 7 days compared with the 7 days before, on the sites we read steadily? Discover them with Ezhalah.'),
 (51, 'wow_bld_down', false, '{g} {n}، تدري إن إعلانات العمائر الجديدة للبيع في {city} قلّت {a}% خلال آخر 7 أيام عن الـ7 أيام اللي قبلها، في المواقع اللي نقرأها بانتظام؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know new building-for-sale listings in {city} fell {a}% in the last 7 days compared with the 7 days before, on the sites we read steadily? Discover them with Ezhalah.'),
 (52, 'bld_price', false, '{g} {n}، تدري إن نص العمائر المعروضة للبيع في {district} ب{city} سعرها {a} ريال أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the buildings for sale in {district}, {city} are listed at {a} SAR or less? Discover them with Ezhalah.'),
 (53, 'month_bld_ppm', false, '{g} {n}، تدري إن نص العمائر اللي انعرضت للبيع خلال آخر 30 يوم في {city} سعر المتر فيها {a} ريال أو أقل، وفي الـ30 يوم اللي قبلها {b} ريال أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the buildings listed for sale in {city} in the last 30 days ask {a} SAR per m² or less, against {b} SAR or less in the 30 days before? Discover them with Ezhalah.'),
 (54, 'villa_price', false, '{g} {n}، تدري إن نص الفلل المعروضة للبيع في {district} ب{city} سعرها {a} ريال أو أقل؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know half of the villas for sale in {district}, {city} are listed at {a} SAR or less? Discover them with Ezhalah.'),
 (55, 'city_sale', false, '{g} {n}، تدري إن عدد إعلانات العقارات المعروضة للبيع في {city} {a}، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
   '{g} {n}, did you know {city} has {a} property-for-sale listings, with the most in {district}? Discover them with Ezhalah.')
on conflict (id) do update set ar = excluded.ar, en = excluded.en
 where public.welcome_template.kind = excluded.kind and public.welcome_template.personal = excluded.personal;

-- 3. the guard: no active line can be saved with words that do not match its number
create or replace function public.welcome_template_guard() returns trigger
language plpgsql set search_path to '' as $f$
declare why text;
begin
  if new.active then
    why := public.welcome_template_problem(new.kind, new.ar, new.en);
    if why is not null then
      raise exception 'welcome_template % (%): %', new.id, new.kind, why using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$f$;
drop trigger if exists welcome_template_wording_matches_math on public.welcome_template;
create trigger welcome_template_wording_matches_math before insert or update on public.welcome_template
  for each row execute function public.welcome_template_guard();

-- 4. the alarm, in the hourly roster: P1 for any active line whose words do not match, or a builder that averages
do $mig$
declare def text;
  needle_decl constant text := $n$declare n int := 0; live text[] := '{}'; b record; a record;$n$;
  needle_tail constant text := $n$  perform public.mon_resolve_stale_keys('welcome_insights_audit', live);$n$;
  add_tail constant text := $r$  -- WORDING = MATH (2026-10-24): every active line's words say exactly what its number is
  for w in select t.id, t.kind, public.welcome_template_problem(t.kind, t.ar, t.en) why
             from public.welcome_template t where t.active
            union all
           select null, 'builder', 'the builder computes a mean (avg) but no line is declared as a mean'
            where position('avg(' in pg_get_functiondef('public.build_welcome_insights()'::regprocedure)) > 0
              and not exists (select 1 from public.welcome_kind_stat s where s.stat = 'mean') loop
    continue when w.why is null;
    live := live || ('welcome_insights_audit:wording:' || w.kind);
    n := n + public.mon_raise('P1', 'welcome_insights_audit', 'fleet', 'welcome_insights_audit:wording:' || w.kind,
      jsonb_build_object('template', w.id, 'kind', w.kind, 'problem', w.why,
        'why', 'A home headline line says something its number is not (e.g. «متوسط» over a median). The owner: «we can get sued».',
        'action', 'Fix the line in welcome_template through a migration (the trigger welcome_template_wording_matches_math must be on), or the kind''s row in welcome_kind_stat.'));
  end loop;
$r$;
begin
  def := pg_get_functiondef('public.mon_detect_welcome_insights_audit()'::regprocedure);
  if (length(def) - length(replace(def, needle_decl, ''))) / length(needle_decl) <> 1
     or (length(def) - length(replace(def, needle_tail, ''))) / length(needle_tail) <> 1 then
    raise exception 'welcome wording: the audit detector changed under us — refusing';
  end if;
  def := replace(def, needle_decl, needle_decl || ' w record;');
  execute replace(def, needle_tail, add_tail || needle_tail);
end
$mig$;

-- 5. apply-time proof
do $chk$
declare bad int; fired boolean := false; refused boolean := false;
begin
  select count(*) into bad from public.welcome_template t where t.active and public.welcome_template_problem(t.kind, t.ar, t.en) is not null;
  if bad > 0 then raise exception 'welcome wording: % active lines still do not say what their number is', bad; end if;
  if exists (select 1 from public.welcome_template t where t.active and (t.ar ~ 'متوسط' or t.en ~* '\m(average|mean|median)\M')) then
    raise exception 'welcome wording: an active line still says متوسط / average / median';
  end if;
  if (select count(*) from public.welcome_template t join public.welcome_kind_stat s using (kind) where t.active and s.stat = 'median') < 12 then
    raise exception 'welcome wording: fewer than the 12 median lines are active';
  end if;
  -- MUTATION 1: the trigger refuses «متوسط» over a median
  begin
    update public.welcome_template set ar = replace(ar, 'نص العمائر', 'متوسط سعر العمائر') where id = 52;
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'welcome wording: the guard let «متوسط» over a median through'; end if;
  -- MUTATION 2: with the trigger off, the hourly detector raises P1 (rolled back by the sentinel)
  begin
    alter table public.welcome_template disable trigger welcome_template_wording_matches_math;
    update public.welcome_template set en = replace(en, 'half of the buildings', 'the average building') where id = 52;
    perform public.mon_detect_welcome_insights_audit();
    fired := exists (select 1 from public.alert_event e where e.dedup_key = 'welcome_insights_audit:wording:bld_price'
                      and e.severity = 'P1' and e.resolved_at is null);
    raise exception 'welcome-proof-sentinel';
  exception when raise_exception then
    if sqlerrm <> 'welcome-proof-sentinel' then raise; end if;
  end;
  if not fired then raise exception 'welcome wording: the detector did not raise P1 for «average» over a median'; end if;
end
$chk$;
