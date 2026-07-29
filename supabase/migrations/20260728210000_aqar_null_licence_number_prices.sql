-- aqar Buy price corruption: the stored "price" is a REGA advertisement licence number.
-- P1 from the 2026-07-28 audit. Owner-approved.
--
-- MECHANISM (fixed in the same PR, scrapers/aqar/enrich_residential.py): the Buy fallback pattern
-- `(\d{6,9})\s*[§ر﷼]` carried the bare Arabic letter «ر» in its currency class. The page prints
--     «... رخصة الإعلان 7100267943 رابط رخصة الإعلان ...»
-- so the pattern matched the licence's last 9 digits against the ر of the FOLLOWING word «رابط» and
-- stored 100267943 as price_total. Every affected row therefore lands in [100,000,000-101,000,000).
-- price_per_meter was then derived from that number (783,343 = 100,267,943 / 128), so one bad parse
-- produced two wrong figures on the card and wrecked price sorting/filtering for Buy searches.
--
-- WHAT THIS MIGRATION TOUCHES — ONLY rows that PROVE their own corruption. The gate is
--     source_capture->>'source_text' ~ ('7' || price_total::text)
-- i.e. the stored price appears in the row's OWN captured page text as the tail of a licence number.
-- That is format-independent proof, not a resemblance: 49 rows in aqar_residential_listings.
-- aqar_commercial_listings has 0 rows in the shape and is untouched.
--
-- WHY NULL AND NOT A CORRECTED VALUE. We can prove the stored number is false; we CANNOT prove what
-- the real price is. `aqar_parse` on the same stored capture returns implausible alternatives for
-- these rows (460 for a 128 m² Jeddah apartment, 3,615 for an 884 m² villa) — those are unverified,
-- and sa.aqar.fm renders prices client-side, so the live page cannot adjudicate them either (fetched
-- 2026-07-28: HTTP 200, but no price key anywhere in the payload). Under the absolute-fidelity rule
-- NULL is the honest state — "the source has a price, we do not currently have it" — and writing a
-- guess would replace one fabrication with another. The next enrichment pass that captures a fresh
-- page will refill it correctly through trg_aqar_parse, which only assigns when its parse is NOT
-- null, so a NULL here can never be "corrected" into garbage.
--
-- `fullparse_done := true` is set in the SAME statement on purpose. trg_aqar_parse short-circuits on
-- (UPDATE, source_capture unchanged, NEW.fullparse_done) — evaluating the NEW value — so this keeps
-- the trigger from immediately re-deriving the bad price from the stale capture and undoing the fix.
--
-- price_per_meter is nulled ONLY where it is arithmetically the fabricated price / area (±1), i.e.
-- provably derived from the value being removed. A source-published «سعر المتر» is left alone.
-- (Fleet-wide derived-ppm is a separate, pre-existing condition — 44,096 of 53,048 other aqar Buy
-- rows — and is deliberately NOT in scope here.)
--
-- NOT TOUCHED, reported instead: 259 further rows sit in the same numeric shape but their captures
-- are truncated stubs (avg 331 chars, min 27; only 6 contain the «تفاصيل الإعلان» block) that do not
-- contain the stored number in any form, so nothing is proven per-row. Their digit distribution
-- matches the licence signature rather than real prices — 86.6% are not even round to 10, versus
-- 6.5% across 23,680 genuine aqar Buy prices — but a distribution is not per-row evidence, and ~5 of
-- them ARE round to the million and may be genuine. They need a source RE-FETCH, not a SQL guess.

do $$
declare
  n_expected constant int := 49;
  n_price int;
  n_ppm   int;
begin
  select count(*) into n_price
    from public.aqar_residential_listings
   where active and transaction_type = 'Buy'
     and (   (price_total >= 100000000 and price_total < 101000000)
          or (price_total >= 500000000 and price_total < 600000000))
     and source_capture->>'source_text' ~ ('7' || price_total::text);

  -- Fail closed if the target set moved since the audit: better to abort than to null a price we
  -- have not re-proven. Re-run the gate query and update n_expected deliberately if it legitimately
  -- changed (a crawl can repair or add rows between audit and apply).
  if n_price <> n_expected then
    raise exception 'aqar licence-price gate matched % rows, expected % — aborting rather than '
                    'nulling an unverified set', n_price, n_expected;
  end if;

  update public.aqar_residential_listings a
     set price_total     = null,
         price_per_meter = case
           when a.area_m2 > 0
            and a.price_per_meter is not null
            and abs(a.price_per_meter - round(a.price_total::numeric / a.area_m2)) <= 1
           then null
           else a.price_per_meter
         end,
         fullparse_done  = true
   where a.active and a.transaction_type = 'Buy'
     and (   (a.price_total >= 100000000 and a.price_total < 101000000)
          or (a.price_total >= 500000000 and a.price_total < 600000000))
     and a.source_capture->>'source_text' ~ ('7' || a.price_total::text);

  get diagnostics n_ppm = row_count;
  if n_ppm <> n_expected then
    raise exception 'aqar licence-price repair updated % rows, expected % — rolling back', n_ppm, n_expected;
  end if;

  raise notice 'aqar licence-price repair: % row(s) nulled (price + derived ppm), fullparse_done pinned', n_ppm;
end $$;
