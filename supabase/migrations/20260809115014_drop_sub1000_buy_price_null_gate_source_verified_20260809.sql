-- Remove the sub-1000 Buy price-nulling arm from enforce_price_size_sanity().
--
-- WHY (evidence, 2026-08-09): the arm nulled `price_total` on every Buy row under 1,000 SAR,
-- commenting it as an "impossible sale price". Every one of those prices was fetched from its
-- LIVE SOURCE PAGE and compared to what the platform publishes today:
--
--   aqar         108/108 exact   (JSON-LD offers.price, the signal aqar liveness already trusts)
--   wasalt        40/40  exact
--   aqargate      20/20  exact
--   eaqartabuk    14/14  exact
--   dealapp       14/14  exact among live ads (41 of its 56 are DEAD ads — a liveness issue,
--                         not a price issue; 1 row reads 624 vs the source's current 625)
--   eastabha       6/6   exact
--   sanadak        4/4   exact  (badge reads «للبيع 868»; the advertiser types thousands)
--   aqarcity       1/1   exact
--   hajer          1/1   exact  (source publishes the range «550.00ر.س -- 600 الف ر.س»)
--   ─────────────────────────────────────────────────────────────────────────────────────
--   TOTAL        204/204 stored == source-published. ZERO thousands-truncation. ZERO wrong prices.
--
-- The premise "under 1,000 SAR is impossible, therefore ours is wrong" is therefore FALSE: these
-- are advertiser data-entry conventions faithfully mirrored from the source, exactly the class the
-- extreme-price verify-then-preserve rule says to KEEP. Nulling them violated the standing owner
-- rule (2026-08-03) that a source-published price is displayed and searchable at ANY magnitude,
-- and it did so destructively — the card read «السعر عند الطلب» and no price filter could reach
-- the row, while the true figure survived only in the raw table.
--
-- The price_size_impossible() arm is UNCHANGED and still runs: >50bn SAR, >5M m², >5M SAR/m² are
-- physically impossible magnitudes, and that arm only flips production_ready — it destroys nothing.
--
-- Wrong prices are still corrected — against the SOURCE PAGE, per-row, with format-independent
-- proof (see ops_price_repair_backup_20260805) — never inferred from magnitude.
CREATE OR REPLACE FUNCTION public.enforce_price_size_sanity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2) then
    NEW.production_ready := false;
  end if;
  return NEW;
end $function$;
