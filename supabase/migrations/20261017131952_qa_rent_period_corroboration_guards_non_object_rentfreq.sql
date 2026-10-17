-- 🔧 Quality & Repair 2026-10-17: mon_detect_rent_period_source_mismatch crashed on every sweep since
-- 00:59 UTC (alert 9717, SQLSTATE 22023 «cannot call jsonb_each on a non-object»). Its view called
-- jsonb_each(ar_data->'propertyInfo'->'rentFreq') unguarded; 8 of 14,789 active wasalt rentals carry
-- rentFreq as a JSON string (e.g. 10900734), and one such row stops the whole detector, so a real
-- stored-vs-source rent-period mismatch would have gone unseen. The view now reads rentFreq only when
-- jsonb_typeof says it is an object; a string answers source_period NULL and leaves the cohort, the
-- same as a row with no rentFreq at all. Column list and types unchanged.
create or replace view public.mon_rent_period_source_corroboration as
 SELECT 'wasalt_residential_listings'::text AS source_table,
    id AS listing_id,
    rent_period AS stored_period,
        CASE ( SELECT e.k
               FROM jsonb_each((wasalt_residential_listings.ar_data -> 'propertyInfo'::text) -> 'rentFreq'::text) e(k, v)
              WHERE (e.v ->> 'default_freq'::text)::boolean
             LIMIT 1)
            WHEN 'yearly'::text THEN 'annual'::text
            WHEN 'monthly'::text THEN 'monthly'::text
            ELSE NULL::text
        END AS source_period,
    price_annual,
    ((ar_data -> 'propertyInfo'::text) ->> 'expectedRent'::text)::numeric AS source_amount,
    ar_fetched_at,
    last_seen_at,
    round(EXTRACT(epoch FROM now() - ar_fetched_at) / 3600.0, 1) AS ar_age_hours,
    ar_fetched_at IS NOT NULL AND ar_fetched_at >= (now() - '48:00:00'::interval) AS contemporaneous
   FROM wasalt_residential_listings
  WHERE active AND transaction_type = 'Rent'::text
    AND jsonb_typeof((ar_data -> 'propertyInfo'::text) -> 'rentFreq'::text) = 'object'
    AND (( SELECT e.k
           FROM jsonb_each((wasalt_residential_listings.ar_data -> 'propertyInfo'::text) -> 'rentFreq'::text) e(k, v)
          WHERE (e.v ->> 'default_freq'::text)::boolean
         LIMIT 1)) IS NOT NULL;