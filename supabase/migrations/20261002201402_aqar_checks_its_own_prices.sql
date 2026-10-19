-- AQAR CHECKS ITS OWN PRICES; THE WINDOWED NULL-PRICE CHECK STANDS ASIDE FOR A RUN THAT DID.
-- Owner, 2026-10-02: «fix this» (the aqar check that kept small towns red with correct data).
--
-- Check (a) of mon_check_run_field_ranges compares the null-price rate of "every row of the table
-- touched since this run began" with the table's baseline. On aqar_residential_listings 95 per-city
-- jobs write at the same moment, so a run is judged on its neighbours' rows: Duba's 2-row run
-- (run 57595, 2026-10-02) was judged on 103 rows, 14 of 34 rents priceless — every one of them an Al
-- Baha ad whose source publishes no price (AUTHORITATIVE_NULL in the crawl log). 159 aqar_residential
-- runs went red that way in 14 days, rows_upserted from 0 to 909. The database cannot fix this: the
-- rows carry no run id, and NULL looks the same whether the source said «no price» or a read failed.
--
-- The scraper knows both, so it now runs the check exactly, on its own rows only, counting only
-- prices it could not read (scrapers/aqar/price_tally.py), and marks ITS OWN scrape_runs row
-- 'own_price_check' before calling this function (db.end_run, price_null_checked_by_caller=True).
-- A run carrying that mark skips check (a) and nothing else: (c) tiny claimed rents, (d) placeholder
-- locations and (e) missing critical fields still run on every aqar run. Every other run carries
-- no mark and is judged exactly as before. Same name, same arguments: no second overload.
--
-- The body is patched from the LIVE definition (this function is redefined by many migrations and
-- pasting an older body would revert whoever changed it last).
do $patch$
declare
  src     text;
  patched text;
  old_a   constant text := '  if buy_touched >= 20 or rent_touched >= 20 then';
  new_a   constant text := '  if not exists (select 1 from public.scrape_runs r
                 where r.id = p_run_id and r.notes like ''%own_price_check%'')
     and (buy_touched >= 20 or rent_touched >= 20) then';
  old_c   constant text := '  -- (a) null-price PARSE-REGRESSION check';
  new_c   constant text := '  -- (a) SKIPPED for a run whose own scrape_runs row carries ''own_price_check'' (2026-10-02): the
  -- caller checked its OWN rows and told a source-published «no price» from a failed read — aqar,
  -- whose 95 concurrent city jobs made this windowed slice judge each run on its neighbours'' rows
  -- (scrapers/aqar/price_tally.py).
  -- (a) null-price PARSE-REGRESSION check';
begin
  src := pg_get_functiondef('public.mon_check_run_field_ranges(bigint,text,text,timestamptz,text[])'::regprocedure);

  if position('own_price_check' in src) > 0 then
    raise notice 'check (a) already honours own_price_check — nothing to patch';
    return;
  end if;
  if (length(src) - length(replace(src, old_a, ''))) / length(old_a) <> 1 then
    raise exception 'check (a)''s guard was not found exactly once in the live definition — refusing to guess';
  end if;
  if (length(src) - length(replace(src, old_c, ''))) / length(old_c) <> 1 then
    raise exception 'check (a)''s comment was not found exactly once in the live definition — refusing to guess';
  end if;

  patched := replace(replace(src, old_a, new_a), old_c, new_c);
  execute patched;
end
$patch$;

-- ── check block: one overload, the guard is in place, and the existing self-test still passes ──────
do $check$
declare v text;
begin
  if (select count(*) from pg_proc where proname = 'mon_check_run_field_ranges') <> 1 then
    raise exception 'mon_check_run_field_ranges must have exactly one overload';
  end if;
  if position('own_price_check' in
       pg_get_functiondef('public.mon_check_run_field_ranges(bigint,text,text,timestamptz,text[])'::regprocedure)) = 0 then
    raise exception 'check (a) does not honour own_price_check';
  end if;
  v := public.mon_selftest_rent_tiny_gate();
  if v <> 'PASS' then
    raise exception 'tiny-rent gate selftest broke: %', v;
  end if;
end
$check$;
