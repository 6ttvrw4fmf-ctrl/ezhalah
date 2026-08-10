-- Audit 2026-08-10, Issue #2: a source-published Arabic district was being overwritten by a guess
-- derived from the listing's ENGLISH field.
--
-- Proof (production, gathern, before this migration):
--   listing 5148350 — source additional_info->>'district_ar' = 'الدرعية'
--                     raw neighborhood (English)            = 'al dariyah'
--                     district_ar we displayed              = 'حي البرية'   ← not what the source said
--   258 gathern rows displayed a district whose core name differs from the source-published Arabic
--   one (article/حي-prefix/ة-ه spelling variants excluded). Worst cluster: 224 rows in الخبر where
--   the source says 'حي الراكة الشمالية' and we displayed 'حي الخبر الشمالية'; also 13 rows where the
--   source says 'حي الظاهرة' and we displayed 'حي الزهرة'.
--
-- Root cause. refresh_district_recovery() has two arms:
--   1. a generic arm that resolves the ENGLISH `neighborhood` column via bridge_en_district, and
--   2. an arm that resolves the source-published ARABIC district.
-- Arm 2 only writes when resolve_district_ar() returns non-NULL — i.e. when the source's Arabic
-- district is attested in that city's catalog. 'الدرعية' is a CITY (loc_catalog_city 664/828), not a
-- الرياض district, so arm 2 produced NULL and arm 1's transliteration guess survived. The English
-- token 'dariyah' had reached بريه (البرية) purely by consonant similarity — d vs ب — and that pair
-- is attested in NO migration. It is self-confirming: refresh_district_name_bridge() re-learns EN→AR
-- pairs by reading back search_listings_ar.district_ar, which is the resolver's OWN output, so a
-- wrong mapping keeps re-earning its own "evidence" (n=10 = the 10 rows it created).
--
-- Fix (source-is-truth, platform-agnostic): when a listing publishes an Arabic district, that is the
-- truth. The English/transliteration arm must not supply a value for that listing at all. Then:
--   source Arabic resolves to a catalog district → we show that district
--   source Arabic does not resolve                → district stays NULL (honest unknown)
-- We never substitute a DIFFERENT district inferred from an English string. Unknown stays unknown.
--
-- The source-Arabic field lives in a different place per platform, so it is declared once in a view
-- (listing_source_district_ar) that both arms consume — add a UNION ALL branch there when another
-- platform starts publishing an Arabic district. No platform behaviour is hard-coded in the resolver.
--
-- Regression barrier: view mon_district_contradicts_source (must stay 0 rows) +
-- scripts/verify-district-source-truth-live.ts.

-- ── 1. Where each platform publishes its own Arabic district ──────────────────────────────────
create or replace view public.listing_source_district_ar as
  -- gathern: Arabic district in the additional_info JSON side-channel (the English `neighborhood`
  -- column is a transliteration and is NOT authoritative).
  select 'gathern_residential_listings'::text as source_table,
         g.id                                 as listing_id,
         nullif(btrim(g.additional_info->>'district_ar'), '') as source_district_ar
  from public.gathern_residential_listings g
  where nullif(btrim(g.additional_info->>'district_ar'), '') is not null;

comment on view public.listing_source_district_ar is
  'Audit 2026-08-10. Per-platform registry of the SOURCE-PUBLISHED Arabic district. A listing listed '
  'here must never receive a district inferred from an English/transliterated field — the source wins, '
  'and if the source value is not city-attested the district stays NULL. Add a UNION ALL branch when '
  'another platform starts publishing an Arabic district.';

-- ── 2. Resolver: English arm yields to the source-published Arabic district ───────────────────
create or replace function public.refresh_district_recovery()
returns bigint
language plpgsql
as $function$
declare
  r record;
  n bigint := 0;
  m bigint;
begin
  truncate public.district_recovery;

  -- Arm 1 — generic ENGLISH `neighborhood` recovery, for listings whose source publishes NO Arabic
  -- district. Skipping the rest is the whole fix: a transliteration may fill a gap, never overrule
  -- what the source actually said.
  for r in
    select c.table_name as t
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    execute format($f$
      insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at)
      select %L, v1.listing_id, d.val, now()
      from public.listing_native_location_v1 v1
      join (select distinct on (id) id, neighborhood from public.%I order by id, neighborhood) x
        on x.id = v1.listing_id
      cross join lateral (select public.resolve_district_ar(v1.city_id, x.neighborhood) as val) d
      where v1.source_table = %L
        and v1.city_id is not null
        and (v1.district_ar is null or btrim(v1.district_ar) = '')
        and d.val is not null
        and not exists (
              select 1 from public.listing_source_district_ar sd
              where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)
      on conflict (source_table, listing_id)
        do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at
    $f$, r.t, r.t, r.t);
    get diagnostics m = row_count;
    n := n + m;
  end loop;

  -- Arm 2 — the SOURCE-published Arabic district, for every platform in the registry. Runs through
  -- the same resolver (canonical + city-attested + NULL when the city has no such district).
  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at)
  select v1.source_table, v1.listing_id, d.val, now()
  from public.listing_native_location_v1 v1
  join public.listing_source_district_ar sd
    on sd.source_table = v1.source_table and sd.listing_id = v1.listing_id
  cross join lateral (select public.resolve_district_ar(v1.city_id, sd.source_district_ar) as val) d
  where v1.city_id is not null
    and (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
  on conflict (source_table, listing_id)
    do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at;
  get diagnostics m = row_count;
  n := n + m;

  return n;
end;
$function$;

-- ── 3. Permanent barrier ─────────────────────────────────────────────────────────────────────
-- Any row here = we are displaying a district the source contradicts. Must stay empty.
-- Compares the CORE name only: leading 'حي ' and the 'ال' article are canonicalisation, not a
-- different district (see district-canonicalization rule: DB canonical, card shows source text).
create or replace view public.mon_district_contradicts_source as
  select s.source_table,
         s.listing_id,
         s.platform,
         s.city_ar,
         sd.source_district_ar as source_says,
         s.district_ar         as we_display
  from public.search_listings_ar s
  join public.listing_source_district_ar sd
    on sd.source_table = s.source_table and sd.listing_id = s.listing_id
  where s.district_ar is not null
    and regexp_replace(regexp_replace(public.normalize_ar(s.district_ar), '^حي ', ''), '^ال', '')
     <> regexp_replace(regexp_replace(public.normalize_ar(sd.source_district_ar), '^حي ', ''), '^ال', '');

comment on view public.mon_district_contradicts_source is
  'Audit 2026-08-10 barrier. Listings whose displayed district names a DIFFERENT district than the '
  'source published. Must stay 0 — a non-zero count means a transliteration/bridge guess is once '
  'again overruling source truth.';
