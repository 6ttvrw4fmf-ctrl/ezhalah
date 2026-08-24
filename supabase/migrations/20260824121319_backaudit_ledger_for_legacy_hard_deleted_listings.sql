-- The back-audit ledger for the 21,371 rows the retired aqar_cleanup path hard-deleted.
--
-- THE PROBLEM IT ANSWERS. The legacy deleter wrote only an aggregate `deleted=N` into
-- scrape_runs.notes, so which listings it removed was never recorded. That is what made a false
-- deletion there unprovable. But "no ledger" is not the same as "no evidence": several ops
-- snapshot tables independently recorded (source_table, listing_id) pairs while those rows were
-- still alive, and a row present in such a snapshot and absent from the live table today is proof
-- that THAT specific listing is gone. This table is that reconstruction, and it is deliberately
-- honest about its two hard limits:
--
--   1. IDENTITY IS PARTIAL. The snapshots cover 10,682 of the 21,371 deletions (50.0%). The rest
--      left no trace anywhere and cannot be enumerated at all.
--   2. A LISTING_ID IS NOT A SOURCE KEY. Only 65 of the recovered rows also carry an ad_number or
--      listing_url, and only those can ever be re-probed at the source. An internal bigint PK is
--      not resolvable to an aqar.fm or wasalt.sa page, and storage.objects is empty, so no raw
--      capture survives to recover one from. The other 10,617 are recorded as
--      'unverifiable_no_source_key' — NOT as live, and NOT as dead.
--
-- Vanished ≠ attributable. These four tables were touched by the legacy path and by nothing else
-- that deletes (the engine's first aqar run was a dry run; its wasalt run aborted on a disabled
-- policy), but an individual row here is evidence of a deletion, not proof of WHICH run made it.
-- 10,617 aqar identities against 10,461 counted aqar deletions is a 156-row excess, consistent
-- with older ops repairs, and it is left visible rather than reconciled away.
--
-- THE RULE THIS TABLE EXISTS TO ENFORCE: a row is restored only on an authoritative source check
-- that says LIVE. Missing evidence is never a reason to restore, and a 403/429/5xx/timeout is
-- inconclusive — it is not permission to delete and not permission to restore either.

create table if not exists public.ops_hard_deleted_listing_backaudit (
  id                bigserial primary key,
  source_table      text        not null,
  listing_id        bigint      not null,
  ad_number         text,
  listing_url       text,
  identity_source   text        not null,
  first_recorded_at timestamptz not null default now(),
  probeable         boolean     not null,
  probed_at         timestamptz,
  http_status       int,
  verdict           text        not null default 'unaudited'
    check (verdict in ('unaudited','live','dead','inconclusive','unverifiable_no_source_key')),
  note              text,
  unique (source_table, listing_id)
);
alter table public.ops_hard_deleted_listing_backaudit enable row level security;

comment on table public.ops_hard_deleted_listing_backaudit is
$c$Back-audit of listings hard-deleted by the retired `aqar_cleanup` path (2026-06-21 .. 2026-08-23,
21,371 rows, zero per-row evidence). Reconstructed from surviving ops snapshots; see this table's
migration header for the two limits (identity is partial; a listing_id is not a source key).

verdict:
  unaudited                  — has a source key, not yet re-probed
  live                       — the source served it as live: a FALSE deletion, restore candidate
  dead                       — 404/410 or a registered dead marker: correctly deleted
  inconclusive               — 403/429/5xx/timeout/network: proves nothing, in EITHER direction
  unverifiable_no_source_key — identity recovered, but no ad_number/listing_url survives anywhere,
                               so source truth for this row is permanently unobtainable

Never write 'dead' because evidence is missing, and never restore a row on anything but 'live'.$c$;

with ids as (
  select src_table as st, id, 'ops_bk_aqar_ppm_20260726'::text as srcname,
         null::text as adn, null::text as url                       from public.ops_bk_aqar_ppm_20260726
  union all select src_table, id, 'ops_bk_aqar_ppm_20260809', null, null from public.ops_bk_aqar_ppm_20260809
  union all select src_table, id, 'aqar_shadow_resolved',     null, null from public.aqar_shadow_resolved
  union all select src_table, id, 'aqar_resolver_log',        null, null from public.aqar_resolver_log
  union all select src_table, id, 'aqar_arabic_src',          null, null from public.aqar_arabic_src
  union all select source_table, listing_id, 'ops_price_watch',    null, null from public.ops_price_watch
  union all select source_table, listing_id, 'district_recovery',  null, null from public.district_recovery
  union all select source_table, listing_id, 'crawl_stats_ledger', null, null from public.crawl_stats_ledger
  union all select source_table, listing_id, 'search_listings_ar', null, null from public.search_listings_ar
  union all select source_table, listing_id, 'ops_city_other_backup_20260716', ad_number, null
              from public.ops_city_other_backup_20260716
  union all select 'wasalt_residential_listings', id,
                   'wasalt_residential_listings_backup_20260716_mapstd', ad_number, listing_url
              from public.wasalt_residential_listings_backup_20260716_mapstd
),
gone as (
  select i.st, i.id,
         max(i.adn) as adn,
         max(i.url) as url,
         string_agg(distinct i.srcname, ',') as srcs
    from ids i
    left join public.aqar_residential_listings   ar on i.st='aqar_residential_listings'   and ar.id = i.id
    left join public.aqar_commercial_listings    ac on i.st='aqar_commercial_listings'    and ac.id = i.id
    left join public.wasalt_residential_listings wr on i.st='wasalt_residential_listings' and wr.id = i.id
    left join public.wasalt_commercial_listings  wc on i.st='wasalt_commercial_listings'  and wc.id = i.id
   where i.st in ('aqar_residential_listings','aqar_commercial_listings',
                  'wasalt_residential_listings','wasalt_commercial_listings')
     and ar.id is null and ac.id is null and wr.id is null and wc.id is null
   group by 1, 2
)
insert into public.ops_hard_deleted_listing_backaudit
  (source_table, listing_id, ad_number, listing_url, identity_source, probeable, verdict, note)
select g.st, g.id, g.adn, g.url, g.srcs,
       coalesce(g.adn, g.url) is not null,
       case when coalesce(g.adn, g.url) is not null then 'unaudited'
            else 'unverifiable_no_source_key' end,
       'reconstructed 2026-08-24 from surviving ops snapshots; deletion window 2026-06-21..2026-08-23'
  from gone g
on conflict (source_table, listing_id) do nothing;