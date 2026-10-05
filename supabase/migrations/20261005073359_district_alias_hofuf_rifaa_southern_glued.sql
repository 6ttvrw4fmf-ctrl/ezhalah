-- Hofuf «الرفعةالجنوبية» (no space) IS the catalog's «حي الرفعة الجنوبية» (🆕 New Listings Engineer,
-- 2026-10-05). aqar.fm files 7 Hofuf ads under its own district path «حي-الرفعةالجنوبية» (e.g. new ad
-- 15413843, https://sa.aqar.fm/بيت-للبيع/الهفوف/حي-الرفعةالجنوبية/...); its sibling «حي الرفعة الشمالية»
-- is spelled with the space and resolves. All 7 sat with no district. A missing space is a spelling of
-- the same place, not a different place, so it joins the city-scoped spelling-alias VALUES list that
-- the 2026-10-03 aliases (Buraydah السلمانية, Hofuf ضاحية هجر الحي الخامس) introduced. City-scoped:
-- the same glued spelling in any other city is NOT redirected.
-- Needle edit of the LIVE body (md5 before: 25e694f9f3400fa5d0c8f76e94c11911); one VALUES row added.
-- UNDO: delete the (12, 'رفعهالجنوبيه', 'رفعه الجنوبيه') row.
-- Existing rows recover on their own through refresh_district_recovery (job 45) then the :22 sync.
set local statement_timeout = '2min';
set local lock_timeout = '5s';
DO $do$
DECLARE src text; out_def text;
BEGIN
  src := pg_get_functiondef('public.resolve_district_ar(integer,text)'::regprocedure);
  IF position('''رفعهالجنوبيه''' in src) > 0 THEN
    RAISE NOTICE 'resolve_district_ar already carries the Hofuf Rifaa alias';
    RETURN;
  END IF;
  out_def := replace(src,
    '(12, ''ضاحيه هجر الحي الخامس'', ''ضاحيه الخامس'')',
    E'(12, ''ضاحيه هجر الحي الخامس'', ''ضاحيه الخامس''),\n             (12, ''رفعهالجنوبيه'', ''رفعه الجنوبيه'')');
  IF out_def = src THEN
    RAISE EXCEPTION 'needle not found in resolve_district_ar - refusing to guess';
  END IF;
  EXECUTE out_def;
END
$do$;

DO $verify$
BEGIN
  IF public.resolve_district_ar(12, 'حي الرفعةالجنوبية') is distinct from 'حي الرفعة الجنوبية' THEN
    RAISE EXCEPTION 'Hofuf Rifaa alias did not land';
  END IF;
  IF public.resolve_district_ar(12, 'حي الرفعة الجنوبية') is distinct from 'حي الرفعة الجنوبية' THEN
    RAISE EXCEPTION 'spaced spelling regressed';
  END IF;
  IF public.resolve_district_ar(12, 'حي الرفعة الشمالية') is null THEN
    RAISE EXCEPTION 'sibling district regressed';
  END IF;
  -- the earlier aliases still hold
  IF public.resolve_district_ar(11, 'السلمانية') is distinct from 'السليمانية' THEN
    RAISE EXCEPTION 'Buraydah alias regressed';
  END IF;
  IF public.resolve_district_ar(12, 'ضاحية هجر الحي الخامس') is distinct from 'الضاحية الخامس' THEN
    RAISE EXCEPTION 'Hofuf dahiyah alias regressed';
  END IF;
  -- city-scoped: no redirect in another city
  IF public.resolve_district_ar(18, 'حي الرفعةالجنوبية') is not null THEN
    RAISE EXCEPTION 'Rifaa alias leaked into another city';
  END IF;
END
$verify$;
