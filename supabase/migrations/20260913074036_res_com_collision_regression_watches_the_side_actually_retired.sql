-- mon_detect_res_com_collision_repair_regression() watched the WRONG THING in two ways, and both
-- were invisible because the only repairs that had ever happened were the ones it did cover.
--
--   1. It joined two hardcoded tables, sadin_residential_listings and dealapp_residential_listings.
--      Any repair on a third platform was unwatched. On 2026-09-13 seven rows were retired across
--      amaall and arkaan; the detector had no arm for either.
--   2. It only ever looked at the RESIDENTIAL side (`t.id = r.res_id`), because the 2026-08-30
--      repair retired residential every time. Six of the seven 2026-09-13 repairs retired the
--      COMMERCIAL side, so even after adding arms the residential-only check would have reported
--      clean over them forever.
--
-- It was also FIRING WRONGLY, which is why alert 1260 stood open from 2026-09-01 to 2026-09-13:
-- the old predicate was "the retired residential row is active", with no test of the sibling. Four
-- sadin ads had flipped back to residential while their commercial rows went inactive — one live
-- card, no duplicate, no defect. The condition that matters is BOTH sides live at once.
--
-- Now it reads ops_res_com_collision_adjudication.retired_side and re-checks exactly the row that
-- was deactivated, on whatever platform and whichever side, via dynamic SQL. A platform repaired
-- tomorrow is covered the moment its adjudication row exists -- nobody has to add an arm.
create or replace function public.mon_detect_res_com_collision_repair_regression()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  r        record;
  v_back   int;
  rows_tot int := 0;
  sample   jsonb := '[]'::jsonb;
  part     jsonb;
begin
  -- One pass per (platform, retired_side) actually present in the adjudication ledger.
  for r in
    select distinct a.platform, a.retired_side,
           a.platform || '_' || case a.retired_side when 'residential' then 'residential'
                                                    else 'commercial' end || '_listings' as retired_tbl,
           a.platform || '_' || case a.retired_side when 'residential' then 'commercial'
                                                    else 'residential' end || '_listings' as sibling_tbl,
           case a.retired_side when 'residential' then 'res_id' else 'com_id' end as retired_col,
           case a.retired_side when 'residential' then 'com_id' else 'res_id' end as sibling_col
      from public.ops_res_com_collision_adjudication a
     where a.verdict = 'REPAIRABLE'
       and a.retired_side in ('residential','commercial')
  loop
    -- Skip a platform whose tables have since been renamed or dropped rather than erroring out:
    -- a detector that throws is a detector that never reports, which is the failure this fixes.
    if to_regclass('public.' || r.retired_tbl) is null
       or to_regclass('public.' || r.sibling_tbl) is null then
      continue;
    end if;

    execute format($q$
      select count(*), coalesce(jsonb_agg(jsonb_build_object(
                 'platform', %1$L, 'retired_side', %2$L, 'ad', ad_number) order by ad_number), '[]'::jsonb)
        from (
          select a.ad_number
            from public.ops_res_com_collision_adjudication a
            join public.%3$I t on t.id = a.%5$I and t.active
            join public.%4$I s on s.id = a.%6$I and s.active
           where a.verdict = 'REPAIRABLE' and a.platform = %1$L and a.retired_side = %2$L
           order by a.ad_number
           limit 20) x
    $q$, r.platform, r.retired_side, r.retired_tbl, r.sibling_tbl, r.retired_col, r.sibling_col)
    into v_back, part;

    if coalesce(v_back, 0) > 0 then
      rows_tot := rows_tot + v_back;
      sample := sample || part;
    end if;
  end loop;

  if rows_tot > 0 then
    n := n + public.mon_raise(
      'P2', 'res_com_collision_repair_regression', null,
      'res_com_collision_repair_regression',
      jsonb_build_object(
        'reactivated_rows', rows_tot,
        'sample', sample,
        'why', 'A row retired by a res/com collision repair is ACTIVE again while its sibling is '
               'still live. The same source ad is eligible in BOTH tables, so the Normal Filter '
               'will render it as two cards on one URL. This is not a new collision: it means the '
               'upstream supersession step (scrapers/common/db.py::retire_superseded_siblings, '
               'called by that platform''s scraper before prune_unseen) did not run or did not '
               'take effect, and the upsert reactivated the orphan. Check that scraper''s last run '
               'log for the "cross-table superseded" count before touching any data.',
        'scope', 'Reads ops_res_com_collision_adjudication.retired_side, so it re-checks whichever '
                 'side was actually deactivated, on every platform with a REPAIRABLE verdict. It '
                 'used to hardcode sadin/dealapp AND assume the residential side.'));
  else
    perform public.mon_resolve_key('res_com_collision_repair_regression',
                                   'res_com_collision_repair_regression');
  end if;
  return n;
end $function$;
