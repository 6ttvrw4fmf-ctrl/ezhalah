-- listing_location_index: add arms for the four searchable platforms that have none.
--
-- THE GAP. amlakalahsa (264 searchable rows), rakez (3,769), suwar (96) and aqaralsaudia (16) are
-- searchable but absent from listing_location_index. ops_incident #230; the live barrier
-- verify-location-index-covers-every-searchable-platform-live.ts has named them for days.
--
-- WHAT IT ACTUALLY COSTS THE USER — stated precisely, because it is NOT "listings are invisible".
-- Their rows remain findable: listing_native_location_v2 resolves location through fallback
-- resolvers. listing_location_index feeds listing_location_canonical, which
-- refresh_city_name_bridge / refresh_district_name_bridge read — and those bridges are what
-- top_cities_by_deal_ar (Trending Cities), district_options_ar (Trending Districts) and
-- location_search_candidates_ar use to resolve a user-supplied place name onto canonical Arabic
-- tokens. A platform missing here never contributes its city/district spellings to those catalogs,
-- so its location vocabulary is invisible to the very thing that canonicalises future listings.
--
-- THE PATTERN is the established one (20260906210336, azdad): splice arms before the ') u) v'
-- wrapper, swap through a __mig twin, restore the CASCADEd dependents. Postgres DDL is
-- transactional, so any failure below leaves production exactly as it was.
--
-- THE DEPENDENTS ARE CAPTURED, NOT RETYPED. listing_location_canonical and its _mv are dropped by
-- the CASCADE and rebuilt from definitions read out of the catalog moments earlier in this same
-- transaction, so the restore cannot drift from what was actually there. Verified beforehand:
-- no reloptions, no comments, the _mv body is byte-identical to the view body, and the only grants
-- on any of the three are on the view (anon/authenticated/postgres/service_role).
do $do$
declare
  base text; arms text := ''; suffix constant text := ') u) v'; body text; r record;
  canon_def text; canon_idx text; before_rows bigint; after_rows bigint; n_new bigint;
begin
  if position('rakez_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) > 0 then
    raise notice 'listing_location_index already carries the four arms - nothing to do';
    return;
  end if;

  -- capture what CASCADE is about to destroy
  canon_def := pg_get_viewdef('public.listing_location_canonical'::regclass, true);
  select string_agg(indexdef, ';') into canon_idx
    from pg_indexes where schemaname='public' and tablename='listing_location_canonical_mv';
  if canon_def is null or canon_idx is null then
    raise exception 'could not capture the dependents - refusing to drop anything';
  end if;

  select count(*) into before_rows from public.listing_location_index;

  base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
  if right(base, length(suffix)) <> suffix then
    raise exception 'listing_location_index shape changed; refusing to splice';
  end if;
  body := left(base, length(base) - length(suffix));

  for r in select * from (values
      ('amlakalahsa_residential_listings','amlakalahsa','residential'),
      ('amlakalahsa_commercial_listings','amlakalahsa','commercial'),
      ('aqaralsaudia_residential_listings','aqaralsaudia','residential'),
      ('aqaralsaudia_commercial_listings','aqaralsaudia','commercial'),
      ('rakez_residential_listings','rakez','residential'),
      ('rakez_commercial_listings','rakez','commercial'),
      ('suwar_residential_listings','suwar','residential'),
      ('suwar_commercial_listings','suwar','commercial')
    ) as x(tbl,slug,cat)
  loop
    if to_regclass('public.'||r.tbl) is null then
      raise exception 'table % does not exist - refusing to guess', r.tbl;
    end if;
    arms := arms || format($f$
UNION ALL
 SELECT ('%1$s'::text || ':'::text) || %1$I.id::text AS index_id, %1$I.id AS listing_id,
    '%2$s'::text AS platform, '%1$s'::text AS source_table, '%3$s'::text AS category,
    lower(%1$I.transaction_type) AS purpose, %1$I.region, %1$I.city,
    %1$I.neighborhood AS district, %1$I.street_name, %1$I.direction AS facade_direction,
    %1$I.last_seen_at AS last_updated, %1$I.scraped_at AS raw_created_at,
    NULL::timestamp with time zone AS raw_updated_at, %1$I.title
   FROM %1$I
  WHERE %1$I.active = true AND (%1$I.transaction_type = ANY (ARRAY['Buy'::text,'Rent'::text]))$f$,
      r.tbl, r.slug, r.cat);
  end loop;

  execute 'DROP MATERIALIZED VIEW IF EXISTS public.listing_location_index__mig CASCADE';
  execute 'CREATE MATERIALIZED VIEW public.listing_location_index__mig AS ' || body || arms || suffix;
  execute 'CREATE UNIQUE INDEX lli__mig_pk ON public.listing_location_index__mig (index_id)';
  execute 'DROP MATERIALIZED VIEW public.listing_location_index CASCADE';
  execute 'ALTER MATERIALIZED VIEW public.listing_location_index__mig RENAME TO listing_location_index';
  execute 'ALTER INDEX public.lli__mig_pk RENAME TO listing_location_index_pk';

  -- restore the dependents from the capture
  execute 'CREATE VIEW public.listing_location_canonical AS ' || canon_def;
  execute 'GRANT ALL ON public.listing_location_canonical TO anon, authenticated, postgres, service_role';
  execute 'CREATE MATERIALIZED VIEW public.listing_location_canonical_mv AS ' || canon_def;
  execute canon_idx;

  -- prove the swap grew the index and the dependents are whole again
  select count(*) into after_rows from public.listing_location_index;
  if after_rows < before_rows then
    raise exception 'listing_location_index SHRANK % -> %', before_rows, after_rows;
  end if;
  select count(*) into n_new from public.listing_location_index
   where source_table in ('amlakalahsa_residential_listings','amlakalahsa_commercial_listings',
                          'aqaralsaudia_residential_listings','aqaralsaudia_commercial_listings',
                          'rakez_residential_listings','rakez_commercial_listings',
                          'suwar_residential_listings','suwar_commercial_listings');
  if n_new = 0 then
    raise exception 'the four platforms contributed no rows - the splice did not take';
  end if;
  if (select count(*) from public.listing_location_canonical_mv) = 0 then
    raise exception 'listing_location_canonical_mv came back empty';
  end if;
  raise notice 'listing_location_index % -> % rows (% from the four new platforms)',
    before_rows, after_rows, n_new;
end
$do$;