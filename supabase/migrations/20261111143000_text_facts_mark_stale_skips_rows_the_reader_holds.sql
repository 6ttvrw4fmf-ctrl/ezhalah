-- text_facts_mark_stale(): never wait on a row the hourly facts reader is writing at this very moment.
--
-- 2026-11-11 08:22:02 UTC the hourly search sync (cron job 28) died on «deadlock detected … while updating tuple
-- (10091,3) in relation listing_text_facts»: this function's stale-marking UPDATE walked the aqar rows in one order
-- while the facts reader's PostgREST bulk upsert (INSERT … ON CONFLICT on listing_text_facts) held the same rows in
-- another, each waiting for the other's transaction. The whole sync pass rolled back and customers searched an index
-- one hour older than it should have been (🆕 routed it as repair backlog 1769; 🔧 2026-11-11).
--
-- The fix is the lock order's third option: do not take those locks. The rows the reader holds are the rows it is
-- rewriting with a fresh src_hash right now, so marking them stale is pointless; «for update of f2 skip locked»
-- leaves them out of this pass and the next hourly pass judges them against the hash the reader wrote. Only
-- listing_text_facts rows are locked (never the listing table), the predicate is unchanged, and the pass still
-- records its count in mon_mv_refresh_log. Guard: scripts/verify-text-facts-stale-mark-skips-locked-rows.ts.
create or replace function public.text_facts_mark_stale()
 returns bigint
 language plpgsql
as $function$
declare t text; n bigint := 0; k bigint;
begin
  for t in select distinct f.source_table from public.listing_text_facts f where f.stale_at is null loop
    continue when to_regclass('public.' || t) is null;
    execute format(
      'update public.listing_text_facts f set stale_at = now()
        where f.ctid in (
          select f2.ctid
            from public.listing_text_facts f2
            join public.%I x on x.id = f2.listing_id
           where f2.source_table = %L and f2.stale_at is null
             and (not x.active or %s is distinct from f2.src_hash)
           for update of f2 skip locked)', t, t, public.text_facts_hash_expr(t, 'x'));
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
  values ('text_facts_mark_stale', now(), n, format('rows newly stale this pass (text changed or ad inactive): %s', n))
  on conflict (object_name) do update
    set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;
  return n;
end $function$;
