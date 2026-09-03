-- gathern liveness is now an owner-authorised consumer of the SHARED Saudi residential proxy
-- (2026-09-03), because gathern began answering our datacenter egress with its own 404 page and
-- manufactured false deaths: 302 rows inactivated on 09-01, 106 on 09-02.
--
-- mon_detect_proxy_contention() is the ONLY guard on that pool, and its own comment states the
-- rule: "Every consumer that authenticates with WASALT_PROXY_URL belongs here. Adding a proxy
-- consumer means adding it to THIS predicate in the same change." An uncounted consumer is exactly
-- the blind spot that made a dealapp consumer invisible until 20260830215434 fixed it — the pool
-- does not fail cleanly when oversubscribed, it plateaus at a ~204s connect timeout that reads
-- like a random per-slug source block and is not one.
--
-- NEEDLE EDIT on the LIVE body with the anchor asserted to occur exactly once, never a full-body
-- replace: this function has been rewritten before and a blind replace would silently revert it.
-- The cap (16) is untouched. Nothing is loosened; one consumer is made visible.
do $patch$
declare src text; newsrc text; anchor text; occurrences int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_proxy_contention';

  if src is null then
    raise exception 'mon_detect_proxy_contention not found - refusing to add an uncounted consumer';
  end if;

  if position('gathern_liveness_proxy' in src) > 0 then
    return;                                   -- already counted
  end if;

  anchor := 'or platform = ''dealapp_liveness_proxy'')';
  occurrences := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if occurrences <> 1 then
    raise exception 'expected exactly 1 predicate anchor, found % - refusing to guess', occurrences;
  end if;

  newsrc := replace(src, anchor,
                    'or platform = ''dealapp_liveness_proxy''' || E'\n' ||
                    '            or platform = ''gathern_liveness_proxy'')');
  execute newsrc;

  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_proxy_contention';
  if position('gathern_liveness_proxy' in src) = 0 then
    raise exception 'predicate edit did not take effect';
  end if;
  -- The cap must survive the edit: this migration adds a consumer, it does not widen the pool.
  if position('concurrency_cap constant int := 16' in src) = 0 then
    raise exception 'concurrency cap changed or vanished - refusing to leave the pool unguarded';
  end if;
end
$patch$;
