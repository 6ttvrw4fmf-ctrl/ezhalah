-- Data-integrity run #22 (2026-08-15): aqar rent-period cohort — source probed, verdict recorded,
-- one source-proven repair, and a permanent barrier against the `rent_period_text` trap.
--
-- WHY. §22 of docs/ops/DATA_INTEGRITY_ENGINEER.md settled on 2026-08-11 that aqar does not state a
-- period for the periodless priced-rent cohort, on the evidence of a --dry-run re-enrich
-- (fetched=64 written=0 no_gain=60/64). Owner permanent rule #2 (2026-08-13) requires that a
-- "the source doesn't publish it" claim be backed by a RECORDED probe, FK-gated and re-checked by a
-- detector — that evidence lived only in a GitHub Actions run and a doc, never in the database.
-- This records it, for the CURRENT cohort, from a live re-fetch.
--
-- WHAT THE PROBE FOUND (63 searchable periodless priced aqar rent rows, all re-fetched live
-- 2026-08-15 HTTP 200, read through the PRODUCTION enricher's own oracle — the listing object from
-- the self.__next_f payload, period = _RENT_PERIOD_ENUM[rent_period] else _period_beside(price,text)
-- — deliberately not a bespoke regex, per §19):
--   61 rows — aqar publishes NO usable per-listing period (no rent_period enum; no period word
--             anchored to this listing's own figure). §22's verdict CONFIRMED by a second,
--             independent method.
--    1 row  — id 69651 / ad 6695179: enum=3 (annual), but the source's published price (38,000) no
--             longer equals the stored price (45,000). Period and price are entangled — exactly the
--             case §22 declined to touch. LEFT ALONE; a period repair here smuggles in a price rewrite.
--    1 row  — id 72068 / ad 6730622: source price 40,000 == stored 40,000 and the page prints
--             «40,000 سنوي» beside that figure. Period-only, no price movement. REPAIRED below.
--
-- THE TRAP THIS PINS (new). aqar's listing payload carries `rent_period_text`, which reads «سنوي» on
-- 59 of the 63 cohort rows — sitting in plain sight next to 61 period-NULL rentals, so it is the
-- first thing a future session will reach for. It is NOT this listing's period. It reads «سنوي» on
-- ads Ezhalah correctly stores as MONTHLY: 6815491 (600/month room), 6817740 (2,700/month), 6798704,
-- 6658434. It only reads «شهري» when the authoritative enum is ALSO 2 (6495955, 6586188). It is a
-- platform DEFAULT wearing the costume of source truth. Importing it would file 61 unknown-period
-- rentals as annual and understate every genuinely-monthly ad 12x — the defect already fought on
-- souq24 and on aqar's own retired `rent_period = "annual"` default. Honest NULL remains correct.

insert into public.ops_rent_period_source_probe
  (source_table, listing_id, probed_at, http_status, observed_subtype, method, evidence)
select 'aqar_residential_listings', v.lid, timestamptz '2026-08-15 07:20:00+00', 200, v.verdict,
       'live_fetch_next_data_listing_obj (production enricher oracle: _RENT_PERIOD_ENUM else _period_beside)',
       format('run #22 live probe 2026-08-15: enum=%s beside=%s rent_period_text=%s src_price=%s stored_price_annual=%s. '
              'rent_period_text is a platform DEFAULT, never this listing''s period — it reads «سنوي» on genuinely '
              'MONTHLY aqar ads (6815491/6817740/6798704/6658434); it must never be imported.',
              coalesce(v.enum_v::text,'(absent)'), coalesce(v.beside,'(none)'),
              case when v.rpt = '' then '(empty)' else v.rpt end,
              coalesce(v.src_price::text,'(absent)'), v.stored)
from (values
(179621,'none',null,null,'سنوي',null,40000),(178996,'none',null,null,'سنوي',null,50000),(179881,'none',null,null,'سنوي',null,40000),(179111,'none',null,null,'سنوي',null,65000),(167532,'none',null,null,'سنوي',null,60000),(177602,'none',null,null,'سنوي',null,40000),(147002,'none',null,null,'سنوي',null,3000),(70017,'none',null,null,'',2600,2600),(14550,'none',null,null,'',36000,36000),(164065,'none',null,null,'سنوي',null,45000),(164752,'none',null,null,'سنوي',null,14400),(165264,'none',null,null,'سنوي',null,40000),(165347,'none',null,null,'سنوي',null,40000),(165350,'none',null,null,'سنوي',null,40000),(165380,'none',null,null,'سنوي',null,43000),(165386,'none',null,null,'سنوي',null,29000),(165422,'none',null,null,'سنوي',null,40000),(165426,'none',null,null,'سنوي',null,13000),(165465,'none',null,null,'سنوي',null,55000),(165469,'none',null,null,'سنوي',null,40000),(165561,'none',null,null,'سنوي',null,33000),(165268,'none',null,null,'سنوي',null,100000),(165311,'none',null,null,'سنوي',null,35000),(165312,'none',null,null,'سنوي',null,24500),(158763,'none',null,null,'سنوي',null,3800),(165744,'none',null,null,'سنوي',null,58000),(165728,'none',null,null,'سنوي',null,60000),(165733,'none',null,null,'سنوي',null,40000),(165731,'none',null,null,'سنوي',null,58000),(165630,'none',null,null,'سنوي',null,35000),(165342,'none',null,null,'سنوي',null,17000),(165549,'none',null,null,'سنوي',null,40000),(161407,'none',null,null,'سنوي',null,40000),(161046,'none',null,null,'سنوي',null,45000),(165625,'none',null,null,'سنوي',null,40000),(165631,'none',null,null,'سنوي',null,37000),(165677,'none',null,null,'سنوي',null,58000),(119740,'none',null,null,'',20000,20000),(72340,'none',null,null,'',20000,20000),(69651,'annual',3,'annual','سنوي',38000,45000),(78209,'none',null,null,'سنوي',null,150000),(78458,'none',null,null,'سنوي',null,160000),(50536,'none',null,null,'سنوي',null,75000),(54155,'none',null,null,'سنوي',null,32000),(50890,'none',null,null,'سنوي',null,90000),(70660,'none',null,null,'سنوي',null,45000),(71617,'none',null,null,'سنوي',null,32000),(71818,'none',null,null,'سنوي',null,38000),(72155,'none',null,null,'سنوي',null,40000),(72254,'none',null,null,'سنوي',null,18600),(72424,'none',null,null,'سنوي',null,25000),(70517,'none',null,null,'سنوي',null,30000),(71319,'none',null,null,'سنوي',null,2800),(71549,'none',null,null,'سنوي',null,60000),(72068,'annual',null,'annual','سنوي',40000,40000),(70662,'none',null,null,'سنوي',null,55000),(71957,'none',null,null,'سنوي',null,35000),(70769,'none',null,null,'سنوي',null,50000),(71278,'none',null,null,'سنوي',null,19200),(70650,'none',null,null,'سنوي',null,4500),(72256,'none',null,null,'سنوي',null,20000),(72454,'none',null,null,'سنوي',null,38400),(179575,'none',null,null,'سنوي',null,23000)
) as v(lid, verdict, enum_v, beside, rpt, src_price, stored)
on conflict (source_table, listing_id, probed_at) do nothing;

-- The platform verdict. aqar was the ONLY platform in the periodless cohort with no row here.
insert into public.ops_rent_period_sourceless (platform, reason, decided_at)
values ('aqar',
  'run #22 live re-probe 2026-08-15 (63/63 fetched, HTTP 200): 61 publish no usable per-listing period '
  '— no rent_period enum and no period word anchored to the listing''s own figure. Confirms the '
  '2026-08-11 §22 verdict by an independent method. The payload''s rent_period_text is a DEFAULT '
  '(reads «سنوي» on genuinely monthly ads 6815491/6817740/6798704/6658434) and must NEVER be imported '
  'as a period. Honest NULL is correct; «سنوي» must not be defaulted in. Per-row evidence: '
  'ops_rent_period_source_probe, probed_at 2026-08-15 07:20:00+00.',
  now())
on conflict (platform) do update set reason = excluded.reason, decided_at = excluded.decided_at;

-- The one source-proven, price-neutral repair.
-- CONTROL (§21): 69651 carries an authoritative annual enum too, but its price moved — it must stay
-- NULL. Asserting that is what keeps this a pinned single-row repair instead of a cohort sweep.
do $$
declare v_before int; v_after int; v_control text;
begin
  select count(*) into v_before from public.aqar_residential_listings
    where id = 72068 and rent_period is null and price_annual = 40000;
  if v_before <> 1 then
    raise exception 'precondition failed: id 72068 is not the probed periodless 40000 row (found %)', v_before;
  end if;

  update public.aqar_residential_listings
     set rent_period = 'annual'
   where id = 72068 and rent_period is null and price_annual = 40000;

  select count(*) into v_after from public.aqar_residential_listings
    where id = 72068 and rent_period = 'annual' and price_annual = 40000;
  if v_after <> 1 then
    raise exception 'repair did not land on id 72068';
  end if;

  select coalesce(rent_period,'NULL') into v_control from public.aqar_residential_listings where id = 69651;
  if v_control <> 'NULL' then
    raise exception 'CONTROL VIOLATED: id 69651 must remain period-NULL (price not contemporaneous), got %', v_control;
  end if;
end $$;