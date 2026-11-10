-- AN «AT LEAST» COUNT IS ROUNDED DOWN WITH ROOM, NEVER THE EXACT NUMBER (owner 2026-11-09: «Idk what do u recommend» →
-- recommended: an ad deleted after the build can take «ما لا يقل عن 120» below 120 by evening). The seven lines that say
-- «ما لا يقل عن» / «على الأقل» / "at least" now carry {a_least} (and line 23's «منها» part {b_least}, now also «ما لا يقل
-- عن»): the app writes atLeast(n), at or below the count with ≥0.5% (or 1) of room, two leading digits (src/lib/
-- insightWelcome.ts: 120 → 110, 4,312 → 4,200, 7 → 6). An app without the slot skips the fact, never a wrong number.
-- welcome_insight.a/b stay exact; verify_welcome_insights keeps checking them. Guard: scripts/verify-welcome-count-says-more-than.ts.
update public.welcome_template set ar = '{g} {n}، تدري إن {city} نزل فيها جديد آخر 7 أيام في {a_least} من أحيائها على الأقل؟', en = '{g} {n}, did you know {city} got new listings in at least {a_least} of its districts in the last 7 days?' where id = 3;
update public.welcome_template set ar = '{g} {n}، تدري إن {district} ب{city} نزل فيه آخر 7 أيام ما لا يقل عن {a_least} من الإعلانات الجديدة؟', en = '{g} {n}, did you know at least {a_least} new listings went up in {district}, {city} in the last 7 days?' where id = 22;
update public.welcome_template set ar = '{g} {n}، تدري إنه نزل أمس ما لا يقل عن {a_least} من الإعلانات الجديدة في المملكة، منها ما لا يقل عن {b_least} في {city}؟', en = '{g} {n}, did you know at least {a_least} new listings went up across the Kingdom yesterday, at least {b_least} of them in {city}?' where id = 23;
update public.welcome_template set ar = '{g} {n}، تدري إن {district} نزل فيه آخر 7 أيام ما لا يقل عن {a_least} من الإعلانات الجديدة؟', en = '{g} {n}, did you know at least {a_least} new listings went up in {district} in the last 7 days?' where id = 28;
update public.welcome_template set ar = '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام ما لا يقل عن {a_least} من إعلانات الأراضي الجديدة للبيع، وأكثر حي فيها {district}؟', en = '{g} {n}, did you know at least {a_least} new land-for-sale listings went up in {city} in the last 7 days, the most in {district}?' where id = 33;
update public.welcome_template set ar = '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام ما لا يقل عن {a_least} من إعلانات الشقق الجديدة للبيع، وأكثر حي فيها {district}؟', en = '{g} {n}, did you know at least {a_least} new apartment-for-sale listings went up in {city} in the last 7 days, the most in {district}?' where id = 42;
update public.welcome_template set ar = '{g} {n}، تدري إن {city} نزل فيها آخر 7 أيام ما لا يقل عن {a_least} من إعلانات العمائر الجديدة للبيع، وأكثر حي فيها {district}؟', en = '{g} {n}, did you know at least {a_least} new building-for-sale listings went up in {city} in the last 7 days, the most in {district}?' where id = 48;
do $$
begin
  if exists (select 1 from public.welcome_template t join public.welcome_kind_stat k on k.kind = t.kind
              where t.active and k.stat = 'count' and (t.ar ~ '\{[ab]\}' or t.en ~ '\{[ab]\}')) then
    raise exception 'a count line still states a bare exact count';
  end if;
  if (select count(*) from public.welcome_template where id in (3, 22, 23, 28, 33, 42, 48) and active
        and ar like '%{a_least}%' and en like '%at least {a_least}%') <> 7 then
    raise exception 'the seven at-least lines do not all carry {a_least}';
  end if;
end $$;
