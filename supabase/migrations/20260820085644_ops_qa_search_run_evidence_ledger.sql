-- Per-search evidence ledger for the Search & Matching QA engineer (§40.7): one row per production
-- search actually fired, carrying the intended search, the RPC's answer (count + md5 of its returned
-- id-set), and the independent SQL oracle's answer, so the differential is auditable after the run
-- rather than living only in a transcript.
create table if not exists public.ops_qa_search_run (
  run_date     date        not null default current_date,
  sid          text        not null,
  tag          text,
  ui_type      text,
  deal         text,
  period       text,
  cities       text[],
  districts    text[],
  region_ids   int[],
  area_min     int, area_max int,
  beds         int[], beds_min int,
  price_min    numeric, price_max numeric,
  rpc_total    bigint,
  rpc_hash     text,
  rpc_rows     int,
  latency_ms   int,
  full_cmp     boolean,
  sql_total    bigint,
  sql_hash     text,
  verdict      text,
  primary key (run_date, sid)
);
create index if not exists ops_qa_search_run_date_idx on public.ops_qa_search_run(run_date);

-- Loader: parses the harness's compact pipe-delimited blob (one line per search) into the ledger.
create or replace function public.ops_qa_load_run(p_blob text, p_date date default current_date)
returns int language plpgsql as $$
declare v_n int;
begin
  with l as (select unnest(string_to_array(p_blob, E'\n')) ln),
  f as (select string_to_array(ln,'|') a from l where ln <> '')
  insert into public.ops_qa_search_run
    (run_date,sid,tag,ui_type,deal,period,cities,districts,region_ids,area_min,area_max,
     beds,beds_min,price_min,price_max,rpc_total,rpc_hash,rpc_rows,latency_ms,full_cmp)
  select p_date, a[1], a[17], a[5], nullif(a[6],''), nullif(a[7],''),
         case when a[8]='' then null else string_to_array(a[8],'~') end,
         case when a[9]='' then null else string_to_array(a[9],'~') end,
         case when a[10]='' then null else string_to_array(a[10],'~')::int[] end,
         nullif(a[11],'')::int, nullif(a[12],'')::int,
         case when a[13]='' then null else string_to_array(a[13],'~')::int[] end,
         nullif(a[14],'')::int, nullif(a[15],'')::numeric, nullif(a[16],'')::numeric,
         a[2]::bigint, nullif(a[3],''), a[18]::int, a[19]::int, a[4]='t'
  from f
  on conflict (run_date,sid) do update set
    rpc_total=excluded.rpc_total, rpc_hash=excluded.rpc_hash, rpc_rows=excluded.rpc_rows,
    latency_ms=excluded.latency_ms, full_cmp=excluded.full_cmp,
    sql_total=null, sql_hash=null, verdict=null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Adjudicator: runs the independent oracle for the ledger rows that have no verdict yet, in bounded
-- batches so a large run never trips a statement/tool timeout.
create or replace function public.ops_qa_adjudicate(p_limit int default 60, p_date date default current_date)
returns table(done int, still_pending int) language plpgsql as $$
declare v_done int;
begin
  with pick as (
    select sid from public.ops_qa_search_run
     where run_date = p_date and verdict is null
     order by rpc_total asc limit p_limit
  ), upd as (
    update public.ops_qa_search_run r set
      sql_total = d.n, sql_hash = d.h,
      verdict = case when r.rpc_total <> d.n then 'COUNT_MISMATCH'
                     when r.full_cmp and coalesce(r.rpc_hash,'') is distinct from coalesce(d.h,'') then 'SET_MISMATCH'
                     when r.full_cmp then 'EXACT_SET_MATCH'
                     else 'COUNT_MATCH_PAGE_CAPPED' end
    from pick p, lateral public.ops_qa_diff(r.ui_type, r.deal, r.period, r.cities, r.districts,
           r.region_ids, r.area_min, r.area_max, r.beds, r.beds_min, r.price_min, r.price_max) d
    where r.run_date = p_date and r.sid = p.sid
    returning 1
  ) select count(*)::int into v_done from upd;
  return query select v_done, (select count(*)::int from public.ops_qa_search_run where run_date=p_date and verdict is null);
end $$;
