-- Data Integrity Engineer, 2026-09-06. DETECT-ONLY, step 3 of 3 before the repair.
-- The barrier added earlier today joined the view back to wasalt_residential_listings (14.9s on
-- its own). Now that the view publishes evidence_fetched_at / row_captured_at, the same assertion
-- is folded into the aggregate the detector ALREADY runs over the view, so it costs nothing extra.
-- Still no classification change: drift_meaningful is untouched, and this barrier is expected to
-- FIRE on the current view, which is the point of applying it before the repair.
create or replace function public.mon_detect_price_source_mismatch()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_under bigint; v_over bigint; v_minor bigint; v_checked bigint; v_drift_base bigint;
  v_stale bigint; n int := 0; s jsonb;
  v_flag_wrong bigint; v_contemporaneous bigint; v_stale_evidence bigint;
begin
  -- ONE pass over the view answers both the price question and the barrier below it.
  -- `measured` is the relation drift_meaningful claims: the evidence was fetched no more than 48h
  -- before the row's own source capture (crawl every 8h, enrich-ar every 4h, so a healthy pair is
  -- always inside that window). Rows whose arm has no separate evidence fetch (aqar/dealapp read a
  -- snapshot embedded in the row itself) publish NULL timestamps and are not asserted on.
  select count(*) filter (where verdict = 'stored_understated_10x' and drift_meaningful),
         count(*) filter (where verdict = 'stored_overstated_10x'  and drift_meaningful),
         count(*) filter (where verdict = 'differs_minor' and drift_meaningful),
         count(*),
         count(*) filter (where drift_meaningful),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')
                            and not drift_meaningful),
         count(*) filter (where evidence_fetched_at is not null
                            and drift_meaningful is distinct from
                                coalesce(evidence_fetched_at >= row_captured_at - interval '48 hours', false)),
         count(*) filter (where evidence_fetched_at is not null
                            and coalesce(evidence_fetched_at >= row_captured_at - interval '48 hours', false)),
         count(*) filter (where evidence_fetched_at is not null
                            and not coalesce(evidence_fetched_at >= row_captured_at - interval '48 hours', false))
    into v_under, v_over, v_minor, v_checked, v_drift_base, v_stale,
         v_flag_wrong, v_contemporaneous, v_stale_evidence
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

  if v_drift_base > 0 and v_minor > greatest(200::bigint, v_drift_base / 100) then
    n := n + public.mon_raise('P2', 'price_source_drift', 'price_fidelity', 'price_source_drift',
      jsonb_build_object('minor_diffs', v_minor, 'drift_base', v_drift_base,
        'why', 'Many stored prices differ from the source''s captured price at the same magnitude — stale-price drift, i.e. the refresh path is not updating prices.'));
  else
    perform public.mon_resolve('price_source_drift', 'price_fidelity');
  end if;

  -- ── THE BARRIER ─────────────────────────────────────────────────────────────────────────────
  -- drift_meaningful chooses between two OPPOSITE instructions — "repair to the source value" and
  -- "NEVER repair to the snapshot" — so it may never be a constant. Asserted over every row that
  -- has a separate evidence fetch. A literal `true` fails on the stale rows, a literal `false`
  -- fails on the contemporaneous ones, and blanking the timestamps trips the vacuity limb.
  if v_flag_wrong > 0 then
    n := n + public.mon_raise('P1', 'price_corroboration_contemporaneity_unmeasured', 'price_fidelity',
      'price_corroboration_contemporaneity_unmeasured',
      jsonb_build_object(
        'reason', 'flag_disagrees_with_timestamps',
        'rows_misflagged', v_flag_wrong,
        'contemporaneous_rows', v_contemporaneous,
        'stale_evidence_rows', v_stale_evidence,
        'why', 'mon_price_source_corroboration.drift_meaningful does not match the timestamp relation it names on '
             || v_flag_wrong || ' rows. Measured 2026-09-06: ar_data evidence on the wasalt Buy arm averages 56.3 '
             || 'days older than the row it is compared with (94.9% more than 7 days older, worst 72), yet the arm '
             || 'published the constant true, which is the flag meaning "contemporaneous, repair to this value". '
             || 'Where the evidence IS contemporaneous, 1,461 of 1,461 rows agree exactly.',
        'fix', 'Derive drift_meaningful in the view from (evidence_fetched_at >= row_captured_at - 48h), never a literal.'));
  elsif v_contemporaneous = 0 or v_stale_evidence = 0 then
    n := n + public.mon_raise('P2', 'price_corroboration_contemporaneity_unmeasured', 'price_fidelity',
      'price_corroboration_contemporaneity_unmeasured',
      jsonb_build_object(
        'reason', 'vacuous_no_rows_on_one_side',
        'contemporaneous_rows', v_contemporaneous,
        'stale_evidence_rows', v_stale_evidence,
        'why', 'Every corroboration row with a separate evidence fetch now falls on ONE side of the '
             || 'contemporaneity test, so the flag check cannot tell a measured flag from a constant, and one of '
             || 'the two arms of price_source_mismatch is currently unreachable.'));
  else
    perform public.mon_resolve('price_corroboration_contemporaneity_unmeasured', 'price_fidelity');
  end if;

  return n;
end $function$;
