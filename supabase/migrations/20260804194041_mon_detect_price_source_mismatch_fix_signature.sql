-- Corrected to the LIVE mon_raise contract: mon_raise(p_sev, p_kind, p_platform, p_dedup, p_detail jsonb)
-- returning int, paired with mon_resolve(kind, platform) for self-healing — same shape as
-- mon_detect_price_fidelity. (The first version assumed a signature instead of reading the live
-- one; the audit rule is fetch-and-pin the reference first.)
create or replace function public.mon_detect_price_source_mismatch()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_under bigint; v_over bigint; v_minor bigint; v_checked bigint; n int := 0; s jsonb;
begin
  select count(*) filter (where verdict = 'stored_understated_10x'),
         count(*) filter (where verdict = 'stored_overstated_10x'),
         count(*) filter (where verdict = 'differs_minor'),
         count(*)
    into v_under, v_over, v_minor, v_checked
    from public.mon_price_source_corroboration;

  -- >=10x disagreement cannot be a source price change — it is the ppm-as-total / truncation
  -- class (a 5M villa served at 7,500 SAR). P1, with the offending ids in the payload.
  if (v_under + v_over) > 0 then
    s := jsonb_build_object(
      'understated_10x', v_under, 'overstated_10x', v_over, 'corroborated', v_checked,
      'sample_ids', (select jsonb_agg(jsonb_build_object('source_table', source_table, 'listing_id', listing_id,
                                                         'stored', stored, 'source_price', source_price))
                       from (select * from public.mon_price_source_corroboration
                              where verdict in ('stored_understated_10x','stored_overstated_10x')
                              order by listing_id limit 20) x),
      'why', 'A stored price disagrees with the platform''s OWN captured price by >=10x. Owner invariant: THE PRICE ON THE SOURCE WEBSITE = THE PRICE EZHALAH STORES. Repair to the source-displayed value; never compute one.');
    n := n + public.mon_raise('P1', 'price_source_mismatch', 'price_fidelity', 'price_source_mismatch_10x', s);
  else
    perform public.mon_resolve('price_source_mismatch', 'price_fidelity');
  end if;

  -- Same-magnitude drift is normal (listings get discounted); only escalate if it becomes
  -- population-scale rather than the usual handful.
  if v_checked > 0 and v_minor > greatest(200::bigint, v_checked / 100) then
    n := n + public.mon_raise('P2', 'price_source_drift', 'price_fidelity', 'price_source_drift',
      jsonb_build_object('minor_diffs', v_minor, 'corroborated', v_checked,
        'why', 'Many stored prices differ from the source''s captured price at the same magnitude — stale-price drift, i.e. the refresh path is not updating prices.'));
  else
    perform public.mon_resolve('price_source_drift', 'price_fidelity');
  end if;
  return n;
end $function$;

comment on function public.mon_detect_price_source_mismatch() is
  'PRICE = SOURCE corroboration detector. Reads captured source-price evidence only (no external calls, no rate-limit surface). Report-only: never edits a price, hides a listing, or flips active.';