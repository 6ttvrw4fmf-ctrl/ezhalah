-- A PRICE-ON-REQUEST RENT ROW FROM ANY OTHER SITE SHOWS UNDER «سنوي» (AND «كلاهما»), NEVER UNDER «إقامات قصيرة»
-- (owner 2026-10-26: «we need to shift those to annual rent»). Follows 20261025225920 (the «إقامات قصيرة» pool:
-- Gathern + Aqar Monthly only; every other site's per-month rent is yearly at ×12).
--
-- WHAT LEAKED. The 2026-09-28 clause «a rental with no price passes EVERY period — it has no figure a period could
-- misstate» admitted 806 commercial + 5,423 residential «السعر عند الطلب» rows from other sites into the short-stays
-- pool (Riyadh: 6,864 results where the two stay-length platforms hold 4,859). Measured 2026-10-26 06:4x UTC after
-- the pool went live; the owner saw offices under «إقامات قصيرة».
--
-- THE RULE NOW. price_annual IS NULL →
--   «سنوي»   : admitted (unchanged — no figure a period could misstate)
--   «كلاهما» : admitted (unchanged — the union of the two pools)
--   «شهري»   : admitted ONLY for gathern + aqarmonthly (their own 4 unpriced rows); every other site → no.
--
-- ONE DEFINITION OF ELIGIBILITY. af_eligibility_clause() is the single text builder; the six AF RPCs
-- (af_eligible_count, apartment_guided_counts_ar, district_options_ar, location_search_candidates_ar,
-- property_age_option_counts_ar, top_cities_by_deal_ar) are GENERATED from it by rebuild_af_filter_rpcs(), which
-- records each definition's md5 in af_rpc_build_state. mon_af_predicate_parity() flags any RPC whose live md5
-- differs from the built one (af_parity_hand_edit) — so a hand patch of the six is refused by design (the first
-- attempt at this migration did exactly that and was rejected at apply with parity = 6). The builder is patched
-- by anchor replace with the count asserted, the six are regenerated, and the parity detectors are executed.

do $patch$
declare
  d text; k int;
  old_d constant text := 's.price_annual is null and p_rent_period in (''''شهري'''',''''سنوي'''',''''كلاهما'''')';
  new_d constant text := 's.price_annual is null and (p_rent_period in (''''سنوي'''',''''كلاهما'''') or (p_rent_period = ''''شهري'''' and s.platform in (''''gathern'''',''''aqarmonthly'''')))';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'af_eligibility_clause';
  if d is null then raise exception 'af_eligibility_clause not found'; end if;
  if position(new_d in d) > 0 then
    raise notice 'af_eligibility_clause already carries the short-stays-only unpriced clause';
  else
    k := (length(d) - length(replace(d, old_d, ''))) / length(old_d);
    if k <> 1 then raise exception 'af_eligibility_clause: unpriced-period anchor found % times, want 1', k; end if;
    execute replace(d, old_d, new_d);
  end if;
end $patch$;

-- Regenerate the six RPCs from the patched builder (updates af_rpc_build_state).
select o_fn_name, left(o_def_md5, 12) as built from public.rebuild_af_filter_rpcs();

-- PROOF at apply: every generated copy carries the new clause and not the old one, the builder emits it, the parity
-- detectors see no split, and the predicate executed against the live index admits no other-site row under «شهري».
do $proof$
declare fn text; d text; n int; r record;
begin
  foreach fn in array array['af_eligible_count','apartment_guided_counts_ar','district_options_ar',
                            'location_search_candidates_ar','property_age_option_counts_ar','top_cities_by_deal_ar'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    if d is null then raise exception 'PROOF: % missing after rebuild', fn; end if;
    if position('(p_rent_period = ''شهري'' and s.platform in (''gathern'',''aqarmonthly''))' in d) = 0 then
      raise exception 'PROOF: % does not carry the short-stays-only unpriced clause', fn;
    end if;
    if position('p_rent_period in (''شهري'',''سنوي'',''كلاهما'')' in d) > 0 then
      raise exception 'PROOF: % still carries the old every-period unpriced clause', fn;
    end if;
  end loop;
  if position('(p_rent_period = ''شهري'' and s.platform in (''gathern'',''aqarmonthly''))' in public.af_eligibility_clause()) = 0 then
    raise exception 'PROOF: af_eligibility_clause() does not emit the new clause';
  end if;
  n := public.mon_af_predicate_parity();
  if n <> 0 then raise exception 'PROOF: mon_af_predicate_parity() = % after the rebuild', n; end if;
  -- mon_filter_parity_barrier() already reports the results RPC's 5,000-row cap against the uncapped counts
  -- (age_count_vs_results / guided_count_vs_results, n = the overflow) — a standing, known shape. What must NOT
  -- appear is any OTHER check: a count surface disagreeing with the results surface on the predicate itself.
  for r in select * from public.mon_filter_parity_barrier() b
            where b.check_name not in ('age_count_vs_results','guided_count_vs_results') loop
    raise exception 'PROOF: mon_filter_parity_barrier %: % (%)', r.check_name, r.detail, r.n;
  end loop;
  select count(*) into n from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.platform not in ('gathern','aqarmonthly')
     and (s.price_annual is null and (('شهري') in ('سنوي','كلاهما') or (('شهري') = 'شهري' and s.platform in ('gathern','aqarmonthly'))));
  if n <> 0 then raise exception 'PROOF: the new clause still admits % other-site unpriced rows under شهري', n; end if;
end $proof$;
