-- 🔧 2026-11-08: mon_detect_unresolvable_alert_kinds() learns the repeat_bug:* family.
--
-- mon_detect_repeat_bug() (20261108, owner «fix the ROOT so the same bugs stop coming back») raises one alert per
-- repeating dedup key under a DYNAMIC kind, 'repeat_bug:' || r.kind, and closes it itself (its CLOSE-CHECK sets
-- resolved_at = now() on the row it found by id after 48 h without a reopen). The strict resolvability matcher looks
-- for the kind as a LITERAL next to mon_resolve_key / mon_resolve / an inline alert_event write with kind = '<kind>',
-- so a dynamic kind can never match: 27 P2 unresolvable_alert_kind rows opened at 02:59 UTC, one per repeat_bug:* kind,
-- all false. The fix teaches the matcher the family by EXECUTION, not by a list: a kind that starts with repeat_bug:
-- is resolvable only while a public function really builds 'repeat_bug:' || <something> AND really sets resolved_at =
-- now(); remove that close path from mon_detect_repeat_bug() and the 27 come back on the next sweep.
-- Edited in place with replace() (10-30 lesson: no retyping, byte-exact mirror); raises if the anchor is missing.
do $$
declare
  d text;
  anchor text := E'or exists (\n            select 1 from public.ops_alert_kind_external_resolver x where x.kind = c.kind\n          ));';
  addition text := E'or exists (\n            select 1 from public.ops_alert_kind_external_resolver x where x.kind = c.kind\n          )\n'
    || E'       -- the repeat_bug:* family (2026-11-08): a DYNAMIC kind, ''repeat_bug:'' || <source kind>, closed by the\n'
    || E'       -- function that builds it (mon_detect_repeat_bug CLOSE-CHECK: resolved_at = now() by id). Resolvable only\n'
    || E'       -- while such a function exists — proven by its body, never by a list.\n'
    || E'       or (c.kind like ''repeat\\_bug:%'' and exists (\n'
    || E'            select 1 from fns f\n'
    || E'             where f.def ~ ''''''repeat_bug:'''' \\|\\| r\\.kind''\n'
    || E'               and f.def ~ ''resolved_at\\s*=\\s*now\\(\\)''\n'
    || E'          )));';
begin
  select pg_get_functiondef('public.mon_detect_unresolvable_alert_kinds'::regproc) into d;
  if position(anchor in d) = 0 then
    raise exception 'anchor not found in mon_detect_unresolvable_alert_kinds(); body changed — re-read before editing';
  end if;
  d := replace(d, anchor, addition);
  execute d;
end $$;

-- PROOF (pure reads, no listing/ops row written): the family clause matches the live closer, and only it.
do $$
declare
  n_closer int;
  n_meta_before int;
begin
  select count(*) into n_closer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ '''repeat_bug:'' \|\| r\.kind'
     and pg_get_functiondef(p.oid) ~ 'resolved_at\s*=\s*now\(\)';
  if n_closer < 1 then
    raise exception 'no public function builds repeat_bug:<kind> and closes it — the family clause would be a loophole';
  end if;
  select count(*) into n_meta_before from public.alert_event
   where kind = 'unresolvable_alert_kind' and resolved_at is null and detail->>'kind' like 'repeat\_bug:%';
  raise notice 'closer functions: %, repeat_bug meta alerts open before the sweep: %', n_closer, n_meta_before;
end $$;