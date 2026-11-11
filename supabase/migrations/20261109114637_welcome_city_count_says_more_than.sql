-- A CITY COUNT SAYS «أكثر من N», NEVER AN EXACT NUMBER (owner 2026-11-09: «those numbers count needs to be exact» → asked
-- «more than 14,000» or the exact number with a refresh → «More than»). The two lines that stated an exact count
-- (city_land 32, city_sale 55) were built every 3 hours and cached on the phone for the day, so «14,083» was a few ads off
-- by evening (measured: 0.15% on average, 34 ads at most). They now say «أكثر من {a_more}» / "more than {a_more}": the app
-- writes a round number strictly below the count with room to spare (src/lib/insightWelcome.ts moreThan: 14,083 → 14,000).
-- An app that does not know {a_more} yet leaves the slot unfilled and skips the fact, so no phone ever shows
-- «أكثر من 14,083». welcome_insight.a stays the exact count and verify_welcome_insights keeps checking it.
-- Guard: scripts/verify-welcome-count-says-more-than.ts.
update public.welcome_template set ar = '{g} {n}، تدري إن عدد إعلانات الأراضي السكنية المعروضة للبيع في {city} أكثر من {a_more}، وأكثر حي فيها {district}؟', en = '{g} {n}, did you know {city} has more than {a_more} residential land listings for sale, the most in {district}?' where id = 32;
update public.welcome_template set ar = '{g} {n}، تدري إن عدد إعلانات العقارات المعروضة للبيع في {city} أكثر من {a_more}، وأكثر حي فيها {district}؟', en = '{g} {n}, did you know {city} has more than {a_more} property listings for sale, the most in {district}?' where id = 55;
do $$
begin
  if exists (select 1 from public.welcome_template t join public.welcome_kind_stat k on k.kind = t.kind
              where t.active and k.repro_bound = 'exact' and (t.ar ~ '\{a\}' or t.en ~ '\{a\}')) then
    raise exception 'an exact-count line still states the bare count';
  end if;
  if (select count(*) from public.welcome_template where id in (32, 55) and active
        and ar like '%أكثر من {a_more}%' and en like '%more than {a_more}%') <> 2 then
    raise exception 'lines 32 and 55 do not say «أكثر من {a_more}»';
  end if;
end $$;
