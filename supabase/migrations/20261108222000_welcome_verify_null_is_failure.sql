-- 🔧 2026-11-08 (CodeRabbit Major on #11363): in verify_welcome_insights() a NULL comparison (e.g. a fact whose a is
-- NULL: `c = r.a`, `c >= r.a`) left ok NULL, and `if not ok` treats NULL as "not failed", so such a fact was KEPT
-- without a reproduced number. NULL is failure: hide it like any other fact the customer's search cannot reproduce.
do $m$
declare v text; n text;
begin
  v := pg_get_functiondef('public.verify_welcome_insights()'::regprocedure);
  if (length(v) - length(replace(v, '    if not ok then', ''))) / length('    if not ok then') <> 1 then
    raise exception 'verify_welcome_insights: expected «if not ok then» exactly once';
  end if;
  n := replace(v, '    if not ok then', '    if ok is not true then');
  execute n;
end
$m$;
