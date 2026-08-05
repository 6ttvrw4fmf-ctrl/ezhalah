-- P1 interim gate (senior audit run #2, owner-approved 2026-08-03): exclude deal=Buy rows whose
-- price_total is an implausible token (0<price_total<1000) from the searchable projection, so users
-- never see fake "1 SAR" sale cards while the parser fix + raw backfill are scoped. REVERSIBLE:
-- revert sync_search_listings_ar to the prior body + UPDATE the rows back to production_ready per v2.
-- Guarded needle-edit: build from the LIVE function def, abort if the anchors are not found.
-- (Recovered to the repo by senior audit run #3 — applied live 2026-08-03 11:23 UTC by a concurrent
-- session; content byte-exact from supabase_migrations.schema_migrations.statements.)
do $mig$
declare src text; out text;
begin
  src := pg_get_functiondef('public.sync_search_listings_ar'::regproc);
  -- edit 1: gate the projected production_ready value (SELECT list, unique anchor = "... from listing_native_location_v2 v")
  out := regexp_replace(src,
    $pat1$v\.production_ready(\s+)from listing_native_location_v2 v$pat1$,
    $rep1$(v.production_ready and not (lower(v.transaction_type)='buy' and v.price_total is not null and v.price_total > 0 and v.price_total < 1000))\1from listing_native_location_v2 v$rep1$);
  -- edit 2: gate the change-detect comparison with the SAME expression so gated rows do not re-sync every run
  out := regexp_replace(out,
    $pat2$s3\.production_ready is distinct from v\.production_ready$pat2$,
    $rep2$s3.production_ready is distinct from (v.production_ready and not (lower(v.transaction_type)='buy' and v.price_total is not null and v.price_total > 0 and v.price_total < 1000))$rep2$);
  if out = src then raise exception 'sync_search_listings_ar: needles not found — aborting (function shape changed)'; end if;
  if (length(out) - length(replace(out, 'price_total < 1000', ''))) / length('price_total < 1000') <> 2
     then raise exception 'gate expression applied % times, expected 2 — aborting',
          (length(out) - length(replace(out, 'price_total < 1000', ''))) / length('price_total < 1000'); end if;
  execute out;
end
$mig$;

-- immediate user-facing effect (next sync keeps it consistent via edit 2)
update public.search_listings_ar
   set production_ready = false
 where production_ready and deal_ar = 'بيع' and price_total is not null and price_total > 0 and price_total < 1000;

-- regression monitor (detect-only, over the LIGHT search table — no heavy-view timeout risk)
create or replace view public.mon_buy_token_price as
select
  count(*) filter (where price_total > 0 and price_total < 1000)  as buy_lt_1000,
  count(*) filter (where price_total > 0 and price_total < 10000) as buy_lt_10000,
  count(*) filter (where price_total > 0 and price_total < 1000 and not production_ready) as gated_lt_1000
from public.search_listings_ar
where deal_ar = 'بيع';
