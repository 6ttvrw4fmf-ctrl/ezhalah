-- SHORT LINES, ARABIC CORRECTED (2026-10-28, same day as 20261028205944). Two owner wording rules (2026-10-22, «a lot of
-- mistakes in the Arabic wording») that the short lines broke, caught by scripts/verify-insight-welcome.ts before any
-- fact was served with them (the day's facts start at 00:45 Riyadh):
--   1. never a bare count before a singular noun («{a} إعلان», «{a} أرض») — say «ما لا يقل عن {a} من الإعلانات …»;
--   2. a volume line says listings, never properties: «عدد إعلانات … {a}», "… listings".
-- Still short: no «اكتشفها مع إزهله», no filler.

update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام ما لا يقل عن {a} من إعلانات الأراضي الجديدة للبيع، وأكثر حي فيها {district}؟'
 where id = 33;
update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام ما لا يقل عن {a} من إعلانات الشقق الجديدة للبيع، وأكثر حي فيها {district}؟'
 where id = 42;
update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام ما لا يقل عن {a} من إعلانات العمائر الجديدة للبيع، وأكثر حي فيها {district}؟'
 where id = 48;
update public.welcome_template set
  ar = '{g} {n}، تدري إن {district} ب{city} نزل فيه آخر 7 أيام ما لا يقل عن {a} من الإعلانات الجديدة؟'
 where id = 22;
update public.welcome_template set
  ar = '{g} {n}، تدري إن {district} نزل فيه آخر 7 أيام ما لا يقل عن {a} من الإعلانات الجديدة؟'
 where id = 28;
update public.welcome_template set
  ar = '{g} {n}، تدري إنه نزل أمس ما لا يقل عن {a} من الإعلانات الجديدة في المملكة، منها {b} في {city}؟'
 where id = 23;
update public.welcome_template set
  ar = '{g} {n}، تدري إن عدد إعلانات العقارات المعروضة للبيع في {city} {a}، وأكثر حي فيها {district}؟',
  en = '{g} {n}, did you know {city} has {a} property listings for sale, the most in {district}?'
 where id = 55;
update public.welcome_template set
  ar = '{g} {n}، تدري إن عدد إعلانات العمائر المعروضة للبيع في {city} {a}، وأكثر حي فيها {district}؟',
  en = '{g} {n}, did you know {city} has {a} building listings for sale, the most in {district}?'
 where id = 49;
update public.welcome_template set
  ar = '{g} {n}، تدري إن عدد إعلانات الأراضي المعروضة في {city} {a}، وأكثر حي فيها {district}؟'
 where id = 32;

do $chk$
begin
  if exists (select 1 from public.welcome_template where active and ar ~ '\{a\} (إعلان|حي|أرض|موقع|عقار|عمارة)(?![ا-ي])') then
    raise exception 'short lines fix: a bare count before a singular noun remains';
  end if;
  if exists (select 1 from public.welcome_template where active and kind ~ '^(week_|city_land|city_sale|city_bld_sale)' and (ar not like '%إعلانات%' or en !~ 'listings')) then
    raise exception 'short lines fix: a volume line does not say listings';
  end if;
end $chk$;
