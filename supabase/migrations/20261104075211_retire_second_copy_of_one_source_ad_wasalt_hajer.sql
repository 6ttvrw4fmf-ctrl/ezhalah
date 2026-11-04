-- ONE SOURCE AD, ONE CARD — retire the second copy of 33 ads that were live in two rows (2026-11-04,
-- card-identity engineer; alerts 6925 url_collision_res_vs_com:wasalt, 1817 card_link_identity:dupe:
-- hajer_residential_listings). Root causes are fixed in the scrapers in the same PR:
--   * wasalt filed every ad by the SEARCH that returned it; its commercial search also answers
--     residential-usage ads, so 32 ads sat in BOTH tables (scrapers/wasalt/run.py upsert_page now
--     follows the ad's own «Property usage» and supersedes the sibling row);
--   * hajer minted a second identity for one WordPress post when a read of the page came back without
--     its field table (scrapers/hajer/run.py map_listing now refuses that page), and its probe stamped
--     the phantom alive from the real ad's page (_signal_for now needs the page to name this ad).
--
-- NOTHING HERE HIDES AN AD. Every retired row's ad stays served through its surviving twin, which must be
-- active AND production_ready in search_listings_ar or the row is not touched. Identity is the source's
-- own id, never similarity:
--   wasalt — the SAME ad_number in both tables; the copy kept is the residential one because the
--            source's own «Property usage» (propertyMainType, captured on the row) is not «Commercial»:
--            both captures agree (30 ads: Residential 17, Residential Commercial 9, Agricultural 4), or the
--            residential capture is the newer one (2 ads, WST5815364 / WST5934691, whose older commercial
--            copy said Commercial and whose newer residential capture says Residential).
--   hajer  — the SAME WordPress post (source_capture.wp_id) and the SAME listing_url as an active row
--            whose own page field «رقم الإعلان» names it; the retired row is the one whose field table was
--            EMPTY (a failed read), so its ad number is the post-id fallback. HJ1512 (post 1512, page says
--            1168 → HJ1168 kept).
-- Deactivation only, reversible; each row is registered in ops_adjudicated_retraction so
-- auto_recover_false_inactive() does not read the decision as an accident. Watched by
-- mon_detect_url_collisions_res_vs_com() (wasalt, re-run at the end) and mon_detect_card_link_identity()
-- (hajer), and by mon_detect_adjudicated_reactivation() if a retired row comes back.

do $repair$
declare
  v_wasalt int;
  v_hajer int;
  v_done int;
begin
  create temp table _retire on commit drop as
  with u as (
    select r.id rid, c.id cid, r.ad_number,
           (select e->>'value' from jsonb_array_elements(case when jsonb_typeof(r.additional_info) = 'array'
                   then r.additional_info else '[]'::jsonb end) e where e->>'key' = 'propertyMainType' limit 1) r_usage,
           (select e->>'value' from jsonb_array_elements(case when jsonb_typeof(c.additional_info) = 'array'
                   then c.additional_info else '[]'::jsonb end) e where e->>'key' = 'propertyMainType' limit 1) c_usage,
           r.last_seen_at r_seen, c.last_seen_at c_seen, r.listing_url r_url, c.listing_url c_url
      from public.wasalt_residential_listings r
      join public.wasalt_commercial_listings c on c.ad_number = r.ad_number
     where r.active and c.active
       and exists (select 1 from public.search_listings_ar s
                    where s.source_table = 'wasalt_residential_listings' and s.listing_id = r.id and s.production_ready))
  select 'wasalt_commercial_listings'::text tbl, cid id, rid keep_id, 'wasalt_residential_listings'::text keep_tbl,
         jsonb_build_object('ad_number', ad_number, 'kept', jsonb_build_object('table', 'wasalt_residential_listings', 'id', rid),
                            'residential_usage', r_usage, 'commercial_usage', c_usage,
                            'residential_last_seen', r_seen, 'commercial_last_seen', c_seen,
                            'residential_url', r_url, 'commercial_url', c_url,
                            'rule', 'same ad_number in both tables; source usage not Commercial (both captures agree, or the newer residential capture says so)') ev
    from u
   where r_usage is not null and r_usage <> 'Commercial'
     and ((c_usage is not null and c_usage <> 'Commercial') or r_seen >= c_seen)
  union all
  select 'hajer_residential_listings', x.id, k.id, 'hajer_residential_listings',
         jsonb_build_object('ad_number', x.ad_number, 'wp_id', x.source_capture->>'wp_id',
                            'kept', jsonb_build_object('table', 'hajer_residential_listings', 'id', k.id, 'ad_number', k.ad_number),
                            'kept_page_field_ad_number', k.source_capture->'rem_fields'->>'رقم الإعلان',
                            'retired_rem_fields', x.source_capture->'rem_fields', 'listing_url', x.listing_url,
                            'rule', 'same WordPress post and URL; retired row was minted from a read with an empty field table (post-id fallback)')
    from public.hajer_residential_listings x
    join public.hajer_residential_listings k
      on k.id <> x.id and k.active
     and k.source_capture->>'wp_id' = x.source_capture->>'wp_id'
     and lower(k.listing_url) = lower(x.listing_url)
     and coalesce(k.source_capture->'rem_fields'->>'رقم الإعلان', '') <> ''
     and k.ad_number = 'HJ' || (k.source_capture->'rem_fields'->>'رقم الإعلان')
   where x.active
     and x.source_capture->'rem_fields' = '{}'::jsonb
     and x.ad_number = 'HJ' || (x.source_capture->>'wp_id')
     and exists (select 1 from public.search_listings_ar s
                  where s.source_table = 'hajer_residential_listings' and s.listing_id = k.id and s.production_ready);

  select count(*) filter (where tbl like 'wasalt%'), count(*) filter (where tbl like 'hajer%') into v_wasalt, v_hajer from _retire;
  if v_wasalt <> 32 or v_hajer <> 1 then
    raise exception 'expected 32 wasalt + 1 hajer duplicate rows, found % + % — re-adjudicate before applying', v_wasalt, v_hajer;
  end if;

  update public.wasalt_commercial_listings t set active = false, deactivated_at = now()
    from _retire r where r.tbl = 'wasalt_commercial_listings' and r.id = t.id and t.active;
  get diagnostics v_done = row_count;
  update public.hajer_residential_listings t set active = false, deactivated_at = now()
    from _retire r where r.tbl = 'hajer_residential_listings' and r.id = t.id and t.active;
  get diagnostics v_wasalt = row_count;
  if v_done + v_wasalt <> 33 then
    raise exception 'deactivated % rows, expected 33', v_done + v_wasalt;
  end if;

  insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
  select tbl, id, 'duplicate_of_same_source_ad', ev from _retire;
end
$repair$;

-- The watcher for the wasalt half, re-measured now: it must close url_collision_res_vs_com:wasalt.
select public.mon_detect_url_collisions_res_vs_com();
