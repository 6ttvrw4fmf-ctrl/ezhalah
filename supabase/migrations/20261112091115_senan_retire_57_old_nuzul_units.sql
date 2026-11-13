-- سنان العقارية left the Nuzul platform: its 57 old units are gone at the source (owner 2026-11-12: «we remove
-- the old ones»; the six «متاح» projects of its new static site show instead — scrapers/senan/run.py).
--
-- Evidence, measured 2026-11-12T09:00Z from the units' own addresses: every one of the 57 answers 404 on its page
-- (www.senanrealestate.sa/properties/<id> → senanrealestate.sa «This Page Does Not Exist») AND on its API record
-- (/api/public/v2/properties/<id>), 114/114. The whole old platform is gone (the catalogue route 404s too).
--
-- Why a migration and not the crawl's prune: the new site shares none of the old ids, so 57 of 57 are missing at
-- once and prune_unseen's collapse guard (> 30 %) correctly refuses. Each row is registered in
-- ops_adjudicated_retraction first, so neither auto_recover_false_inactive() nor a crawl upsert can switch it back.
set local lock_timeout = '3s';

do $mig$
declare
  ids constant bigint[] := array[13107475,13107479,13107481,13107484,13107485,13107486,13107487,13107488,13107489,
    13107490,13107491,13107492,13107493,13107494,13107495,13107496,13107497,13107498,13107499,13107500,13107501,
    13107502,13107503,13107504,13107505,13107506,13107507,13107509,13107520,13107521,13107523,13107525,13107527,
    13107528,13107529,13107530,13107531,13107532,13107533,13107534,13107535,13107536,13107537,13107538,13107539,
    13107540,13107541,13107542,13107543,13107544,13107545,13107546,13107547,13107548,13107549,13107550,13107551];
  n_target int; n_reg int; n_off int;
begin
  select count(*) into n_target from public.senan_residential_listings
   where id = any(ids) and active and ad_number ~ '^SNN[0-9]+$';
  if n_target <> 57 then raise exception 'expected 57 active old senan units, found %', n_target; end if;

  insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
  select 'senan_residential_listings', t.id,
         'senan left the Nuzul platform; the unit is gone at the source (owner 2026-11-12: remove the old ones)',
         jsonb_build_object('measured_at', '2026-11-12T09:00:34Z', 'ad_number', t.ad_number,
                            'listing_url', t.listing_url, 'page_status', 404, 'api_status', 404,
                            'page_body', 'This Page Does Not Exist', 'owner_decision', '2026-11-12')
    from public.senan_residential_listings t
   where t.id = any(ids)
     and not exists (select 1 from public.ops_adjudicated_retraction r
                      where r.source_table = 'senan_residential_listings' and r.listing_id = t.id);
  get diagnostics n_reg = row_count;

  update public.senan_residential_listings
     set active = false, deactivated_at = now(), missing_count = greatest(coalesce(missing_count, 0), 3)
   where id = any(ids) and active;
  get diagnostics n_off = row_count;

  if n_reg <> 57 or n_off <> 57 then raise exception 'registered %, deactivated % (expected 57 / 57)', n_reg, n_off; end if;
  if exists (select 1 from public.senan_residential_listings where active and ad_number ~ '^SNN[0-9]+$') then
    raise exception 'an old senan unit is still active';
  end if;
end
$mig$;
