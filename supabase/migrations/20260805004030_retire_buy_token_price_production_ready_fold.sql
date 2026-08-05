-- Owner PERMANENT rule (2026-08-03, feedback_no-hiding-source-published-prices-rule):
-- "whatever is in the websites they put anything we scrape match display" — if the platform
-- publishes a price we display it and it stays SEARCHABLE at ANY magnitude, explicitly including
-- 1-999 SAR token prices. That rule names this exact fold for retirement, but it was never removed:
-- sync_search_listings_ar still ANDs `not (buy and 0 < price_total < 1000)` into production_ready,
-- withholding 215 Buy listings whose price the platform publishes today (10/10 verified live at
-- source during investigation wf_f22dfe0d-fc3, 2026-08-04).
--
-- The fold appears TWICE and both must go together:
--   1. the INSERT projection  — the value actually written to search_listings_ar;
--   2. the s3.production_ready change-detection clause — which decides whether an existing row is
--      re-synced. Leaving (2) on the old formula would make the sync compare against a predicate the
--      insert no longer uses, so corrected rows would never propagate (the silent-propagation defect
--      class closed on 2026-08-03; do not reintroduce it by editing only one site).
--
-- Guarded needle-edit: rebuilt from the LIVE body, aborts unless BOTH occurrences are present.
do $mig$
declare
  src text;
  old_expr constant text :=
    '(v.production_ready and not (lower(v.transaction_type)=''buy'' and v.price_total is not null and v.price_total > 0 and v.price_total < 1000))';
  new_expr constant text := 'v.production_ready';
  n int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if src is null then raise exception 'sync_search_listings_ar not found'; end if;

  n := (length(src) - length(replace(src, old_expr, ''))) / length(old_expr);
  if n <> 2 then
    raise exception 'expected exactly 2 occurrences of the Buy token-price fold, found %', n;
  end if;

  execute replace(src, old_expr, new_expr);

  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if position(old_expr in src) > 0 then
    raise exception 'fold still present after replace';
  end if;
  if position('s3.production_ready is distinct from v.production_ready' in src) = 0 then
    raise exception 'change-detection clause did not land on the new expression';
  end if;
end
$mig$;

-- Release the rows the retired fold was holding out of search. Location resolution is a SEPARATE and
-- still-valid reason to withhold, so only lift rows that actually resolve; nothing else changes.
update search_listings_ar s
   set production_ready = true
 where not s.production_ready
   and s.deal_ar = 'بيع'
   and s.price_total between 1 and 999
   and s.region_id is not null
   and s.city_id is not null;
