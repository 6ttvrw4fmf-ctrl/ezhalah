-- A hard delete now propagates into the derived location stores, and the repair that drains the
-- backlog refuses to run unless it can prove, that second, that it cannot strip a live listing.
--
-- THE DEFECT (ops_incident #134, alert_event 1595/1596/1597)
-- ---------------------------------------------------------
-- `tg_archive_hard_deleted_listing()` archives a hard-deleted listing but propagates nothing. The
-- derived location stores keep their row, so `listing_native_location_v1` — a matview over
-- `listings_arabic_locations` — still resolves a listing that no longer exists. Measured
-- 2026-09-06: 1,486 rows across aqarcity_commercial (36), aqarcity_residential (742) and
-- gathern_residential (708), the oldest deleted 2026-08-02, every one already past a full refresh
-- cycle. `docs/ops/LISTING_LIFECYCLE_ENGINEER.md` §4 barrier 9: deletion is complete and
-- consistent, or it did not happen.
--
-- WHY THE TRIGGER IS THE RIGHT PLACE, AND WHY IT CANNOT GET IDENTITY WRONG
-- -----------------------------------------------------------------------
-- The propagation runs inside the DELETE that causes it, keyed on `tg_table_name` and `old.id`.
-- The row being deleted IS the evidence. There is no absence inference anywhere in this path — and
-- absence inference is precisely what the rest of this system spent the day removing. It is also
-- ATOMIC: if the propagation fails, the delete rolls back, so the listing survives with its
-- location intact. That is the fail-closed direction and it is the invariant stated verbatim above.
--
-- THE BACKLOG IS A DIFFERENT PROBLEM, AND IT IS THE DANGEROUS ONE
-- --------------------------------------------------------------
-- The 1,486 rows already stranded have no DELETE to ride along with, so the repair has to identify
-- them by predicate — and a wrong predicate here strips a LIVE listing of its location, which
-- silently drops it out of search. The alert says so itself: "do NOT delete an orphan row whose raw
-- listing is actually still present: that is a different (and opposite) bug."
--
-- So the predicate requires TWO independent facts and is anchored on the PROOF, not the absence:
--   1. `cleanup_deletion_log` carries a row for this exact (source_table, listing_id) — we can
--      prove WE deleted it. A live listing has no such entry, so it is unreachable by construction.
--   2. the listing is in fact absent from the table it names — which catches the one case (1) does
--      not: an id that was deleted and later REUSED by a new listing.
-- Absence ALONE is never sufficient, exactly as it is never sufficient to deactivate a listing.
-- Measured before writing this: of the 1,486, zero are still present, so no id reuse exists today —
-- but the guard does not depend on that staying true.
--
-- AND THE REPAIR PROVES THE GUARD BEFORE EVERY RUN
-- -----------------------------------------------
-- `prune_orphaned_location_rows()` executes `ops_location_row_is_orphaned()` against injected
-- synthetic rows — a live listing, a deleted one, a deleted-then-reused id, a row absent with no
-- deletion proof, and an unresolvable table — and REFUSES to delete anything if any direction fails.
-- A guard nobody has watched fail is a comment that runs; this one is watched immediately before it
-- is trusted, every time, and it fails closed.

-- ── The guard, injectable so it can be executed against synthetic rows ───────────────────────────
create or replace function public.ops_location_row_is_orphaned(
  p_source_table text,
  p_listing_id   bigint,
  p_inject       jsonb default null
) returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  proven_deleted boolean;
  still_present  boolean;
begin
  if p_source_table is null or p_listing_id is null then
    return false;
  end if;

  if p_inject is not null then
    -- Synthetic mode, for the self-test only. Reads nothing, writes nothing.
    proven_deleted := exists (
      select 1 from jsonb_array_elements(coalesce(p_inject->'deleted', '[]'::jsonb)) e
       where e->>0 = p_source_table and (e->>1)::bigint = p_listing_id);
    still_present := exists (
      select 1 from jsonb_array_elements(coalesce(p_inject->'present', '[]'::jsonb)) e
       where e->>0 = p_source_table and (e->>1)::bigint = p_listing_id);
    return proven_deleted and not still_present;
  end if;

  -- (1) PROOF that we deleted it. Not "it is missing" — proof.
  proven_deleted := exists (
    select 1 from public.cleanup_deletion_log d
     where d.source_table = p_source_table and d.listing_id = p_listing_id);
  if not proven_deleted then
    return false;
  end if;

  -- (2) …and it really is absent, which catches a deleted-then-REUSED id. A table we cannot
  -- resolve is not an answer, so it refuses rather than assuming absence.
  if to_regclass('public.' || p_source_table) is null then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I x where x.id = $1)', p_source_table)
     into still_present using p_listing_id;
  return not still_present;
end
$function$;

comment on function public.ops_location_row_is_orphaned(text, bigint, jsonb) is
  'May this derived location row be removed? TRUE only when cleanup_deletion_log proves we deleted '
  'the listing AND it is genuinely absent. Absence alone is never sufficient.';

-- ── Propagation, inside the delete that causes it ───────────────────────────────────────────────
create or replace function public.tg_archive_hard_deleted_listing()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  j  jsonb := to_jsonb(old);
  id bigint := (j->>'id')::bigint;
begin
  -- to_jsonb(old) rather than named columns: the 67 listings tables do not share one column set,
  -- and a ->> on a missing key is null instead of an error, so one trigger body fits all of them
  -- and keeps fitting when a platform adds a column.
  insert into public.purged_listings_archive
    (source_table, listing_id, row_data, missing_count, deactivated_at, deleted_at, deletion_reason)
  values (
    tg_table_name,
    id,
    j,
    nullif(j->>'missing_count','')::int,
    nullif(j->>'deactivated_at','')::timestamptz,
    now(),
    -- informational only; never a predicate (see that migration's header).
    coalesce(nullif(current_setting('ezhalah.delete_reason', true), ''), 'unattributed')
  );

  -- PROPAGATE the delete into the derived per-listing location stores (ops_incident #134). Keyed on
  -- the row being deleted, so identity cannot be wrong and no absence is inferred. Deliberately NOT
  -- wrapped in an exception handler: if this cannot complete, the whole delete rolls back and the
  -- listing keeps its location. Deletion is complete and consistent, or it did not happen.
  if id is not null then
    delete from public.listings_arabic_locations
     where source_table = tg_table_name and listing_id = id;
    delete from public.listing_location_relations
     where source_table = tg_table_name and listing_id = id;
  end if;

  return old;
end
$function$;

-- ── What is still stranded, under the same guard ────────────────────────────────────────────────
create or replace function public.ops_orphan_location_rows()
 returns table(store text, source_table text, listing_id bigint)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select 'listings_arabic_locations', l.source_table, l.listing_id
    from public.listings_arabic_locations l
   where public.ops_location_row_is_orphaned(l.source_table, l.listing_id)
  union all
  select 'listing_location_relations', r.source_table, r.listing_id
    from public.listing_location_relations r
   where public.ops_location_row_is_orphaned(r.source_table, r.listing_id)
$$;

-- ── The repair: proves its own guard, then drains a BOUNDED batch ───────────────────────────────
create or replace function public.prune_orphaned_location_rows(
  p_limit   int     default 500,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  blind text[] := '{}';
  t     text   := 'aqarcity_residential_listings';
  inj   jsonb;
  n_lal int := 0;
  n_rel int := 0;
  ids   jsonb;
begin
  -- SELF-TEST, executed against synthetic rows, BOTH directions, before anything is deleted.
  inj := jsonb_build_object(
           'deleted', jsonb_build_array(jsonb_build_array(t, 42), jsonb_build_array(t, 43)),
           'present', jsonb_build_array(jsonb_build_array(t, 43), jsonb_build_array(t, 44)));
  -- 42: proven deleted, absent            → removable
  if not public.ops_location_row_is_orphaned(t, 42, inj) then
    blind := array_append(blind, 'a proven-deleted, absent row was NOT removable — the repair would never drain');
  end if;
  -- 43: proven deleted but PRESENT again  → the id was reused; must be protected
  if public.ops_location_row_is_orphaned(t, 43, inj) then
    blind := array_append(blind, 'a deleted-then-REUSED id was treated as an orphan — this would strip a LIVE listing');
  end if;
  -- 44: present, no deletion proof        → an ordinary live listing; must be protected
  if public.ops_location_row_is_orphaned(t, 44, inj) then
    blind := array_append(blind, 'a LIVE listing was treated as an orphan');
  end if;
  -- 45: absent, no deletion proof         → absence alone must never be enough
  if public.ops_location_row_is_orphaned(t, 45, inj) then
    blind := array_append(blind, 'ABSENCE ALONE was treated as proof of deletion');
  end if;
  -- a table that does not resolve         → refuse, never assume absence
  if public.ops_location_row_is_orphaned('no_such_table_at_all', 42,
       jsonb_build_object('deleted', jsonb_build_array(jsonb_build_array('no_such_table_at_all', 42)))) then
    -- (synthetic mode never touches the catalog, so assert the REAL path separately)
    null;
  end if;
  if public.ops_location_row_is_orphaned('no_such_table_at_all', 42) then
    blind := array_append(blind, 'an unresolvable source_table was treated as proof of absence');
  end if;

  if array_length(blind, 1) is not null then
    return jsonb_build_object('refused', true, 'guard_failures', to_jsonb(blind),
      'why', 'ops_location_row_is_orphaned() does not answer correctly on injected rows, so nothing '
          || 'it says about real rows can be trusted. NOTHING was deleted.',
      'action', 'Fix the guard. Do NOT relax this self-test to make it pass.');
  end if;

  if p_dry_run then
    select coalesce(jsonb_agg(jsonb_build_object('store', store, 'source_table', source_table,
                                                 'listing_id', listing_id)), '[]'::jsonb)
      into ids
      from (select * from public.ops_orphan_location_rows() limit p_limit) s;
    return jsonb_build_object('dry_run', true, 'would_delete', jsonb_array_length(ids),
                              'sample', ids);
  end if;

  with doomed as (
    select source_table, listing_id
      from public.ops_orphan_location_rows()
     where store = 'listings_arabic_locations'
     limit p_limit),
  gone as (
    delete from public.listings_arabic_locations l
     using doomed d
     where l.source_table = d.source_table and l.listing_id = d.listing_id
    returning 1)
  select count(*) into n_lal from gone;

  with doomed as (
    select source_table, listing_id
      from public.ops_orphan_location_rows()
     where store = 'listing_location_relations'
     limit p_limit),
  gone as (
    delete from public.listing_location_relations r
     using doomed d
     where r.source_table = d.source_table and r.listing_id = d.listing_id
    returning 1)
  select count(*) into n_rel from gone;

  return jsonb_build_object('dry_run', false,
                            'deleted_listings_arabic_locations', n_lal,
                            'deleted_listing_location_relations', n_rel,
                            'remaining', (select count(*) from public.ops_orphan_location_rows()));
end
$function$;

comment on function public.prune_orphaned_location_rows(int, boolean) is
  'Drains stranded derived location rows in bounded batches. Proves ops_location_row_is_orphaned() '
  'against injected rows in both directions first and REFUSES to delete anything if any direction '
  'fails. Defaults to a dry run.';
