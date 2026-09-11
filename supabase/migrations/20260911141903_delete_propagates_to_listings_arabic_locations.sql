-- ROUTINE #11 ♻️ LISTING LIFECYCLE — a permanent delete must land everywhere, or it did not happen
-- (ops_incident #134, alert kind orphan_after_delete). Full rationale in the mirrored repo file.
--
-- Measured in production 2026-09-11, double-gated (a cleanup_deletion_log row AND the raw row
-- confirmed absent): aqarcity_residential 742, gathern_residential 708, aqarcity_commercial 36
-- = 1,486 orphans, raw row still present: 0. Growing (1,372 five days earlier).
--
-- No user-facing surface is affected today: search_listings_ar, listing_native_location_v2,
-- listing_location_index and active_listing_ids_v2 all measure 0. This is latent inconsistency.
--
-- The fix goes in barrier 14's trigger, not in cleanup.py: the trigger already fires on every
-- delete from every entrypoint on all 67 listings tables, so it cannot be bypassed by a future
-- deleter. The archive INSERT stays FIRST, so the full raw row is preserved before anything
-- derived is removed and the delete remains reversible.

create or replace function public.tg_archive_hard_deleted_listing()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  j jsonb := to_jsonb(old);
begin
  -- to_jsonb(old) rather than named columns: the 67 listings tables do not share one column set,
  -- and a ->> on a missing key is null instead of an error, so one trigger body fits all of them
  -- and keeps fitting when a platform adds a column.
  insert into public.purged_listings_archive
    (source_table, listing_id, row_data, missing_count, deactivated_at, deleted_at, deletion_reason)
  values (
    tg_table_name,
    (j->>'id')::bigint,
    j,
    nullif(j->>'missing_count','')::int,
    nullif(j->>'deactivated_at','')::timestamptz,
    now(),
    -- informational only; never a predicate (see this migration's header).
    coalesce(nullif(current_setting('ezhalah.delete_reason', true), ''), 'unattributed')
  );

  -- ops_incident #134. The archive above is written FIRST and holds the complete raw row, so this
  -- removal is of a DERIVED row only and the delete stays reversible. listing_native_location_v1's
  -- legacy arm reads this table; leaving the row behind is what produced 1,486 orphans pointing at
  -- listings that no longer exist. Index ix_listings_arabic_locations_source_listing makes this an
  -- index lookup, not a scan.
  delete from public.listings_arabic_locations
   where source_table = tg_table_name
     and listing_id = (j->>'id')::bigint;

  return old;
end $function$;

comment on function public.tg_archive_hard_deleted_listing() is
  'Barrier 14 + ops_incident #134: archives the complete row on any hard delete from any entrypoint, '
  'then propagates the delete to listings_arabic_locations so listing_native_location_v1 cannot keep '
  'a row pointing at nothing. Archive first, always.';

create table if not exists public.ops_orphan_location_repair (
  id            bigserial primary key,
  repaired_at   timestamptz not null default now(),
  incident      text        not null,
  source_table  text        not null,
  listing_id    bigint      not null,
  row_data      jsonb       not null,
  deleted_at    timestamptz,
  note          text
);

comment on table public.ops_orphan_location_repair is
  'Snapshot of every listings_arabic_locations row removed by an orphan repair (ops_incident #134). '
  'Exists so a repair that removes a derived row is reversible; the raw listing itself lives in '
  'purged_listings_archive.';

do $backfill$
declare
  v_present int;
  v_snapped int;
  v_deleted int;
begin
  create temp table _orphans on commit drop as
  select l.*
    from public.listings_arabic_locations l
    join public.cleanup_deletion_log d
      on d.source_table = l.source_table and d.listing_id = l.listing_id;

  -- GATE: never touch a row whose raw listing still exists. That is the opposite bug and this
  -- repair must refuse rather than guess (mon_detect_orphan_after_delete's own 'action' says so).
  select count(*) into v_present
    from _orphans o
   where (o.source_table = 'aqarcity_residential_listings'
          and exists (select 1 from public.aqarcity_residential_listings x where x.id = o.listing_id))
      or (o.source_table = 'aqarcity_commercial_listings'
          and exists (select 1 from public.aqarcity_commercial_listings  x where x.id = o.listing_id))
      or (o.source_table = 'gathern_residential_listings'
          and exists (select 1 from public.gathern_residential_listings  x where x.id = o.listing_id));

  if v_present > 0 then
    raise exception 'orphan repair: % candidate rows still have a LIVE raw listing — refusing to '
                    'delete any of them', v_present;
  end if;

  insert into public.ops_orphan_location_repair
    (incident, source_table, listing_id, row_data, deleted_at, note)
  select 'ops_incident#134', o.source_table, o.listing_id, to_jsonb(o),
         (select max(d.deleted_at) from public.cleanup_deletion_log d
           where d.source_table = o.source_table and d.listing_id = o.listing_id),
         'listings_arabic_locations row left behind by a permanent delete; raw row confirmed absent'
    from _orphans o;
  get diagnostics v_snapped = row_count;

  delete from public.listings_arabic_locations l
   using _orphans o
   where l.source_table = o.source_table and l.listing_id = o.listing_id;
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_snapped then
    raise exception 'orphan repair: snapshotted % rows but deleted % — refusing to commit a repair '
                    'that is not fully reversible', v_snapped, v_deleted;
  end if;

  raise notice 'orphan repair: % rows snapshotted and removed', v_deleted;
end;
$backfill$;

do $verify$
declare
  v_left int;
begin
  select count(*) into v_left
    from public.listings_arabic_locations l
    join public.cleanup_deletion_log d
      on d.source_table = l.source_table and d.listing_id = l.listing_id;
  if v_left <> 0 then
    raise exception 'orphan repair verification failed: % ledger-confirmed orphans remain', v_left;
  end if;
end;
$verify$;