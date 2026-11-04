-- 🆕 2026-11-04: gathern's own amenity list names the pool («مسبح خارجي بحاجز» 1,349 active units, «مسبح خارجي بدون
-- حاجز» 622, «مسبح عام مشترك» 472, «مسبح داخلي بحاجز» 400, …) but listing_rich_attrs served NULL::boolean AS pool for
-- gathern, so the Advanced Filter's «مسبح» found a chalet only when the seller ALSO wrote «بمسبح» in prose:
-- 23699658 and 23699659 carry the identical list «مسبح داخلي بدون حاجز» and were served NULL and true (score
-- run 41780341136: gathern pool we_miss 4 of 4). Same shape as tabha's features_ar «مسبح» branch in this view.
-- LISTED = YES; absent = NULL (never «no»); a pool marked «(مفرغ)» (emptied) is not claimed.
-- Only the gathern branch's pool column is rewritten; every other branch and column is byte-identical.
do $mig$
declare
  d text := pg_get_viewdef('public.listing_rich_attrs'::regclass);
  marker constant text := '''gathern_residential_listings''::text AS source_table';
  old_col constant text := 'NULL::boolean AS pool';
  i int; j int; u int; f int;
begin
  i := position(marker in d);
  if i = 0 then raise exception 'gathern branch not found in listing_rich_attrs'; end if;
  j := position(old_col in substr(d, i));
  u := position('UNION ALL' in substr(d, i));
  f := position('FROM gathern_residential_listings x' in substr(d, i));
  if j = 0 or f = 0 or j > f or (u > 0 and f > u) then
    raise exception 'gathern branch shape changed (pool %, from %, union %) — refusing to rewrite', j, f, u;
  end if;
  d := substr(d, 1, i + j - 2)
    || 'CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(x.additional_info -> ''amenities'') = ''array'' '
    || 'THEN x.additional_info -> ''amenities'' ELSE ''[]''::jsonb END) a(l) WHERE a.l LIKE ''مسبح%'' AND a.l NOT LIKE ''%مفرغ%'') '
    || 'THEN true ELSE NULL::boolean END AS pool'
    || substr(d, i + j - 1 + length(old_col));
  execute 'create or replace view public.listing_rich_attrs as ' || d;
end
$mig$;
