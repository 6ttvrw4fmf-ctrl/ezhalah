-- Data Integrity run #26 (2026-08-17). Duplicate-card defect: url_collision_res_vs_com:dealapp.
--
-- THE DEFECT (user-visible): 5 dealapp ads were each persisted as BOTH a production_ready
-- residential row and a production_ready commercial row at the SAME source URL, so the Normal
-- Filter served the same physical property as two independent cards, with disagreeing type_ar.
--
-- SOURCE TRUTH, established from dealapp itself, not inferred:
--   ad 549199 -> «ارض تجارية للبيع»      (commercial land for sale)
--   ad 540978 -> «محطة بنزين للبيع»      (gas station for sale)
--   ad 499170 -> «محطة بنزين للإيجار»    (gas station for rent)
-- In every case the COMMERCIAL row matches what dealapp publishes. The residential twin carries
-- the commercial type in disguise -- 4 of the 5 literally store property_type = «محطة بنزين»,
-- an untranslated Arabic "gas station", which is commercial by definition.
--
-- WHY THE CODE IS ALREADY CORRECT AND THE ROWS ARE STILL WRONG (§21, the retraction trap):
-- scrapers/dealapp/run.py routes on `category = commercial if property_type in COMMERCIAL_TYPES
-- or is_commercial_usage`. COMMERCIAL_TYPES holds ENGLISH names, and «محطة بنزين» only became
-- mappable when it was added to normalize.TYPE_MAP_AR. Rows captured before that mapping existed
-- fell through with the raw Arabic type, missed COMMERCIAL_TYPES, and were filed residential.
-- Today the same ad correctly routes commercial -- which is exactly why a fresher commercial twin
-- exists beside every stale residential one (com last_seen > res last_seen on 5 of 5). The parser
-- fix cannot retract what it already wrote, so the stale rows survive every future crawl. Removing
-- a fabrication from code REQUIRES a paired retraction of the rows already carrying it.
--
-- THIS IS NOT A LIVENESS ACTION. Nothing here claims any listing is dead. The ad remains served,
-- through its correctly-classified commercial row. Only the misfiled duplicate is withdrawn.

do $retract$
declare
  v_expected int;
  v_control_com int;
  v_retracted int;
begin
  -- Scope: an ACTIVE dealapp residential row that has an ACTIVE commercial twin at the same URL,
  -- where the residential row's own stored type is a commercial type. Deliberately narrow: a
  -- genuine residential/commercial pair with DIFFERENT residential typing is not touched.
  create temp table _retract_ids as
  select r.id
    from dealapp_residential_listings r
    join dealapp_commercial_listings c on c.listing_url = r.listing_url and c.active
   where r.active
     and (r.property_type in ('محطة بنزين', 'Gas Station', 'Commercial Land', 'Commercial Building',
                              'Office', 'Shop', 'Showroom', 'Warehouse', 'Workshop', 'Factory', 'Kiosk')
          or (r.property_type = 'Residential Land' and c.property_type = 'Commercial Land'));

  select count(*) into v_expected from _retract_ids;
  if v_expected <> 5 then
    raise exception 'expected exactly the 5 adjudicated collisions, found % - refusing to retract an unreviewed set', v_expected;
  end if;

  -- CONTROL (§21): the commercial twins must SURVIVE. If this repair ever starts eating the
  -- correctly-classified side, this assertion fails before anything is written.
  select count(*) into v_control_com
    from dealapp_commercial_listings c
   where c.active
     and c.listing_url in (select r.listing_url from dealapp_residential_listings r
                            join _retract_ids t on t.id = r.id);
  if v_control_com <> 5 then
    raise exception 'control failed: expected 5 surviving commercial twins, found %', v_control_com;
  end if;

  update dealapp_residential_listings
     set active = false,
         deactivated_at = now()
   where id in (select id from _retract_ids);
  get diagnostics v_retracted = row_count;

  if v_retracted <> 5 then
    raise exception 'retracted % rows, expected 5', v_retracted;
  end if;

  -- Post-condition: the commercial side is still active and still serving.
  select count(*) into v_control_com
    from dealapp_commercial_listings c
   where c.active
     and c.listing_url in ('https://dealapp.sa/ar/ad-details/549199',
                           'https://dealapp.sa/ar/ad-details/540978',
                           'https://dealapp.sa/ar/ad-details/499170',
                           'https://dealapp.sa/ar/ad-details/364482',
                           'https://dealapp.sa/ar/ad-details/488630');
  if v_control_com <> 5 then
    raise exception 'post-condition failed: only % commercial twins remain active', v_control_com;
  end if;

  drop table _retract_ids;
end
$retract$;
