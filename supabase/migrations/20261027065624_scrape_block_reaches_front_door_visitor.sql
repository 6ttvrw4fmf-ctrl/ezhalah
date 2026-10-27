-- SECURITY: the scrape alarm counts EACH visitor behind the front door, and its 24 h block reaches them (2026-10-27).
--
-- Before: every front-door visitor reached the API logs under Vercel's few server addresses, so the hourly alarm could
-- not tell one copier from all visitors combined (a stated gap in scripts/lib/scrapeAlarm.ts). Now api/sb.ts stamps a
-- scrambled visitor code «vid=<16 hex>» (HMAC-SHA256 of the address with the front-door secret: never the address
-- itself). The alarm blocks a suspect code as 'vid:<code>' in ops_blocked_ip; robot_gate recomputes the code from the
-- vouched visitor address and refuses it for 24 h like any blocked address. Fail-open: the lookup sits inside
-- robot_gate's existing exception block, so an error lets the caller through.
-- Rollback: delete from public.ops_blocked_ip where ip like 'vid:%';  (instant)
create or replace function guard.visitor_code(p_ip text)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case when coalesce(p_ip, '') = '' then null else
    (select 'vid:' || substr(encode(extensions.hmac(p_ip, s.secret, 'sha256'), 'hex'), 1, 16)
       from guard.front_door_secret s where s.id = 1) end;
$fn$;
revoke all on function guard.visitor_code(text) from public;
grant execute on function guard.visitor_code(text) to anon, authenticated, service_role;

-- Patch the ONE block line in the live robot_gate (never a full rewrite: other sessions edit other parts of it).
do $patch$
declare
  d text; k int;
  old_tail constant text := E'\', 1)));\n      if visitor is not null and';
  new_tail constant text := E'\', 1)))\n        or (visitor is not null and guard.ip_is_blocked(guard.visitor_code(visitor)));\n      if visitor is not null and';
begin
  select pg_get_functiondef('public.robot_gate()'::regprocedure) into d;
  if position('guard.visitor_code' in d) > 0 then raise notice 'robot_gate already honours visitor-code blocks'; return; end if;
  k := (length(d) - length(replace(d, old_tail, ''))) / length(old_tail);
  if k <> 1 then raise exception 'block line found % times, want 1 — read the live robot_gate first', k; end if;
  execute replace(d, old_tail, new_tail);
  if position('guard.visitor_code' in pg_get_functiondef('public.robot_gate()'::regprocedure)) = 0 then
    raise exception 'patch did not land';
  end if;
end $patch$;
