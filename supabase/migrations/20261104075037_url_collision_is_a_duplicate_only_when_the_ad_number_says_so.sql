-- A URL COLLISION IS A DUPLICATE ONLY WHEN THE SOURCE'S OWN AD NUMBER SAYS SO (2026-11-04,
-- card-identity engineer; alerts 4566 url_collision_res_vs_com:nufouth, 5961 :alajlan, 12388
-- card_link_identity:dupe:nufouth_residential_listings).
--
-- THE FALSE ALARMS. mon_detect_url_collisions_res_vs_com() treated "the same listing_url in the
-- residential and the commercial table" as "the same ad twice". It never looked at ad_number:
--   * nufouth publishes ONE share link per PROPERTY (`/latest-offers?ads-N4175=1`) and each unit is its
--     own listing (scrapers/nufouth/run.py docstring §3: the site's JS has no per-unit parameter). N4175
--     carries 8 offices/showrooms (commercial) and 2 apartments (residential) — ten distinct ad numbers
--     NFZN4175A…, every one of which embeds the page's own id N4175. Ten units, zero duplicates.
--   * alajlan has NO per-listing URL at all (owner-approved, scrapers/alajlan/run.py): every row links
--     the homepage. ALJR1..ALJR10 (rent) and ALJI1 (a resort) are eleven different ads.
-- And mon_detect_card_link_identity() calls nufouth_residential (19.4% of rows on a shared URL) a
-- per-listing platform only because it sits under its 20% coarse-share line, while
-- nufouth_commercial (55%) is already on the granularity ledger — the same site, the same URLs.
--
-- WHAT EACH DETECTOR NOW TELLS APART (both directions; nothing is widened, no threshold moved):
--   url_collisions_res_vs_com
--     * a URL whose residential and commercial rows SHARE an ad_number  → P2 duplicate (unchanged
--       meaning; wasalt WST5904998 «فيلا سكنية» stays raised until its sibling is retired);
--     * a URL shared only by DISTINCT ad numbers is not "the same ad twice". It is still raised (P2,
--       same key) unless it is proven to be page granularity: every row on it embeds the page's own id
--       (public.listing_ad_embeds_url_id), or either table is on ops_card_link_granularity — the ledger
--       mon_detect_card_link_identity() keeps for platforms whose page is coarser than a listing;
--     * a platform whose tables carry no ad_number keeps the old URL-only judgement.
--   card_link_identity (per-listing branch)
--     * when no ad number repeats AND every row on every shared URL embeds that URL's own id, the page
--       is PROVEN to be the parent of those units → the granularity note (P3, ledger, self-resolving),
--       exactly what the coarse branch already does above 20%. A shared URL whose rows do not embed it
--       (hajer HJ1168/HJ1512 on one Arabic slug; nowaisiry NW4349/NW4513) still raises P2.

create or replace function public.listing_ad_embeds_url_id(p_url text, p_ad text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  -- TRUE when the row's own ad number contains an id token of the URL (an optional letter + 3 or more
  -- digits, e.g. N4175 in `?ads-N4175=1`), bounded by non-digits so N250 never matches NFZN2501A….
  -- The scraper derived both from one source id, so the URL is that row's page (or its parent's).
  select coalesce(p_url, '') <> '' and coalesce(p_ad, '') <> '' and exists (
    select 1
      from regexp_matches(p_url, '([A-Za-z]?[0-9]{3,})', 'g') m(tok)
     where p_ad ~* ('(^|[^0-9])' || m.tok[1] || '([^0-9]|$)'))
$function$;

comment on function public.listing_ad_embeds_url_id(text, text) is
  'TRUE when the ad_number embeds an id token of the listing_url (letter? + 3+ digits, digit-bounded). '
  'Used by mon_detect_card_link_identity / mon_detect_url_collisions_res_vs_com to prove that rows '
  'sharing one URL are units of that page rather than one ad twice or card-A-to-listing-B (2026-11-04).';

do $guard$
begin
  if not public.listing_ad_embeds_url_id('https://nufouth.com/latest-offers?ads-N4175=1', 'NFZN4175A01725U81b4213d')
     or not public.listing_ad_embeds_url_id('https://nufouth.com/latest-offers?ads-h133=1', 'NFZH133A01288Uae94ca3d')
     or public.listing_ad_embeds_url_id('https://nufouth.com/latest-offers?ads-N250=1', 'NFZN2501A01754Uf30fba0b')
     or public.listing_ad_embeds_url_id('https://alajlan-re.com/', 'ALJR3')
     or public.listing_ad_embeds_url_id('https://hajerhouses.com/property/%d8%af%d8%a8%d9%84%d9%83/', 'HJ1512')
  then
    raise exception 'listing_ad_embeds_url_id truth table failed — refusing to install the detectors';
  end if;
end
$guard$;

create or replace function public.mon_detect_url_collisions_res_vs_com()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  platform_rec record;
  v_res_table text;
  v_com_table text;
  v_res_exists boolean;
  v_com_exists boolean;
  v_has_ad boolean;
  v_on_ledger boolean;
  v_collisions int;
  v_same_ad int;
  v_unproven int;
  v_distinct_only int;
  v_sample jsonb;
  v_row_pairs int;
  v_colliding text[] := '{}';
  v_routed record;
begin
  for platform_rec in
    select distinct platform
      from public.search_listings_ar
     where platform is not null and production_ready
     order by 1
  loop
    v_res_table := platform_rec.platform || '_residential_listings';
    v_com_table := platform_rec.platform || '_commercial_listings';
    select exists(select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = v_res_table)
      into v_res_exists;
    select exists(select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = v_com_table)
      into v_com_exists;

    if not (v_res_exists and v_com_exists) then continue; end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_res_table
                      and column_name='listing_url')
       or not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=v_com_table
                      and column_name='listing_url')
    then continue; end if;

    v_has_ad := exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name=v_res_table and column_name='ad_number')
            and exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name=v_com_table and column_name='ad_number');
    v_on_ledger := exists (select 1 from public.ops_card_link_granularity g
                            where g.source_table in (v_res_table, v_com_table));

    -- res/com rows: (url, ad). Without an ad_number column the row id stands in, so a URL is then
    -- "shared by distinct ads" by construction and judged exactly as before (raised).
    execute format($sql$
      with res as (
        select lower(r.listing_url) u, %s ad
          from public.%I r
          join public.search_listings_ar sl on sl.platform = %L
             and sl.listing_id::text = r.id::text
             and sl.source_table = %L
             and sl.production_ready
         where r.listing_url is not null and btrim(r.listing_url) <> ''
      ), com as (
        select lower(c.listing_url) u, %s ad
          from public.%I c
          join public.search_listings_ar sl on sl.platform = %L
             and sl.listing_id::text = c.id::text
             and sl.source_table = %L
             and sl.production_ready
         where c.listing_url is not null and btrim(c.listing_url) <> ''
      ), inter as (
        select u from res intersect select u from com
      ), judged as (
        select i.u,
               exists (select 1 from res r join com c on c.u = r.u and c.ad = r.ad where r.u = i.u) same_ad,
               exists (select 1 from (select ad from res where u = i.u union all
                                      select ad from com where u = i.u) a
                        where not public.listing_ad_embeds_url_id(i.u, a.ad)) unproven
          from inter i
      )
      select (select count(*) from inter)::int,
             (select count(*) from judged where same_ad)::int,
             (select count(*) from judged where not same_ad and unproven)::int,
             coalesce((select jsonb_agg(u) from (select u from judged
                        where same_ad or unproven order by same_ad desc, u limit 5) x), '[]'::jsonb)
    $sql$,
      case when v_has_ad then 'r.ad_number::text' else '''res:'' || r.id::text' end,
      v_res_table, platform_rec.platform, v_res_table,
      case when v_has_ad then 'c.ad_number::text' else '''com:'' || c.id::text' end,
      v_com_table, platform_rec.platform, v_com_table)
      into v_collisions, v_same_ad, v_unproven, v_sample;

    -- A distinct-ad collision on a platform the ledger already knows is coarser than a listing is
    -- that granularity fact, not a duplicate; without a ledger entry it must be proven per URL.
    v_distinct_only := case when v_on_ledger and v_has_ad then 0 else v_unproven end;
    v_row_pairs := (v_same_ad + v_distinct_only) * 2;

    if v_same_ad + v_distinct_only > 0 then
      v_colliding := v_colliding || platform_rec.platform::text;
      n := n + public.mon_raise(
        'P2', 'url_collision_res_vs_com', platform_rec.platform,
        'url_collision_res_vs_com:' || platform_rec.platform,
        jsonb_build_object(
          'platform', platform_rec.platform,
          'colliding_urls', v_same_ad + v_distinct_only,
          'urls_where_one_ad_number_is_in_both_tables', v_same_ad,
          'urls_shared_by_distinct_ads_not_proven_page_units', v_distinct_only,
          'urls_shared_by_distinct_ads_total', v_collisions - v_same_ad,
          'affected_prod_ready_rows_lower_bound', v_row_pairs,
          'sample_urls', v_sample,
          'why', case when v_same_ad > 0 then
                   'The SAME source ad (same ad_number, same URL) is production_ready in BOTH the '
                   || 'residential and the commercial table, so the Normal Filter shows one property '
                   || 'as two cards. Root cause is upstream ingestion routing one ad to both tables; '
                   || 'the scraper must supersede the sibling (db.retire_superseded_siblings). '
                 else '' end
              || case when v_distinct_only > 0 then
                   'Different ads share one URL across the two tables and nothing proves that URL is '
                   || 'their common page (no ad embeds its id, platform not on ops_card_link_granularity): '
                   || 'one of these cards may open another ad''s page (card A to listing B). '
                 else '' end
              || 'Establish source truth before dropping either side.'
        ));
    else
      perform public.mon_resolve_key('url_collision_res_vs_com',
                                     'url_collision_res_vs_com:' || platform_rec.platform);
    end if;
  end loop;

  -- 2026-11-04: a hand-routed duplicate_card_surface_routed alert is a copy of this condition for the
  -- platforms it names. This sweep just re-measured every platform, so it is the copy's resolver: close
  -- it once none of the platforms it names still collides; hold it while any of them does.
  for v_routed in
    select a.dedup_key, a.detail::text as body
      from public.alert_event a
     where a.kind = 'duplicate_card_surface_routed' and a.resolved_at is null
  loop
    if not exists (select 1 from unnest(v_colliding) p
                    where v_routed.body ~* ('\m' || p || '\M')) then
      perform public.mon_resolve_key('duplicate_card_surface_routed', v_routed.dedup_key);
    end if;
  end loop;

  return n;
end $function$;

-- mon_detect_card_link_identity: patched in place from the live definition, every anchor asserted
-- to occur exactly once, so this cannot silently land on a body that has moved.
do $patch$
declare
  v_def text := pg_get_functiondef('public.mon_detect_card_link_identity()'::regprocedure);
  v_new text;
  a1_old text := $a$coalesce((select jsonb_agg(u) from (select u from d order by u limit 5) x), '[]'::jsonb)
    $sql$, case when v_has_ad$a$;
  a1_new text := $a$coalesce((select jsonb_agg(u) from (select u from d order by u limit 5) x), '[]'::jsonb),
             (select count(*) from d where exists (
                select 1 from base b where b.u = d.u
                   and not public.listing_ad_embeds_url_id(b.u, b.ad)))::int
    $sql$, case when v_has_ad$a$;
  a2_old text := 'into v_rows, v_urls, v_coll_urls, v_coll_rows, v_repeat_ads, v_sample;';
  a2_new text := 'into v_rows, v_urls, v_coll_urls, v_coll_rows, v_repeat_ads, v_sample, v_unproven_urls;';
  a3_old text := '  v_share numeric;';
  a3_new text := E'  v_share numeric;\n  v_unproven_urls int;';
  a4_old text := E'    else\n      -- PER-LISTING granularity (or no ad_number to reason with): a collision is an anomaly.';
  a4_new text := $a$    elsif v_has_ad and coalesce(v_repeat_ads, 0) = 0 and coalesce(v_unproven_urls, 0) = 0 then
      -- PROVEN PAGE UNITS (2026-11-04). No ad number repeats, and every row on every shared URL embeds
      -- that URL's own id (listing_ad_embeds_url_id): the scraper built the row's identity and its link
      -- from ONE source id, so the page is the parent of these units. That is the granularity fact the
      -- coarse branch above records past 20% — proven here per row instead of inferred from a share
      -- (nufouth_residential sat at 19.4% while nufouth_commercial, same site and URLs, sat at 55%).
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:dupe:' || t);
      perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity_unproven:' || t);
      n := n + public.card_link_granularity_note(t, 'card_link_identity:granularity:' || t,
        jsonb_build_object(
          'source_table', t,
          'user_reachable_rows', v_rows,
          'distinct_urls', v_urls,
          'colliding_urls', v_coll_urls,
          'rows_in_collisions', v_coll_rows,
          'collision_share', round(v_share, 4),
          'rows_with_a_repeated_ad_number', v_repeat_ads,
          'rows_not_embedding_their_url_id', 0,
          'sample_urls', v_sample,
          'why', 'Every row sharing a listing_url carries a DISTINCT source ad number that embeds the '
              || 'URL''s own id (e.g. ?ads-N4175=1 -> NFZN4175A...), so the URL is the common page of '
              || 'those units — source granularity, not a duplicate and not card A to listing B. A '
              || 'repeated ad number, or one row that does not embed its URL''s id, re-arms P2.'));
    else
      -- PER-LISTING granularity (or no ad_number to reason with): a collision is an anomaly.$a$;
  k int;
begin
  foreach k in array array[1,2,3,4] loop
    if (length(v_def) - length(replace(v_def,
          case k when 1 then a1_old when 2 then a2_old when 3 then a3_old else a4_old end, '')))
       / length(case k when 1 then a1_old when 2 then a2_old when 3 then a3_old else a4_old end) <> 1 then
      raise exception 'mon_detect_card_link_identity anchor % not found exactly once — live body moved', k;
    end if;
  end loop;
  v_new := replace(replace(replace(replace(v_def, a1_old, a1_new), a2_old, a2_new), a3_old, a3_new), a4_old, a4_new);
  execute v_new;
end
$patch$;
