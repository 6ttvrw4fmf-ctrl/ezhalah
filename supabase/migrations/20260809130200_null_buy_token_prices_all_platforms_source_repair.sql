-- Filter QA (2026-08-05) — token-price repair, ALL affected platforms (supersedes 20260809121715,
-- which covered only aqar/dealapp/wasalt residential).
--
-- ROOT CAUSE (proven from source_capture): these Buy rows carry an impossible price_total (1/400/500)
-- that the SOURCE never published. aqar renders a financing CTA («بخاطرك تتملك العقار؟ استكشف خيارات
-- التمويل») instead of a price on pre-launch/reservation ads; the token was lifted from prose (e.g. the
-- «إعجاب 1» likes count) by an OLD scraper. The CURRENT enrich correctly returns price_total=None
-- (source_capture.price_evidence.stored=null), but _unknown_must_not_overwrite_known drops the None so
-- the stale token can never self-correct. Per the price=source invariant ("use the source's structured
-- price field, or store no price at all"), the faithful value is NULL — "price on request". The row
-- stays fully searchable; this is a data-path repair, NOT hiding a listing or a source-published price.
--
-- Old values are preserved in ops_buy_token_price_repair_20260809b for audit. Idempotent: nulling an
-- already-null price is a no-op, and the backup only captures rows that still carry a token.
do $$
declare t text;
begin
  create table if not exists public.ops_buy_token_price_repair_20260809b(
    source_table text, listing_url text, old_price_total bigint, backed_at timestamptz default now());
  foreach t in array array[
    'aqar_residential_listings','dealapp_residential_listings','wasalt_residential_listings',
    'aqargate_residential_listings','eaqartabuk_residential_listings','eastabha_residential_listings',
    'sanadak_residential_listings','aqarcity_residential_listings','hajer_residential_listings',
    'dealapp_commercial_listings','aqar_commercial_listings'] loop
    execute format(
      'insert into public.ops_buy_token_price_repair_20260809b(source_table, listing_url, old_price_total)
       select %L, listing_url, price_total from public.%I where price_total between 1 and 999', t, t);
    execute format('update public.%I set price_total = null where price_total between 1 and 999', t);
  end loop;
end $$;

-- propagate to the served table now (the BEFORE-trigger re-null keeps it correct between hourly
-- v1-refresh(:00) → sync(:15) cycles; the source is already NULL, so the class converges)
update public.search_listings_ar set price_total = null
 where deal_ar='بيع' and price_total between 1 and 999;
