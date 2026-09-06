-- THE CLASS DETECTOR'S FIRST FINDING WAS ONE OF MINE, TWENTY MINUTES OLD.
--
-- mon_detect_declared_kind_without_emitter() (20260906041438) reported `orphan_after_delete` as having
-- no emitter — while mon_detect_orphan_after_delete(), applied minutes earlier in 20260906041121, was
-- sitting right there raising it. The predicate looks for the kind in mon_raise's SECOND argument:
--
--     mon_raise\s*\(\s*[^,]+,\s*'<kind>'
--
-- and that detector computed its severity INLINE, with a CASE whose IN-list contains commas:
--
--     public.mon_raise(
--       case when r.surface in ('search_listings_ar', 'active_listing_ids_v2') then 'P1' else 'P2' end,
--       'orphan_after_delete', ...
--
-- so the first argument is not comma-free and the kind is not in a second position any tokeniser can
-- find. Two readings were available and only one of them is allowed here.
--
-- The WRONG one: loosen the predicate to "the body mentions mon_raise and mentions the string". That
-- passes on a comment, on a mon_resolve call, on a jsonb payload — every shape where a kind reads as
-- covered while nothing can raise it, which is ops_incident #25 exactly. A barrier is not widened to
-- accommodate the code it judges (ENGINEER_ROUTINES.md §G.7), and the false direction here is the
-- expensive one: a false RED is noise, a false GREEN is the incident.
--
-- The RIGHT one: the barrier has a point. A reader — human or regex — should be able to see which kind
-- a detector raises without evaluating an expression first. So the severity is computed into a variable
-- before the call, the literal moves into plain argument position, and the predicate stays strict. The
-- alert this raised clears itself on the next sweep through mon_resolve_stale_keys().
--
-- Behaviour is unchanged: same two severities, same surfaces, same dedup keys, same payload. Only the
-- shape of the call changes. Needle-edited off the LIVE body rather than retyped, every needle asserted
-- to have matched, and the result re-checked against the predicate that flagged it.
do $fix$
declare
  v_src text;
  v_new text;
begin
  v_src := pg_get_functiondef('public.mon_detect_orphan_after_delete'::regproc);

  if v_src !~ 'case when r\.surface in' then
    raise notice 'mon_detect_orphan_after_delete() no longer computes severity inline; nothing to do';
    return;
  end if;

  -- 1. a local for the severity
  v_new := replace(v_src,
$needle$  r    record;
  k    text;$needle$,
$rep$  r    record;
  k    text;
  sev  text;$rep$);
  if v_new = v_src then
    raise exception 'declaration needle did not match — refusing to rewrite the detector blind';
  end if;
  v_src := v_new;

  -- 2. the literal moves into argument position — and the two comment lines above it move out with the
  --    CASE, because prose contains commas too ("internal consistency, which is why...") and a comment
  --    sitting between mon_raise( and its first argument hides the kind exactly as the CASE did
  v_new := replace(v_src,
$needle$      -- A user can reach the first two. The rest are internal consistency, which is why they are not
      -- dressed up as the same emergency; neither is dismissed.
      case when r.surface in ('search_listings_ar', 'active_listing_ids_v2') then 'P1' else 'P2' end,$needle$,
$rep$      sev,$rep$);
  if v_new = v_src then
    raise exception 'call-site needle did not match — refusing to rewrite the detector blind';
  end if;
  v_src := v_new;

  -- 3. and the decision it replaced happens just before the call, unchanged
  v_new := replace(v_src,
$needle$    live := live || k;$needle$,
$rep$    live := live || k;
    -- A user can reach the first two. The rest are internal consistency, which is why they are not
    -- dressed up as the same emergency; neither is dismissed.
    sev := case when r.surface in ('search_listings_ar', 'active_listing_ids_v2')
                then 'P1' else 'P2' end;$rep$);
  if v_new = v_src then
    raise exception 'assignment needle did not match — refusing to rewrite the detector blind';
  end if;

  execute v_new;
end;
$fix$;

-- The whole point: the predicate that flagged it must now be satisfied, and the detector must still be
-- the thing that raises this kind.
do $verify$
declare
  v_missing text[];
begin
  v_missing := public.mon_declared_kinds_without_emitter();
  if 'orphan_after_delete' = any (v_missing) then
    raise exception 'orphan_after_delete is STILL not recognised as emitted after the rewrite: %', v_missing;
  end if;
  if pg_get_functiondef('public.mon_detect_orphan_after_delete'::regproc)
       !~ 'mon_raise\s*\(\s*sev,\s*''orphan_after_delete''' then
    raise exception 'the rewritten detector does not raise orphan_after_delete in argument position';
  end if;
end;
$verify$;
