-- Senior audit run #3 continuation (2026-08-03): the token-price P1's dominant aqar class is a
-- PER-METER RATE stored as price_total. Live-proven on the 499-row Buy 1–9,999 cohort: 287 rows
-- carry a rate-qualified price expression in the ad head («سعر المتر 4100 ريال», «8000 ريال للمتر»,
-- «السوم ٧٢٠ ريال للمتر»), and the price scanner took the FIRST §/ريال-marked number — the rate —
-- as the ad's total (id 60957: stored 8,000 for a 627m² land whose real total is 5,016,000;
-- id 167616: stored 720). A rate is NOT a total; storing it as one is the same defect class the
-- sadin scraper fix closed in PR#261, here in the DB-side parser.
--
-- Fix: strip rate-qualified price expressions from the head BEFORE the price scan (both shapes:
-- qualifier-before «سعر المتر N ريال» and qualifier-after «N ريال للمتر/المتر»). Rate-only ads then
-- fall through to the word-price fallback («530 الف») or an honest NULL — never a fabricated total.
-- Bare source-displayed placeholders («1 ريال» with no rate qualifier) are deliberately UNTOUCHED:
-- they are source-published values, stored exactly and handled by the owner's interim search gate.
do $mig$
declare src text; out text; needle text;
begin
  src := pg_get_functiondef('public.aqar_parse'::regproc);
  if position('rate-qualified' in src) > 0 then
    raise notice 'already applied — skipping';
    return;
  end if;
  needle := '  head   := split_part(txt, ''تفاصيل الإعلان'', 1);';
  if position(needle in src) = 0 then
    raise exception 'aqar_parse: head-split anchor not found — aborting (function shape changed)';
  end if;
  out := replace(src, needle, needle || '
  -- Per-meter RATES are not totals (2026-08-03): remove rate-qualified price expressions from the
  -- head before scanning, so «سعر المتر 4100 ريال» / «8000 ريال للمتر» can never become price_total.
  head := regexp_replace(head, ''(?:سعر\s*)?المتر[\s:]{0,6}\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)'', '' '', ''g'');
  head := regexp_replace(head, ''\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)\s*(?:لل|ال)?\s*متر'', '' '', ''g'');');
  if out = src then
    raise exception 'aqar_parse: rate-exclusion edit did not apply — aborting';
  end if;
  execute out;
end
$mig$;
