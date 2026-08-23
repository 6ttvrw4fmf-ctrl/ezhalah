-- QA differential adjudicator: an honest zero is a MATCH, whatever empty-set sentinel the
-- harness sends.
--
-- Found by the daily Search & Matching QA run (2026-08-23). Three deliberate zero-result
-- searches (مصنع/سكن عمال/أرض صناعية, إيجار شهري, الرياض) came back rpc_total=0 AND
-- sql_total=0 — the RPC and the independent oracle agreed exactly, i.e. a textbook §13
-- HONEST ZERO — yet ops_qa_adjudicate stamped all three SET_MISMATCH, the single most
-- alarming verdict the ledger can produce.
--
-- Root cause: the two sides use different sentinels for the hash of the EMPTY set.
-- ops_qa_diff aggregates to NULL when it matches nothing; a client naturally reports
-- md5('') = d41d8cd98f00b204e9800998ecf8427e. The old rule compared
-- coalesce(rpc_hash,'') to coalesce(h,''), so '' and NULL happened to agree while md5('')
-- did not. The 78 zero-rows already in the ledger read EXACT_SET_MATCH only because
-- earlier harnesses happened to send ''/NULL — the verdict depended on the CLIENT'S
-- SERIALISATION CONVENTION rather than on the data, which is a barrier that will
-- eventually lie, in either direction.
--
-- The fix is provably narrow: the count comparison is evaluated FIRST, so by the time the
-- hash is examined rpc_total = n is already established. When that agreed count is 0, both
-- sides are empty and the sets are identical by construction — no hash can add information.
-- Every genuine-defect case (SET_MISMATCH at n>0, COUNT_MISMATCH, page-capped) is untouched;
-- mon_detect_qa_adjudicator_zero_contract below proves BOTH directions on every sweep.

-- 1. ONE source of the classification rule, so the adjudicator and its detector cannot drift.
create or replace function public.ops_qa_verdict(
  p_rpc_total bigint, p_rpc_hash text, p_full_cmp boolean, p_sql_n bigint, p_sql_h text)
returns text
language sql immutable
as $function$
  select case
    when p_rpc_total is distinct from p_sql_n then 'COUNT_MISMATCH'
    -- counts already proven equal above; equal AND zero ⇒ both sets empty ⇒ identical.
    when p_full_cmp and coalesce(p_sql_n, 0) = 0 then 'EXACT_SET_MATCH'
    when p_full_cmp and coalesce(p_rpc_hash,'') is distinct from coalesce(p_sql_h,'')
      then 'SET_MISMATCH'
    when p_full_cmp then 'EXACT_SET_MATCH'
    else 'COUNT_MATCH_PAGE_CAPPED'
  end;
$function$;

comment on function public.ops_qa_verdict(bigint,text,boolean,bigint,text) is
  'Canonical §40.5 differential verdict. Used by ops_qa_adjudicate AND mutation-proven by '
  'mon_detect_qa_adjudicator_zero_contract so the two can never diverge.';

-- 2. The adjudicator now delegates. Signature and return type are unchanged (no new overload).
create or replace function public.ops_qa_adjudicate(
  p_limit integer default 60, p_date date default current_date)
returns table(done integer, still_pending integer)
language plpgsql
as $function$
declare v_done int;
begin
  with pick as (
    select * from public.ops_qa_search_run
     where run_date = p_date and verdict is null
     order by rpc_total asc limit p_limit
  ), scored as (
    select p.sid, d.n, d.h,
           public.ops_qa_verdict(p.rpc_total, p.rpc_hash, p.full_cmp, d.n, d.h) as verdict
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

-- 3. The barrier. Proves BOTH directions every sweep: empty-set sentinels must all read as a
--    match, AND every genuine-defect verdict must still fire (a fix that blinds SET_MISMATCH
--    would be far worse than the false positive it replaced).
create or replace function public.mon_detect_qa_adjudicator_zero_contract()
returns integer
language plpgsql
as $function$
declare
  v_fail text[] := '{}';
  v_live int;
  v_raised int := 0;
begin
  -- direction A: an empty set is a MATCH regardless of which sentinel the client sends.
  if public.ops_qa_verdict(0, md5(''), true, 0, null) <> 'EXACT_SET_MATCH'
    then v_fail := v_fail || 'empty_sentinel_md5_empty'; end if;
  if public.ops_qa_verdict(0, '', true, 0, null) <> 'EXACT_SET_MATCH'
    then v_fail := v_fail || 'empty_sentinel_blank'; end if;
  if public.ops_qa_verdict(0, null, true, 0, null) <> 'EXACT_SET_MATCH'
    then v_fail := v_fail || 'empty_sentinel_null'; end if;
  if public.ops_qa_verdict(0, 'anything', true, 0, null) <> 'EXACT_SET_MATCH'
    then v_fail := v_fail || 'empty_sentinel_arbitrary'; end if;

  -- direction B: the fix must NOT blind any genuine defect.
  if public.ops_qa_verdict(5,'aaa',true,5,'bbb') <> 'SET_MISMATCH'
    then v_fail := v_fail || 'blinded_set_mismatch'; end if;
  if public.ops_qa_verdict(5,'aaa',true,6,'bbb') <> 'COUNT_MISMATCH'
    then v_fail := v_fail || 'blinded_count_mismatch'; end if;
  if public.ops_qa_verdict(0,md5(''),true,7,'bbb') <> 'COUNT_MISMATCH'
    then v_fail := v_fail || 'blinded_count_mismatch_zero_side'; end if;
  if public.ops_qa_verdict(5,'aaa',true,5,'aaa') <> 'EXACT_SET_MATCH'
    then v_fail := v_fail || 'true_match_broken'; end if;
  if public.ops_qa_verdict(5000,'aaa',false,5000,'bbb') <> 'COUNT_MATCH_PAGE_CAPPED'
    then v_fail := v_fail || 'page_capped_broken'; end if;

  -- direction C: the live ledger must carry no honest zero stamped as a set mismatch.
  select count(*) into v_live
    from public.ops_qa_search_run
   where verdict = 'SET_MISMATCH' and rpc_total = 0 and sql_total = 0;

  if array_length(v_fail,1) > 0 or v_live > 0 then
    v_raised := public.mon_raise('P2', 'qa_adjudicator_contract', 'all',
      'qa_adjudicator_zero_contract',
      jsonb_build_object(
        'why', 'The §40.5 differential verdict must be a property of the DATA, not of the '
            || 'empty-set sentinel the harness happens to send. A zero-result search where '
            || 'rpc_total = sql_total = 0 is an HONEST ZERO (§13) and must read EXACT_SET_MATCH.',
        'truth_table_failures', to_jsonb(v_fail),
        'live_honest_zeros_stamped_set_mismatch', v_live,
        'action', 'Fix public.ops_qa_verdict — do NOT silence this by loosening SET_MISMATCH. '
               || 'Directions A and B are both asserted here precisely so a fix that blinds a '
               || 'genuine mismatch fails just as loudly as the false positive it replaced.'));
  else
    perform public.mon_resolve_key('qa_adjudicator_contract', 'qa_adjudicator_zero_contract');
  end if;
  return v_raised;
end $function$;

-- 4. Roster wiring, in the SAME migration (AGENTS.md): a detector nothing reaches is
--    decoration. Guarded needle-splice rather than a hand-copied full body — re-pasting the
--    whole function from a stale base is what caused four recorded roster losses, and would
--    silently drop any detector a concurrent session added minutes ago (§38).
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_qa_adjudicator_zero_contract''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;
  if position('mon_detect_qa_adjudicator_zero_contract' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install',
      before_n, after_n;
  end if;
  if position('mon_detect_qa_adjudicator_zero_contract' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_card_label_contract' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0
     or position('mon_detect_detector_sweep_budget' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;
  execute src;
end
$do$;
