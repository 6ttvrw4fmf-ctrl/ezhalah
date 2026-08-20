-- An UPDATE's target relation cannot be the left side of a LATERAL in its own FROM list; carry the
-- search parameters through the pick CTE and join the oracle to that instead.
create or replace function public.ops_qa_adjudicate(p_limit int default 60, p_date date default current_date)
returns table(done int, still_pending int) language plpgsql as $$
declare v_done int;
begin
  with pick as (
    select * from public.ops_qa_search_run
     where run_date = p_date and verdict is null
     order by rpc_total asc limit p_limit
  ), scored as (
    select p.sid, d.n, d.h,
           case when p.rpc_total <> d.n then 'COUNT_MISMATCH'
                when p.full_cmp and coalesce(p.rpc_hash,'') is distinct from coalesce(d.h,'') then 'SET_MISMATCH'
                when p.full_cmp then 'EXACT_SET_MATCH'
                else 'COUNT_MATCH_PAGE_CAPPED' end as verdict
    from pick p, lateral public.ops_qa_diff(p.ui_type, p.deal, p.period, p.cities, p.districts,
           p.region_ids, p.area_min, p.area_max, p.beds, p.beds_min, p.price_min, p.price_max) d
  ), upd as (
    update public.ops_qa_search_run r
       set sql_total = s.n, sql_hash = s.h, verdict = s.verdict
      from scored s
     where r.run_date = p_date and r.sid = s.sid
    returning 1
  ) select count(*)::int into v_done from upd;
  return query select v_done, (select count(*)::int from public.ops_qa_search_run where run_date=p_date and verdict is null);
end $$;
