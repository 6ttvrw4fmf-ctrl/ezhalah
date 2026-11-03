-- incident-citation-guard.yml red again (2026-11-03, backlog 1263): incidents #1511, #1515, #1521 were closed by the detector
-- self-heal in promote_aged_alerts_to_incidents() with barrier_script = 'auto:detector-self-heal:' || source_ref, and source_ref
-- is the alert's DEDUP KEY — for a sliced detector a generated label («af_chip_vs_db_truth_slice_2») that no file names. The
-- falcon fixed one such incident by hand on 2026-10-30 (#1270, docs/ops/owner-apply/2026-10-30-…); every later slice
-- self-heal re-broke the guard, because the writer was never changed. ROOT FIX: the self-heal cites the alert KIND the
-- incident was promoted from (detail->>'kind', recorded by the same function at promotion) — the name of a real, committed
-- detector family — falling back to the dedup key only when no kind was recorded. Then the three closed incidents are
-- re-cited the same way (state untouched: their alerts are genuinely resolved).
do $mig$
declare d text; n int;
begin
  d := pg_get_functiondef('public.promote_aged_alerts_to_incidents()'::regprocedure);
  if position($x$'auto:detector-self-heal:' || i.source_ref$x$ in d) = 0 then
    raise exception 'promote_aged_alerts_to_incidents: self-heal citation line not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$'auto:detector-self-heal:' || i.source_ref$x$,
    $x$'auto:detector-self-heal:' || coalesce(nullif(i.detail->>'kind', ''), i.source_ref)$x$);
  execute d;

  update public.ops_incident
     set barrier_script = 'auto:detector-self-heal:af_chip_vs_db_truth', updated_at = now()
   where id in (1511, 1515, 1521) and state = 'resolved'
     and barrier_script like 'auto:detector-self-heal:af_chip_vs_db_truth_slice_%';
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'expected to re-cite 3 incidents, did %', n; end if;
end
$mig$;