-- THE PROBE'S CLEAN SLATE MUST SURVIVE THE ROLE THE BARRIER ACTUALLY CALLS IT AS.
--
-- FOUND MINUTES AFTER 20260906040717 SHIPPED, by calling the new RPC through the anon key instead
-- of the privileged MCP connection: HTTP 400, SQLSTATE 21000, "DELETE requires a WHERE clause".
-- The `authenticator` role preloads `safeupdate` (session_preload_libraries = supautils,
-- safeupdate), so every statement the PostgREST roles run is subject to a guard the postgres role
-- is not. The probe worked perfectly as postgres and could not run at all as anon — the exact
-- shape of the repo's "verify through the anon key, never a privileged connection" rule, and the
-- reason a live barrier must be executed once through its real path before it is called done.
--
-- A qualified DELETE is not a reliable fix either: safeupdate looks for a qual on the plan, and a
-- planner that folds `where true` away, or lifts `where id > 0` into an index condition, leaves it
-- looking bare again. TRUNCATE is not an UPDATE or a DELETE, so the guard does not apply to it, it
-- is transactional (the probe's subtransaction still discards it), and it is what
-- public.ops_test_field_range_synthetic's own comment has said since 20260821031441 created it:
-- "Truncated and reseeded on every run of that script".
--
-- Guarded needle-edit per the RPC full-body-replace rule: built from the LIVE definition, aborts if
-- the anchor is not found, so it can never re-emit a stale body over somebody else's change.
do $mig$
declare src text; out text;
begin
  src := pg_get_functiondef('public.ops_probe_field_range_composite()'::regprocedure);

  out := replace(src,
    '      delete from public.ops_test_field_range_synthetic;',
    '      -- TRUNCATE, not DELETE: the PostgREST roles preload `safeupdate`, which refuses an
      -- unqualified DELETE (SQLSTATE 21000). Defensive either way — the committed table is always
      -- empty, because every scenario''s rows are rolled back with the subtransaction below.
      truncate public.ops_test_field_range_synthetic;');

  if out = src then
    raise exception 'anchor not found in ops_probe_field_range_composite() — refusing to replace a body I did not read';
  end if;

  execute out;
end $mig$;
