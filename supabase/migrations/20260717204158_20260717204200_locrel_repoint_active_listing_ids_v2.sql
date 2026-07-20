-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260717204158, name '20260717204200_locrel_repoint_active_listing_ids_v2'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 48ceee0a3f7fa961a8937422c39895de).
-- Wave 1 / P0-2: loc_rel_nibble, loc_rel_refresh_one, loc_rel_upsert_table all read
-- active_listing_ids (v1), which is refreshed by NO cron job (cron 17 refreshes only _v2).
-- v1 = 158,705 stale rows vs v2 = 184,459 fresh -> 37,954 active listings never entered the
-- location-relations pipeline, and 11,465 dead listings retained stale relations.
-- v2 is a strict superset of v1 (same (source_table,listing_id) key + extra cols) and carries
-- the unique index active_listing_ids_v2_pk, so the indexed join is preserved.
-- Fix: regenerate each function from its LIVE definition with exactly one token substituted
-- (active_listing_ids -> active_listing_ids_v2). Regeneration avoids hand-transcription risk in
-- loc_rel_upsert_table's nested format() strings. Safe because none of the three referenced _v2.
do $mig$
declare r record;
begin
  for r in
    select oid from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('loc_rel_nibble','loc_rel_refresh_one','loc_rel_upsert_table')
  loop
    execute replace(pg_get_functiondef(r.oid), 'active_listing_ids', 'active_listing_ids_v2');
  end loop;

  -- assert the swap took and nothing still references the stale v1 MV (bare, not _v2)
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('loc_rel_nibble','loc_rel_refresh_one','loc_rel_upsert_table')
      and prosrc ~ 'active_listing_ids([^_]|$)'
  ) then
    raise exception 'repoint failed: a loc_rel_* function still references bare active_listing_ids';
  end if;
end $mig$;