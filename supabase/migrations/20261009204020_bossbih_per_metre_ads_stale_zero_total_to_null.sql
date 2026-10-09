-- 🦅 Falcon 2026-10-09: six bossbih Buy ads served at «0 ر.س» (open alert zero_price_served #4565 since
-- 09-21, owned by a deleted routine). Each ad is priced PER METRE only — its own captured evidence
-- (source_capture.index_card.price_text «المتر N», detail_fields als-r «N ريال» / als-r2 «المتر») shows
-- a rate and no «الإجمالي» total. The rows were first written 2026-09-21 by an older adapter that
-- stored 0; the current adapter (per_sqm branch: price_total = detail.get("site_total") → None) is
-- correct, but the None-dropping upsert (SOURCE IS TRUTH, db._unknown_must_not_overwrite_known)
-- keeps the stale 0 on every daily re-seen (last 10-09 04:44). Silent means NULL, never 0.
-- The code half (the adapter now emits AUTHORITATIVE_NULL on this branch so the upsert clears a
-- stale total) ships with this mirror. Evidence-gated: only a row whose capture shows a per-metre
-- rate and no site total is touched; the counts are asserted.
do $fix$
declare n_res int; n_com int;
begin
  update public.bossbih_residential_listings
     set price_total = null
   where price_total = 0 and price_per_meter is not null
     and coalesce(source_capture->'detail_fields'->>'site_total', source_capture->>'site_total') is null
     and source_capture->'index_card'->>'price_text' like 'المتر %';
  get diagnostics n_res = row_count;
  update public.bossbih_commercial_listings
     set price_total = null
   where price_total = 0 and price_per_meter is not null
     and coalesce(source_capture->'detail_fields'->>'site_total', source_capture->>'site_total') is null
     and source_capture->'index_card'->>'price_text' like 'المتر %';
  get diagnostics n_com = row_count;
  if n_res <> 3 or n_com <> 3 then
    raise exception 'expected exactly 3 + 3 rows (measured 2026-10-09 20:39 UTC), touched % + %; rolled back', n_res, n_com;
  end if;
end $fix$;