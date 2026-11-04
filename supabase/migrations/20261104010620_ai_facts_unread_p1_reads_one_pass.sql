-- THE P1 ESCALATION READS THE ONE PASS IT ALREADY HAS (fixes ai_facts_unread_escalates_to_p1). That patch chose P1 with a
-- SECOND call to ops_ai_facts_unread_new() — the exact cost verify-ai-facts-unread-check-stays-cheap.ts forbids,
-- and the second pass is what timed mon-text-facts out on 2026-11-03. The severity now comes from `d`, the
-- detail section 8 already aggregates from its single pass: P1 when any table holds >= 500 unread new ads.
set local lock_timeout = '5s';

do $patch$
declare d text; k int;
  old_expr constant text := $o$exists (select 1 from public.ops_ai_facts_unread_new() g2 where g2.unread >= 500)$o$;
  new_expr constant text := $n$exists (select 1 from jsonb_array_elements(d) g2 where (g2 ->> 'unread')::bigint >= 500)$n$;
begin
  select pg_get_functiondef('public.mon_detect_text_facts()'::regprocedure) into d;
  if position(new_expr in d) > 0 then
    raise notice 'mon_detect_text_facts already reads the severity from its one pass';
    return;
  end if;
  k := (length(d) - length(replace(d, old_expr, ''))) / length(old_expr);
  if k <> 1 then raise exception 'mon_detect_text_facts: the second-pass severity found % times, want 1', k; end if;
  execute replace(d, old_expr, new_expr);
end $patch$;

-- PROOF at apply: one pass only, the single pass statement intact, its detail still feeds the alert, and the P1
-- rule is in place.
do $$
declare def text := pg_get_functiondef('public.mon_detect_text_facts()'::regprocedure);
  c constant text := 'public.ops_ai_facts_unread_new()';
begin
  if (length(def) - length(replace(def, c, ''))) / length(c) <> 1 then
    raise exception 'PROOF: mon_detect_text_facts calls ops_ai_facts_unread_new() % times, want 1',
      (length(def) - length(replace(def, c, ''))) / length(c);
  end if;
  if position($s$into n, d
    from public.ops_ai_facts_unread_new() g$s$ in def) = 0 then
    raise exception 'PROOF: the single pass «into n, d from ops_ai_facts_unread_new() g» is gone';
  end if;
  if position($a$'detail', d,$a$ in def) = 0 then raise exception 'PROOF: the alert no longer carries the one-pass detail'; end if;
  if position($a$(g2 ->> 'unread')::bigint >= 500$a$ in def) = 0 then raise exception 'PROOF: the P1 rule is missing'; end if;
end $$;