-- THE AI READER FALLING BEHIND IS LOUD, NOT QUIET (owner 2026-11-03: «we never have to have this … make sure that we never
-- get this issue»). ai_facts_new_ads_unread (check 8 of mon_detect_text_facts, migration 20261030061800) fired on 11-01
-- as a P2 routed to 🔧 and sat open three days while the nightly AI run was cancelled at its 300-min timeout every
-- night (wasalt 1,726 unread, aqar 516, dealapp 460 …). It now raises P1 when any table holds >= 500 unread new ads (a
-- whole night's worth on a big site), P2 below that — mon_raise escalates an open P2 key to P1. The run itself also
-- reports a failed OR cancelled lane as P1 (facts-extract.yml bridge, PR #10287).
set local lock_timeout = '5s';

do $patch$
declare d text; k int;
  old_call constant text := $o$public.mon_raise('P2', 'ai_facts_new_ads_unread', 'all', 'ai_facts_new_ads_unread',$o$;
  new_call constant text := $n$public.mon_raise(case when exists (select 1 from public.ops_ai_facts_unread_new() g2 where g2.unread >= 500)
                                then 'P1' else 'P2' end, 'ai_facts_new_ads_unread', 'all', 'ai_facts_new_ads_unread',$n$;
begin
  select pg_get_functiondef('public.mon_detect_text_facts()'::regprocedure) into d;
  if position('g2.unread >= 500' in d) > 0 then
    raise notice 'mon_detect_text_facts already escalates ai_facts_new_ads_unread';
    return;
  end if;
  k := (length(d) - length(replace(d, old_call, ''))) / length(old_call);
  if k <> 1 then raise exception 'mon_detect_text_facts: the ai_facts_new_ads_unread raise found % times, want 1', k; end if;
  execute replace(d, old_call, new_call);
end $patch$;

-- PROOF at apply: the function carries the escalation and still runs.
do $$ begin
  if position('g2.unread >= 500' in pg_get_functiondef('public.mon_detect_text_facts()'::regprocedure)) = 0 then
    raise exception 'PROOF: the escalation is not in mon_detect_text_facts';
  end if;
end $$;