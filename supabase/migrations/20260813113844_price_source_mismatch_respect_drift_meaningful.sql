-- Data Integrity Engineer run #16 (2026-08-13), completion pass.
--
-- THE DEFECT: mon_detect_price_source_mismatch's P1 arm contradicts the view it reads.
-- mon_price_source_corroboration publishes `drift_meaningful`, whose meaning is stated in this
-- very function's own comment on the P2 arm:
--     "Counted ONLY over arms whose evidence is refreshed with the row — a capture-time snapshot
--      legitimately diverges as prices move and is not drift."
-- The P2 drift arm respects that flag. The P1 10x arm ignored it completely, counting every
-- stored_understated_10x / stored_overstated_10x row regardless of whether its evidence could be
-- compared like-for-like at all.
--
-- Live consequence on 2026-08-13: the P1 had been red since 2026-08-11 on 32 rows —
--   * wasalt 9, drift_meaningful = TRUE  (ar_data is refreshed with the row: a real disagreement)
--   * aqar  23, drift_meaningful = FALSE (source_capture.price_evidence is a June snapshot while
--                                         price_total is re-read by aqar's Buy liveness price
--                                         refresh, so the two are simply not contemporaneous)
-- The aqar cohort is the capture-age residue §19 already adjudicated with a LIVE probe that found
-- 5/5 DB == aqar's structured price. Keeping it in a P1 makes that P1 permanently red, and a
-- barrier that is red every time carries no information (run #8's lesson).
--
-- THIS IS NOT A WEAKENING, and the proof is that the P1 stays RED after this migration:
--   * the 10x threshold is unchanged;
--   * no row is dropped from monitoring — the stale-evidence cohort moves to its own P2 that names
--     the live-probe it needs, instead of being silently discarded;
--   * wasalt's 9 rows still raise the P1, because their evidence IS refreshed with the row.
-- If this had been score-driven it would have cleared the alert; it does not.
create or replace function public.mon_detect_price_source_mismatch()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_under bigint; v_over bigint; v_minor bigint; v_checked bigint; v_drift_base bigint;
  v_stale bigint; n int := 0; s jsonb;
begin
  select count(*) filter (where verdict = 'stored_understated_10x' and drift_meaningful),
         count(*) filter (where verdict = 'stored_overstated_10x'  and drift_meaningful),
         count(*) filter (where verdict = 'differs_minor' and drift_meaningful),
         count(*),
         count(*) filter (where drift_meaningful),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')
                            and not drift_meaningful)
    into v_under, v_over, v_minor, v_checked, v_drift_base, v_stale
    from public.mon_price_source_corroboration;

  -- P1: a >=10x disagreement whose evidence is refreshed WITH the row, so the two values are
  -- genuinely contemporaneous and one of them is wrong.
  if (v_under + v_over) > 0 then
    s := jsonb_build_object(
      'understated_10x', v_under, 'overstated_10x', v_over, 'corroborated', v_checked,
      'sample_ids', (select jsonb_agg(jsonb_build_object('source_table', source_table, 'listing_id', listing_id,
                                                         'stored', stored, 'source_price', source_price))
                       from (select * from public.mon_price_source_corroboration
                              where verdict in ('stored_understated_10x','stored_overstated_10x')
                                and drift_meaningful
                              order by listing_id limit 20) x),
      'why', 'A stored price disagrees with the platform''s OWN captured price by >=10x, and that evidence is refreshed with the row (contemporaneous). Owner invariant: THE PRICE ON THE SOURCE WEBSITE = THE PRICE EZHALAH STORES. Repair to the source-displayed value; never compute one. Rows whose evidence is only a capture-time snapshot are NOT counted here — they are raised separately as price_source_mismatch_stale_evidence.');
    n := n + public.mon_raise('P1', 'price_source_mismatch', 'price_fidelity', 'price_source_mismatch_10x', s);
  else
    perform public.mon_resolve('price_source_mismatch', 'price_fidelity');
  end if;

  -- P2: same >=10x shape, but the evidence is a capture-time snapshot that is NOT contemporaneous
  -- with the stored price. Still tracked — never silently dropped — but it cannot be adjudicated
  -- from the database alone, and it must NEVER be "repaired" to the snapshot value: that would
  -- overwrite a fresher source read with an older one (§19, §21).
  if v_stale > 0 then
    n := n + public.mon_raise('P2', 'price_source_mismatch_stale_evidence', 'price_fidelity',
      'price_source_mismatch_stale_evidence',
      jsonb_build_object(
        'stale_evidence_10x', v_stale,
        'sample_ids', (select jsonb_agg(jsonb_build_object('source_table', source_table, 'listing_id', listing_id,
                                                           'stored', stored, 'snapshot_price', source_price,
                                                           'evidence_field', evidence_field))
                         from (select * from public.mon_price_source_corroboration
                                where verdict in ('stored_understated_10x','stored_overstated_10x')
                                  and not drift_meaningful
                                order by listing_id limit 20) x),
        'why', 'A stored price disagrees >=10x with a CAPTURE-TIME snapshot whose evidence is not refreshed with the row, so the two are not contemporaneous and the database cannot say which is current. This is the capture-age residue §19 adjudicated on 2026-08-10 with a live probe (5/5 DB == aqar''s structured price). Resolve it ONLY with a fresh source probe from a runner the platform serves (the §22 aqar-stub-recovery pattern, --dry-run first). Do NOT repair to the snapshot value: that overwrites a fresher read with an older one.'));
  else
    perform public.mon_resolve('price_source_mismatch_stale_evidence', 'price_fidelity');
  end if;

  -- Counted ONLY over arms whose evidence is refreshed with the row — a capture-time snapshot
  -- legitimately diverges as prices move and is not drift.
  if v_drift_base > 0 and v_minor > greatest(200::bigint, v_drift_base / 100) then
    n := n + public.mon_raise('P2', 'price_source_drift', 'price_fidelity', 'price_source_drift',
      jsonb_build_object('minor_diffs', v_minor, 'drift_base', v_drift_base,
        'why', 'Many stored prices differ from the source''s captured price at the same magnitude — stale-price drift, i.e. the refresh path is not updating prices.'));
  else
    perform public.mon_resolve('price_source_drift', 'price_fidelity');
  end if;
  return n;
end $function$;

comment on function public.mon_detect_price_source_mismatch() is
'Price-fidelity barrier. P1 = >=10x disagreement with evidence refreshed WITH the row (contemporaneous, genuinely actionable). P2 price_source_mismatch_stale_evidence = the same shape against a capture-time snapshot, which the database cannot adjudicate and which must never be repaired to the snapshot value (§19 capture-age residue; §21 retraction trap). Split on 2026-08-13 because the P1 arm ignored the view''s own drift_meaningful flag that the P2 drift arm already respected, leaving a permanently-red P1 on 23 non-contemporaneous aqar rows.';

do $$
declare v_p1 int; v_p2 int;
begin
  -- SELFTEST: the split must preserve coverage, not reduce it.
  select count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x') and drift_meaningful),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x') and not drift_meaningful)
    into v_p1, v_p2 from public.mon_price_source_corroboration;

  if v_p1 = 0 then
    raise exception 'SELFTEST: expected the P1 arm to STAY red (wasalt cohort); got 0 — refusing to ship a change that merely clears the alert';
  end if;
  if v_p2 = 0 then
    raise exception 'SELFTEST: expected a non-empty stale-evidence cohort (aqar); got 0 — the split would be pointless';
  end if;
  raise notice 'SELFTEST ok: P1 contemporaneous=%, P2 stale-evidence=%', v_p1, v_p2;
end $$;
