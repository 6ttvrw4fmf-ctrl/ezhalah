-- Two source spellings that name a district our catalog already holds (🆕 New Listings Engineer,
-- 2026-10-03; both confirmed by the owner's instruction «check our district and confirm»):
--   بريدة   «السلمانية»            -> catalog «السليمانية»   (one-letter spelling variant)
--   الهفوف  «ضاحية هجر الحي الخامس» -> catalog «الضاحية الخامس» (Dahiyat-Hajar numbered district)
-- Both are city-scoped: the same words in another city are NOT redirected. Everything else in
-- resolve_district_ar is untouched; the two entries sit in a VALUES list so adding a confirmed
-- spelling later is one line. Needle edit of the LIVE body, only the first (Arabic-branch) lookup.
-- The saved definition before this edit is recorded in the PR body; UNDO = delete the alias term.
-- Existing rows recover on their own: refresh_district_recovery() resolves each unmatched source
-- district through this function (listing_source_district_ar), nothing is hand-run.
set local statement_timeout = '2min';
set local lock_timeout = '5s';
DO $do$
DECLARE src text; out_def text;
BEGIN
  src := pg_get_functiondef('public.resolve_district_ar(integer,text)'::regprocedure);
  IF position('city-scoped spelling aliases' in src) > 0 THEN
    RAISE NOTICE 'resolve_district_ar already carries the aliases';
    RETURN;
  END IF;
  out_def := regexp_replace(src,
    'where city_id = p_city_id and district_norm = k;',
    E'where city_id = p_city_id\n       -- city-scoped spelling aliases (owner-confirmed same place; see migration 2026-10-03)\n       and district_norm = coalesce((select a.to_norm from (values\n             (11, ''سلمانيه'', ''سليمانيه''),\n             (12, ''ضاحيه هجر الحي الخامس'', ''ضاحيه الخامس'')\n           ) a(city_id, from_norm, to_norm)\n           where a.city_id = p_city_id and a.from_norm = k), k);',
    '');
  IF out_def = src THEN
    RAISE EXCEPTION 'needle not found in resolve_district_ar - refusing to guess';
  END IF;
  EXECUTE out_def;
END
$do$;

DO $verify$
BEGIN
  IF public.resolve_district_ar(11, 'السلمانية') is distinct from 'السليمانية' THEN
    RAISE EXCEPTION 'Buraydah alias did not land';
  END IF;
  IF public.resolve_district_ar(12, 'ضاحية هجر الحي الخامس') is distinct from 'الضاحية الخامس' THEN
    RAISE EXCEPTION 'Hofuf alias did not land';
  END IF;
  -- scoped: the same spelling in another city must not be redirected
  IF public.resolve_district_ar(18, 'السلمانية') is not null THEN
    RAISE EXCEPTION 'alias leaked into another city';
  END IF;
  -- untouched behaviour
  IF public.resolve_district_ar(11, 'السليمانية') is distinct from 'السليمانية' THEN
    RAISE EXCEPTION 'plain exact match regressed';
  END IF;
END
$verify$;
