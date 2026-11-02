-- 🔧 2026-11-02: mon_detect_located_row_unreachable() no longer raises a P1 on a row the OWNER'S RULE hides.
-- enforce_price_size_sanity() (trg_price_size_sanity, owner 2026-10-28) clears production_ready when
-- price_size_impossible() trips and the row is NOT in ops_price_source_verified — and its own comment records why
-- such a row must NOT be «verified» on the strength of the site displaying the figure (10 rows served at up to
-- 22 trillion SAR under that exemption). So a located, price-gated, unverified row is a deliberate hide, exactly
-- like a dormant platform's rows (already excluded, 2026-09-24): not a reachability defect. Measured 2026-11-02:
-- all 47 open located_row_unreachable alerts (wasalt 36, dealapp 3, aqar 3, haraj 2, aqarcity, muhaysini,
-- aqarmonthly) carried trips_price_gate = true, open since 09-27, re-affirmed every half hour, and wasalt's
-- archived payload prints each figure as the seller's own salePrice. The cohort keeps every row that
-- production_ready = false for ANY OTHER reason (trips_price_gate = false): that is the defect this detector exists for.
-- Edited in place (replace on the live text; raises when the expected text is missing) so nothing is retyped.
do $$
declare src text; new_src text; needle text; addition text;
begin
  select pg_get_functiondef('public.mon_detect_located_row_unreachable'::regproc) into src;
  needle := $n$and coalesce(pr.status, '') <> 'dormant'$n$;
  addition := $a$and coalesce(pr.status, '') <> 'dormant'
     -- owner rule 2026-10-28: a price-gated row the source has not verified is hidden ON PURPOSE (🔧 2026-11-02)
     and not (public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
              and not exists (select 1 from public.ops_price_source_verified v
                               where v.source_table = s.source_table and v.listing_id = s.listing_id))$a$;
  if (length(src) - length(replace(src, needle, ''))) / length(needle) <> 2 then
    raise exception 'mon_detect_located_row_unreachable: expected the dormant clause exactly twice, found %',
      (length(src) - length(replace(src, needle, ''))) / length(needle);
  end if;
  new_src := replace(src, needle, addition);
  new_src := replace(new_src,
    $o$'excluded from this cohort and never appear here.'$o$,
    $o$'excluded from this cohort and never appear here, and so are rows the price gate hides on purpose '
             || '(price_size_impossible true, not in ops_price_source_verified — owner rule 2026-10-28).'$o$);
  if new_src = src then raise exception 'mon_detect_located_row_unreachable: nothing changed'; end if;
  execute new_src;
end $$;
