-- What the user SEES must equal the listing/search truth, in clean canonical Arabic.
-- (Owner permanent rule, 2026-08-22.)
--
-- ROOT CAUSE. sync_search_listings_ar() canonicalises the property TYPE
-- (canon_type_ar(normalize(...))) but copies region_ar / city_ar / district_ar VERBATIM from
-- listing_native_location_v2 and never consults loc_catalog at all. So a row can carry a perfectly
-- resolved city_id while DISPLAYING whatever raw string its source published. src/data/remote.ts
-- states the opposite contract ("The index returns the ARABIC-CANONICAL location for every
-- candidate"); this migration makes the data honour it.
--
-- Measured on production before the fix (production_ready rows):
--   1,439 rows whose visible city text ≠ the city its own city_id names, e.g.
--         «الدمام و سيهات»→الدمام (762) · «الاحساء و الهفوف»→الهفوف (322) · «جيزان»→جازان (88)
--         «أبو عريش - أبو عريش»→ابو عريش (74) · «مدينه الجبيل الصناعيه»→الجبيل (29)
--         «امارة منطقة مكة المكرمة - الطائف»→الطائف (20) · «الجوف»→سكاكا · «منطقة الرياض»→الرياض
--   4,127 rows differing from the canonical label once orthography is counted (مكه→مكة …)
--     904 (city_id, district) groups rendering ONE district two ways — 890 of them purely the
--         «حي » prefix, across 160,788 rows, so one result list shows «حي النرجس» and «النرجس».
--
-- MATCHING IS PROVABLY UNCHANGED. The RPC's city arm is a 3-way OR:
--     normalize_ar(s.city_ar) ∈ tokens  OR  s.city_id ∈ ids  OR  s.match_city_ids && ids
-- The new label is by construction the name of the row's OWN city_id, so arm 2 already matched
-- every search arm 1 could newly match — the eligible set cannot grow. And it cannot shrink:
-- of the 1,439 rows, 1,153 raw labels resolve to NO catalog city (their text arm never matched)
-- and the other 286 resolve to a city already covered by city_id/match_city_ids. Rows that would
-- narrow: 0 (measured). Districts are matched by norm_district_tok(), and every rewrite below is
-- token-preserving by construction, asserted in the barrier migration.
--
-- SOURCE TRUTH IS PRESERVED. Only the search index's DISPLAY columns change. The raw labels stay
-- in listing_native_location_v2 and the per-platform source tables (22 «امارة …» rows still there).
-- Nothing here invents a location: an unresolved city keeps its raw label, and an unresolved
-- location is never guessed.

-- ---------------------------------------------------------------------------------------------
-- 1. District display canon: catalog label when known, else the majority rendering the SOURCES
--    themselves published for that exact (city, normalised district) — never an invented string.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.loc_display_district_canon (
  city_id       integer not null,
  district_norm text    not null,
  display_ar    text    not null,
  from_catalog  boolean not null default false,
  refreshed_at  timestamptz not null default now(),
  primary key (city_id, district_norm)
);

comment on table public.loc_display_district_canon is
  'One canonical user-visible rendering per (city_id, normalised district). Sourced from '
  'loc_catalog_district where it exists, otherwise the most frequent rendering the sources '
  'themselves published for that district (ties prefer the «حي X» form). Never invents a name; '
  'every value is either catalog truth or source-attested. Token-preserving by construction, so '
  'it cannot change which rows a district search matches.';

create or replace function public.refresh_loc_display_district_canon()
returns bigint language plpgsql as $function$
declare v_n bigint;
begin
  with src as (
    select s.city_id, norm_district_tok(s.district_ar) tok, s.district_ar label, count(*) n
      from public.search_listings_ar s
     where s.production_ready and s.district_ar is not null and s.city_id is not null
     group by 1,2,3),
  best as (
    select distinct on (city_id, tok) city_id, tok, label
      from src
     -- most frequent rendering wins; ties prefer the «حي X» form (what the app's own حي
     -- autocomplete offers), then the longer/alphabetical label for full determinism.
     order by city_id, tok, n desc, (label like 'حي %') desc, length(label) desc, label
  ),
  merged as (
    select b.city_id, b.tok,
           coalesce(d.district_ar, b.label) as display_ar,
           (d.district_ar is not null)      as from_catalog
      from best b
      left join public.loc_catalog_district d
        on d.city_id = b.city_id and d.district_norm = b.tok
  )
  insert into public.loc_display_district_canon (city_id, district_norm, display_ar, from_catalog, refreshed_at)
  select city_id, tok, display_ar, from_catalog, now() from merged
  -- Safety invariant: a canon label MUST normalise to the same token it is keyed by, or it would
  -- change which rows a district search matches. Anything else is dropped rather than installed.
  where norm_district_tok(display_ar) = tok
  on conflict (city_id, district_norm) do update
    set display_ar = excluded.display_ar,
        from_catalog = excluded.from_catalog,
        refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- 2. The display resolvers. Pure, STABLE, and deliberately incapable of guessing.
-- ---------------------------------------------------------------------------------------------
create or replace function public.loc_display_city_ar(p_city_id integer, p_raw text)
returns text language sql stable as $function$
  select case
    -- identity known → always the canonical catalog name
    when p_city_id is not null then
      coalesce((select c.city_ar from public.loc_catalog_city c where c.city_id = p_city_id), p_raw)
    -- identity unknown → NEVER guess. Suppress an administrative label rather than show the user
    -- «امارة منطقة الرياض - الجبيله» as if it were a city; anything else keeps the source's word.
    when p_raw like 'امارة%' or p_raw like 'إمارة%' or p_raw like 'منطقة %' then null
    else p_raw
  end
$function$;

comment on function public.loc_display_city_ar(integer, text) is
  'User-visible city label: the canonical loc_catalog_city name whenever city_id resolves, the '
  'source label otherwise, and NULL (unknown) rather than an administrative region label when the '
  'city is genuinely unresolved. Never guesses a city.';

create or replace function public.loc_display_district_ar(p_city_id integer, p_raw text)
returns text language sql stable as $function$
  select case when p_raw is null then null else
    coalesce((select k.display_ar from public.loc_display_district_canon k
               where k.city_id = p_city_id and k.district_norm = norm_district_tok(p_raw)), p_raw)
  end
$function$;

comment on function public.loc_display_district_ar(integer, text) is
  'User-visible district label: one canonical rendering per (city, normalised district), so a '
  'single result list cannot show «حي النرجس» and «النرجس» as if they were different places. '
  'Token-preserving, so district matching is unaffected.';

select public.refresh_loc_display_district_canon();

-- ---------------------------------------------------------------------------------------------
-- 3. Fix the SOURCE of the defect: the hourly sync now writes canonical display labels, so new and
--    updated rows are correct forever. Guarded splice (the pattern used for the detector roster) —
--    never re-paste this function from a stale base.
-- ---------------------------------------------------------------------------------------------
do $do$
declare
  src text;
  anchor text := 'v.region_ar, v.city_ar, v.district_ar,';
  needle text := 'v.region_ar, public.loc_display_city_ar(v.city_id, v.city_ar), '
              || 'public.loc_display_district_ar(v.city_id, v.district_ar),';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'sync_search_listings_ar';

  if src is null then
    raise exception 'sync_search_listings_ar not found - refusing to patch blindly';
  end if;

  if position('loc_display_city_ar' in src) > 0 then
    raise notice 'already patched - no-op';
    return;
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'select-list anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  src := replace(src, anchor, needle);

  -- the patched body must call BOTH resolvers exactly once and must still write every column
  if (length(src) - length(replace(src, 'loc_display_city_ar', '')))/length('loc_display_city_ar') <> 1
     or (length(src) - length(replace(src, 'loc_display_district_ar', '')))/length('loc_display_district_ar') <> 1
     or position('on conflict (source_table, listing_id) do update set' in src) = 0
     or position('canon_type_ar' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;

-- ---------------------------------------------------------------------------------------------
-- 4. Backfill helper. Batched (AGENTS.md caps a write batch at 25k) and idempotent: it only
--    touches rows whose stored label differs from what the resolvers produce.
-- ---------------------------------------------------------------------------------------------
create or replace function public.backfill_location_display_labels(p_limit integer default 20000)
returns table(changed bigint, remaining bigint) language plpgsql as $function$
declare v_changed bigint;
begin
  with cand as (
    select s.source_table, s.listing_id,
           public.loc_display_city_ar(s.city_id, s.city_ar)         as new_city,
           public.loc_display_district_ar(s.city_id, s.district_ar) as new_district
      from public.search_listings_ar s
     where s.city_ar is distinct from public.loc_display_city_ar(s.city_id, s.city_ar)
        or s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar)
     limit p_limit
  ), upd as (
    update public.search_listings_ar s
       set city_ar = c.new_city, district_ar = c.new_district
      from cand c
     where s.source_table = c.source_table and s.listing_id = c.listing_id
    returning 1
  ) select count(*)::bigint into v_changed from upd;

  return query select v_changed,
    (select count(*)::bigint from public.search_listings_ar s
      where s.city_ar is distinct from public.loc_display_city_ar(s.city_id, s.city_ar)
         or s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar));
end $function$;
