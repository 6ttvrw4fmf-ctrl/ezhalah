-- A DIFFERENTIAL VERDICT IS ONLY MEANINGFUL WHEN BOTH SIDES SAW THE SAME INVENTORY.
--
-- FOUND 2026-09-03 (SEARCH_MATCH_QA_ENGINEER.md routine #4, daily heartbeat).
-- ops_qa_search_run stores the RPC's count+hash as captured by the harness at time T.
-- ops_qa_adjudicate compares that stored snapshot against ops_qa_diff evaluated at time T+N.
-- search_listings_ar is LIVE: sync-search-listings-ar runs at :14 every hour and liveness
-- deactivations remove rows continuously. So any elapsed time between capture and adjudication
-- manufactures COUNT_MISMATCH / SET_MISMATCH verdicts out of nothing.
--
-- MEASURED, on 2026-09-03's ledger: 318 COUNT_MISMATCH + 11 SET_MISMATCH out of 3,994 rows.
-- Every one investigated was an artifact, and production was exact on both of its layers:
--   * the 11 SET_MISMATCH rows ALL had rpc_total = sql_total (58/58, 50/50, 418/418, 2682/2682) --
--     equal cardinality, different membership, i.e. the set churned between the two reads;
--   * re-measured SAME-INSTANT via ops_nf_cert_cell, 7 of those cohorts returned
--     missing = 0 and extra = 0 (الخفجي أرض صناعية 58, الرس فيلا 25, عفيف فيلا 15, عفيف فيلا
--     area>=200 15, الخبر شقة حي التعاون 50, المدينة المنورة شقة سنوي 348, الدمام محل كلاهما 144);
--   * the largest COUNT_MISMATCH, شقة/إيجار/سنوي/region 5, re-measured 4573 = 4573 missing/extra 0,
--     which is EXACTLY the sql_total the adjudicator had recorded;
--   * and the clincher, one search adjudicated twice: sid r200004 read RPC 12680 / oracle 12636,
--     then sid r300004 read RPC 12636 / oracle 12559. The later RPC equals the earlier oracle to the
--     row. The two implementations agree; they were simply read at different instants.
-- Deltas were small and directional (avg 5.14 rows, 257/318 within 5, RPC higher in 252 of 318) --
-- the signature of an index shrinking under the run, not of a predicate disagreeing.
--
-- WHY THIS IS A DEFECT AND NOT COSMETIC. SEARCH_MATCH_QA_ENGINEER.md §40.7 forbids reporting a
-- harness failure as a product failure, and these verdicts are exactly that, sitting in the
-- permanent certification evidence ledger where a later run reads `COUNT_MISMATCH: 318` and
-- concludes the Normal Filter is losing rows. The worse direction is that a REAL matching defect of
-- small magnitude is now indistinguishable from this noise floor: the barrier has stopped being able
-- to discriminate, which is how nine dark detectors once read as a clean bill of health (AGENTS.md).
--
-- THE FIX, and what it deliberately does NOT do. The gate reclassifies ONLY a verdict that would
-- already have been COUNT_MISMATCH or SET_MISMATCH, and ONLY when the index provably moved between
-- load and adjudication. It can never turn a mismatch into a PASS: the honest third state is
-- INDEX_MOVED -- uncomparable, neither pass nor defect -- which is the same refusal-rather-than-guess
-- discipline the live sweep's dbSkipped already uses (§41.15). When no watermark is present (rows
-- loaded before this migration) skew CANNOT be proven, so the strict verdict STANDS. Never silence
-- what you cannot explain.

alter table public.ops_qa_search_run
  add column if not exists index_rows_at_load        bigint,
  add column if not exists index_max_updated_at_load timestamptz;

comment on column public.ops_qa_search_run.index_rows_at_load is
  'search_listings_ar row count when this run was loaded. With index_max_updated_at_load it forms '
  'the watermark that lets ops_qa_adjudicate tell a real predicate disagreement from a comparison '
  'made across a moved index. NULL = loaded before the watermark existed; the strict verdict stands.';

-- A count alone cannot see a BALANCED add+delete (the 11 SET_MISMATCH rows were exactly that shape:
-- cardinality equal, membership changed). Pairing it with max(last_updated) closes that hole --
-- an inserted or re-synced row necessarily carries a newer last_updated.
create or replace function public.ops_qa_index_watermark(
  out rows_now bigint, out max_updated_now timestamptz)
language sql stable as $$
  select count(*)::bigint, max(last_updated) from public.search_listings_ar;
$$;

comment on function public.ops_qa_index_watermark() is
  'The (row count, max last_updated) pair identifying the searchable inventory at this instant.';

-- Pure, IMMUTABLE, scalar-only: no data access, so the decision table is testable in isolation and
-- the mutation proof below is meaningful.
create or replace function public.ops_qa_verdict_skew_aware(
  p_rpc_total bigint, p_rpc_hash text, p_full_cmp boolean,
  p_sql_n bigint, p_sql_h text,
  p_rows_at_load bigint, p_max_upd_at_load timestamptz,
  p_rows_now bigint, p_max_upd_now timestamptz)
returns text language sql immutable as $$
  select case
    -- ARM 1 -- anything that is not already a mismatch is returned untouched. The gate is
    -- incapable of downgrading a passing verdict or of inventing one.
    when public.ops_qa_verdict(p_rpc_total, p_rpc_hash, p_full_cmp, p_sql_n, p_sql_h)
         not in ('COUNT_MISMATCH', 'SET_MISMATCH')
      then public.ops_qa_verdict(p_rpc_total, p_rpc_hash, p_full_cmp, p_sql_n, p_sql_h)
    -- ARM 2 -- no watermark: skew is UNPROVEN, so the mismatch stands. This arm is what stops the
    -- gate becoming a blanket amnesty for every historical row.
    when p_rows_at_load is null
      then public.ops_qa_verdict(p_rpc_total, p_rpc_hash, p_full_cmp, p_sql_n, p_sql_h)
    -- ARM 3 -- watermark present and the inventory did NOT move: both sides read the same rows, so
    -- the disagreement is REAL and must survive. This is the arm that keeps the barrier a barrier.
    when p_rows_at_load = p_rows_now
     and p_max_upd_at_load is not distinct from p_max_upd_now
      then public.ops_qa_verdict(p_rpc_total, p_rpc_hash, p_full_cmp, p_sql_n, p_sql_h)
    -- ARM 4 -- watermark present and the inventory MOVED: the snapshot and the oracle answered
    -- questions about different inventories. Uncomparable. Not a pass, not a defect.
    else 'INDEX_MOVED'
  end;
$$;

comment on function public.ops_qa_verdict_skew_aware(bigint,text,boolean,bigint,text,bigint,timestamptz,bigint,timestamptz) is
  'ops_qa_verdict plus a staleness gate. Only ever rewrites COUNT_MISMATCH/SET_MISMATCH, only when '
  'the index provably moved since load, and only to INDEX_MOVED (uncomparable) -- never to a pass.';

create or replace function public.ops_qa_load_run(p_blob text, p_date date DEFAULT CURRENT_DATE)
 returns integer
 language plpgsql
as $function$
declare v_n int; v_rows bigint; v_upd timestamptz;
begin
  -- Stamped ONCE, at load, so every row of this run shares one honest watermark.
  select w.rows_now, w.max_updated_now into v_rows, v_upd from public.ops_qa_index_watermark() w;

  with l as (select unnest(string_to_array(p_blob, E'\n')) ln),
  f as (select string_to_array(ln,'|') a from l where ln <> '')
  insert into public.ops_qa_search_run
    (run_date,sid,tag,ui_type,deal,period,cities,districts,region_ids,area_min,area_max,
     beds,beds_min,price_min,price_max,rpc_total,rpc_hash,rpc_rows,latency_ms,full_cmp,
     index_rows_at_load,index_max_updated_at_load)
  select p_date, a[1], a[17], a[5], nullif(a[6],''), nullif(a[7],''),
         case when a[8]='' then null else string_to_array(a[8],'~') end,
         case when a[9]='' then null else string_to_array(a[9],'~') end,
         case when a[10]='' then null else string_to_array(a[10],'~')::int[] end,
         nullif(a[11],'')::int, nullif(a[12],'')::int,
         case when a[13]='' then null else string_to_array(a[13],'~')::int[] end,
         nullif(a[14],'')::int, nullif(a[15],'')::numeric, nullif(a[16],'')::numeric,
         a[2]::bigint, nullif(a[3],''), a[18]::int, a[19]::int, a[4]='t',
         v_rows, v_upd
  from f
  on conflict (run_date,sid) do update set
    rpc_total=excluded.rpc_total, rpc_hash=excluded.rpc_hash, rpc_rows=excluded.rpc_rows,
    latency_ms=excluded.latency_ms, full_cmp=excluded.full_cmp,
    index_rows_at_load=excluded.index_rows_at_load,
    index_max_updated_at_load=excluded.index_max_updated_at_load,
    sql_total=null, sql_hash=null, verdict=null;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

create or replace function public.ops_qa_adjudicate(p_limit integer DEFAULT 60, p_date date DEFAULT CURRENT_DATE)
 returns TABLE(done integer, still_pending integer)
 language plpgsql
as $function$
declare v_done int; v_rows bigint; v_upd timestamptz;
begin
  -- Read ONCE per call, so every row in this batch is judged against one consistent "now".
  select w.rows_now, w.max_updated_now into v_rows, v_upd from public.ops_qa_index_watermark() w;

  with pick as (
    select * from public.ops_qa_search_run
     where run_date = p_date and verdict is null
     order by rpc_total asc limit p_limit
  ), scored as (
    select p.sid, d.n, d.h,
           public.ops_qa_verdict_skew_aware(p.rpc_total, p.rpc_hash, p.full_cmp, d.n, d.h,
             p.index_rows_at_load, p.index_max_updated_at_load, v_rows, v_upd) as verdict
    from pick p, lateral public.ops_qa_diff(p.ui_type, p.deal, p.period, p.cities, p.districts,
           p.region_ids, p.area_min, p.area_max, p.beds, p.beds_min, p.price_min, p.price_max) d
  ), upd as (
    update public.ops_qa_search_run r
       set sql_total = s.n, sql_hash = s.h, verdict = s.verdict
      from scored s
     where r.run_date = p_date and r.sid = s.sid
    returning 1
  ) select count(*)::int into v_done from upd;
  return query select v_done,
    (select count(*)::int from public.ops_qa_search_run where run_date=p_date and verdict is null);
end $function$;
