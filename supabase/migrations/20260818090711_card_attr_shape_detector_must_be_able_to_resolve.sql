-- mon_detect_card_attr_value_shape() could OPEN an alert and never CLOSE one.
--
-- mon_detect_unresolvable_detector() caught this within eight minutes of the detector landing
-- (P2 'unresolvable_detector', 2026-08-18 08:59) and it is right: a detector that only ever raises
-- leaves a cleared condition reading as a standing alert forever, AND -- the dangerous half --
-- mon_raise() returns 0 for a genuine RE-occurrence while the key sits open, so the roster count
-- stays 0 and the bug class goes unpaged.
--
-- FIX per that detector's own instruction: call mon_resolve_stale_keys(kind, live_keys) on the
-- EVALUATED path only -- after the mon_claim_daily_slot() early return, so a run that never looked
-- at the condition can never close someone else's open alert -- passing exactly the dedup keys this
-- run re-raised. When the barrier comes back clean the array is empty and every open key closes.
create or replace function public.mon_detect_card_attr_value_shape()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record; live text[] := '{}';
begin
  -- Gate FIRST: a gated run has not evaluated anything, so it must not resolve anything either.
  if not public.mon_claim_daily_slot('card_attr_value_shape') then return 0; end if;
  for r in select * from public.mon_card_attr_shape_barrier() loop
    live := live || ('card_attr_value_shape:' || r.source_table);
    n := n + public.mon_raise(
      'P2', 'card_attr_value_shape', split_part(r.source_table, '_', 1),
      'card_attr_value_shape:' || r.source_table,
      jsonb_build_object(
        'why', 'A served listing carries an additional_info value shaped as a JSON object/array. '
            || 'The card renders it through String(), which prints the literal "[object Object]" '
            || 'to the user. Numbers are NOT reported here - those render correctly since the '
            || '2026-08-18 coercion fix.',
        'table', r.source_table, 'rows', r.n, 'sample', r.sample,
        'adjudicate', 'Do NOT rewrite the source value. Decide how this shape should DISPLAY, add '
                   || 'the mapping in buildAdditionalInfo() (src/data/remote.ts) next to the '
                   || 'existing array/boolean branches, and extend '
                   || 'scripts/verify-card-attr-value-coercion.ts to cover it.'));
  end loop;
  -- Evaluated path only: close every key this run did NOT re-raise.
  perform public.mon_resolve_stale_keys('card_attr_value_shape', live);
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'card_attr_value_shape';
  return n;
end $function$;
