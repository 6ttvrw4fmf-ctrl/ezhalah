-- Only the SOURCE may blank a known price — and 225 aqar rows were waiting on that (senior run #35).
--
-- Owner decision 2026-08-22, approving the systemic half of 20260822063503 (which retracted ONE
-- proven row). db._unknown_must_not_overwrite_known() could not tell three situations apart:
--
--   1. AUTHORITATIVE ABSENCE  the source states there is no value.   -> may write NULL
--   2. READ FAILURE           fetch blocked / parse failed.          -> must KEEP the stored value
--   3. INCONCLUSIVE           payload unreadable or key absent.      -> must KEEP the stored value
--
-- All three produced None, None was dropped, so the «طلب تسويق» rule could never take effect on a
-- listing that had ever carried a price. The code half ships in the same PR: db.AUTHORITATIVE_NULL
-- (a sentinel no accidental path can produce) plus price_evidence.authoritative_absent, both
-- mutation-proven by scripts/verify-authoritative-null-price.ts in npm test.
--
-- THE CLASSIFICATION, MEASURED NOT ASSUMED. All 443 remaining rows with
-- price_evidence.stored IS NULL and a stored price were re-probed live against aqar, replicating
-- _structured_price() exactly (3 attempts each; a non-200, a missing listing object or a missing
-- price key can only ever produce INCONCLUSIVE, never authoritative — retries can move a row OUT
-- of authoritative, never into it):
--
--   AUTHORITATIVE NULL   225   (106 published:false, 119 price key present and non-numeric)
--   KNOWN PRICE          218   (the source publishes a price -> PROTECTED, not touched here)
--   INCONCLUSIVE           0
--
-- Independent cross-check: all 225 authoritative rows render price_text «طلب تسويق», and NOT ONE of
-- them contains a digit in that slot. 0/225 ambiguity.
--
-- The 218 known-price rows are deliberately left alone. 62 of them differ from stored by exactly 1
-- (the oracle truncates a fractional source price where the stored value was rounded) and 5 differ
-- materially because the seller changed the price since our last successful read (all Rent:
-- 1520 27000->38000, 211320 36000->32400, 70401 23000->25000, 119774 19000->17000, 2297 2300->2000).
-- Those are STALE, not wrong-by-fabrication; the enricher corrects them on its next pass. Blanking
-- them would be the exact error this whole change exists to prevent.
--
-- Retracts price_total for Buy and price_annual for Rent. price_per_meter is NEVER touched:
-- «سعر المتر» is its own published field, and aqar not publishing a TOTAL says nothing about it.

create table if not exists public.ops_authoritative_null_price (
  source_table   text        not null,
  listing_id     bigint      not null,
  column_blanked text        not null,
  price_before   bigint,
  reason         text        not null,
  evidence       text        not null,
  decided_at     timestamptz not null default now(),
  primary key (source_table, listing_id, column_blanked)
);

comment on table public.ops_authoritative_null_price is
  'Ledger of prices blanked because the SOURCE stated there is none (not because a fetch failed). '
  'Written by evidence-backed repairs and readable by mon_detect_price_blanked_without_authority, '
  'which treats a price that went NULL without an entry here (or an authoritative_absent capture) '
  'as a P1.';

do $$
declare
  v_buy  bigint[] := array[
    11453,11487,12333,12522,20254,21491,21505,21519,21654,22789,23015,31506,41696,41734,41783,
    47741,66764,74515,74551,74678,75371,75438,77380,78128,78153,79411,79508,81053,81076,81085,
    83750,83773,83801,83811,83813,83845,83919,84254,84327,84415,84504,84509,86125,91414,91500,
    91610,91675,91702,91711,91853,91874,91883,91908,92609,92633,95500,97063,108623,110209,112069,
    113289,114199,117724,118263,123159,123874,128303,129049,130051,134798,137141,137224,137303,152304,155124,
    155195,155307,164306,167451,173113,188531,188547,188554,188640,188865,188942,188992,189130,213312,218627,
    232974,237459,237501,237512,241495,251581,251588,326795,352463,352476,357225,773613,1341090,1367202,1375187,
    1376070,6963176,6982362,7018581,7110732
  ];
  v_rent bigint[] := array[
    59,978,986,1084,1089,1140,1214,1495,1523,1546,1603,1606,2294,2295,9126,
    9192,14535,14537,14541,14881,14893,14911,14937,15010,15044,15048,15052,15076,15077,15165,
    15283,17337,17344,17346,23272,23276,23596,23893,24052,24319,24358,24362,24405,24423,24470,
    25901,29784,30139,30697,31686,31756,36593,45491,47875,50063,62127,62345,62525,63654,65218,
    65709,66022,66248,66454,66685,67129,67359,67417,67483,67528,67562,68095,68608,69036,69112,
    69200,70660,71549,71702,72068,72320,72435,80726,80935,115005,115028,115077,118901,119075,119113,
    119127,119954,120844,120857,179786,1332731,1332737,1918069,2250703,5762459,5963785,6954397,6959602,6960822,6960841,
    6970027,6978355,6983704,6983915,6984159,6998562,6998802,7014653,7373960,7616125
  ];
  -- CONTROL: 40 of the 218 rows the same probe proved the source still prices. If a single one of
  -- these loses its price, the repair was not targeted and the whole transaction is rolled back.
  v_ctrl bigint[] := array[
    1306,1520,1548,1605,1679,1994,2055,2124,2297,2321,2377,11051,12601,13991,14887,
    15562,21712,21877,21992,22168,22178,22257,22292,22294,22353,22427,22564,22727,22734,22741,
    22806,22836,22864,24249,42452,42836,43080,43142,45297,45530
  ];
  v_ctrl_before bigint;
  v_ctrl_after  bigint;
  v_n_buy int;
  v_n_rent int;
begin
  if cardinality(v_buy) <> 110 or cardinality(v_rent) <> 115 then
    raise exception 'expected 110 Buy + 115 Rent authoritative rows, got % + %',
      cardinality(v_buy), cardinality(v_rent);
  end if;

  select count(*) into v_ctrl_before
    from public.aqar_residential_listings
   where id = any(v_ctrl) and (price_total is not null or price_annual is not null);

  -- Ledger first, so the evidence exists even if a later assertion aborts the write.
  insert into public.ops_authoritative_null_price
    (source_table, listing_id, column_blanked, price_before, reason, evidence)
  select 'aqar_residential_listings', id, 'price_total', price_total, 'source_states_no_price',
         'senior run #35, live re-probe 2026-08-22: aqar payload for ad ' || ad_number ||
         ' settled the price question as ABSENT (published:false, or a price key present and '
         'non-numeric) and the price slot rendered «طلب تسويق». _structured_price() returns '
         '(None, authoritative=True) for this shape, so the stored figure is one the source does '
         'not publish.'
    from public.aqar_residential_listings
   where id = any(v_buy) and price_total is not null
  on conflict do nothing;

  insert into public.ops_authoritative_null_price
    (source_table, listing_id, column_blanked, price_before, reason, evidence)
  select 'aqar_residential_listings', id, 'price_annual', price_annual, 'source_states_no_price',
         'senior run #35, live re-probe 2026-08-22: aqar payload for ad ' || ad_number ||
         ' settled the price question as ABSENT (published:false, or a price key present and '
         'non-numeric) and the price slot rendered «طلب تسويق». _structured_price() returns '
         '(None, authoritative=True) for this shape, so the stored figure is one the source does '
         'not publish.'
    from public.aqar_residential_listings
   where id = any(v_rent) and price_annual is not null
  on conflict do nothing;

  update public.aqar_residential_listings set price_total = null
   where id = any(v_buy) and price_total is not null;
  get diagnostics v_n_buy = row_count;

  update public.aqar_residential_listings set price_annual = null
   where id = any(v_rent) and price_annual is not null;
  get diagnostics v_n_rent = row_count;

  raise notice 'authoritative blanking: % Buy price_total, % Rent price_annual', v_n_buy, v_n_rent;

  -- The controls must be untouched.
  select count(*) into v_ctrl_after
    from public.aqar_residential_listings
   where id = any(v_ctrl) and (price_total is not null or price_annual is not null);
  if v_ctrl_after <> v_ctrl_before then
    raise exception 'CONTROL VIOLATED: % of the source-priced control rows lost their price',
      v_ctrl_before - v_ctrl_after;
  end if;

  -- Every row we blanked must have a ledger entry, or the repair is unauditable.
  if (select count(*) from public.ops_authoritative_null_price
       where source_table = 'aqar_residential_listings') < (v_n_buy + v_n_rent) then
    raise exception 'ledger is smaller than the number of rows blanked';
  end if;
end $$;
