-- A WHOLE BUILDING NEVER TAKES ITS BATHROOMS FROM THE AD'S PROSE (backlog 1168: «عمارة — decide per source whether it
-- states a total at all»). Measured after the first fill: building ads went 245 → 2,792 with a count, and the sampled
-- ones were PER-FLAT counts — «ودورتين مياه» on a building of 14 flats, «و٣ دورات مياه» on 8, «دورتا مياه» on 6. A
-- building's prose describes a typical flat, not the building's total, on every source sampled. So for property_type
-- Building / Residential Building / Commercial Building the text is ignored and the site's own box (aqar's «عدد
-- الحمامات: 6» when it has one) is the only bathroom count; the next sync puts the 2.5k back to the box value.
-- Patched on the live sync body (both the written value and the change detection); fails closed.
do $mig$
declare
  d text := pg_get_functiondef('public.sync_search_listings_ar()'::regprocedure);
  old_txt constant text := 'public.af_rule_b_num(v.bathrooms::smallint, tf.bathrooms)';
  new_txt constant text := 'public.af_rule_b_num(v.bathrooms::smallint, case when v.property_type in (''Building'', ''Residential Building'', ''Commercial Building'') then null else tf.bathrooms end)';
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 2 then
    raise exception 'sync_search_listings_ar: the two bathrooms merges were not found';
  end if;
  execute replace(d, old_txt, new_txt);
  if position('then null else tf.bathrooms end' in pg_get_functiondef('public.sync_search_listings_ar()'::regprocedure)) = 0 then
    raise exception 'sync_search_listings_ar: building exclusion did not land';
  end if;
end
$mig$;
