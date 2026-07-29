-- aqar licence-number-as-price, THIRD and final cohort: the rows whose EVIDENCE was frozen away.
-- Owner-approved. Completes PR#257 («71…» band) and PR#266 («72…» band, in-capture proof).
--
-- WHY A THIRD PASS. #266 required the licence digits to still be present in the row's own capture
-- (`source_text ~ '7' || price_total`). 68 rows satisfied that. But trg_aqar_parse freezes a parsed
-- price via `fullparse_done`, and captures get REPLACED on later crawls — so a row parsed in the buggy
-- era keeps the fabricated price while its capture no longer contains the licence digits at all. Those
-- rows are invisible to an in-capture gate. 451 of them remain.
--
-- THE BAND IS THE ARTIFACT — population evidence, measured on live data:
--   band                                  rows   not-round-to-10
--   100.0-101.1M  («71» licence band)        0   —      (cleaned by #257/#266)
--   101.1-200.0M  (between)                 24   33%
--   200.0-201.1M  («72» licence band)      452   90%
--   201.1-900.0M  (above)                   13   23%
-- Genuine high-value aqar Buy listings across the whole 101M-900M span number 37. The 1.1M-wide «72»
-- licence window alone holds 452 — a ~12x concentration inside 0.14% of the numeric range — with a 90%
-- non-round signature against a 6.5% baseline across 23,680 genuine aqar Buy prices. REGA «72»
-- licences run 7200xxxxxx-7201xxxxxx, so the observed span [200,000,000-201,016,623] matches the
-- licence serial range exactly, and 68 rows IN THAT SAME BAND were proven in-capture by #266. Same
-- band + same fingerprint + same proven mechanism.
--
-- PER-ROW SAFETY VALVE — this is the important part. The gate EXCLUDES any row whose stored price is
-- confirmed by `aqar_parse`, the DB parser that requires the full word «ريال» and is therefore immune
-- to the bare-«ر» bug (verified: it reproduces the corrupt value for 0 of the 68 proven rows). So a
-- genuinely expensive listing is spared automatically. Exactly one row qualifies today and is
-- deliberately left alone: id 1196569, price 200,000,000 EXACTLY (round), 2,950 m² Building, full
-- 2,032-char capture, parser agrees — a real 200M property. That single exclusion is also the proof
-- that the valve works rather than being decorative.
--
-- EVIDENCE TIERS INSIDE THE 451, stated honestly:
--   * 102 rows — PER-ROW PROVEN: the immune parser reads a DIFFERENT price from the same capture, so
--     the stored figure contradicts the row's own evidence.
--   * 349 rows — POPULATION-PROVEN ONLY: their captures are truncated stubs (avg 298 chars) that yield
--     no price either way, so nothing is provable per row. They are included on the band evidence
--     above. Expected number of genuinely-priced rows in a 1.1M window, extrapolating the neighbouring
--     bands' density (37 rows over ~700M): ~0.06.
--   * 435 of 451 additionally carry price_per_meter == round(price/area) — ppm derived from the
--     fabricated price, doubling the error on the card.
--
-- WHY NULLING IS THE RIGHT RISK. NULL is self-healing: trg_aqar_parse assigns only on a NON-NULL
-- parse, so the next fresh capture refills a real price and a NULL can never become garbage. The cost
-- of being wrong on a row is therefore a temporarily missing price on at most ~1 listing, which
-- repairs itself. The cost of doing nothing is 451 listings advertising ~200 million SAR and
-- distorting price sort/filter on every Buy search. No value is invented anywhere.
--
-- Scope: residential Buy only — aqar_commercial Buy and residential Rent are both 0 in this band.
-- Fails CLOSED on any count drift.

do $$
declare
  n_expected constant int := 451;
  n_gate int;
  n_upd  int;
begin
  select count(*) into n_gate
    from public.aqar_residential_listings
   where active and transaction_type = 'Buy'
     and price_total >= 200000000 and price_total < 201100000
     and nullif(btrim(public.aqar_parse(source_capture->>'source_text')->>'price'),'')::numeric
         is distinct from price_total;

  if n_gate <> n_expected then
    raise exception 'aqar frozen-band gate matched % rows, expected % — aborting rather than nulling '
                    'an unverified set', n_gate, n_expected;
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
     and a.price_total >= 200000000 and a.price_total < 201100000
     and nullif(btrim(public.aqar_parse(a.source_capture->>'source_text')->>'price'),'')::numeric
         is distinct from a.price_total;

  get diagnostics n_upd = row_count;
  if n_upd <> n_expected then
    raise exception 'aqar frozen-band repair updated % rows, expected % — rolling back', n_upd, n_expected;
  end if;

  raise notice 'aqar licence-price frozen band: % row(s) nulled (price + derived ppm); the 1 '
               'parser-confirmed 200M listing was spared', n_upd;
end $$;
