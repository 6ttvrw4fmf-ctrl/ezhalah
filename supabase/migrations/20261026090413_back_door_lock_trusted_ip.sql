-- SECURITY PHASE 4.6, back-door lock (owner 2026-10-26: «yes ok» to letting the home Wi-Fi in without a key).
--
-- The practice lock's notebook showed ~90% of the remaining keyless calls come from the owner's own computer: AI
-- sessions' local app previews (127.0.0.1) and local checkers (ops_deploy_preflight_checks). The owner does not want the
-- secret stored on that computer, so the lock also accepts a call whose network address is on a short, private trusted
-- list. The addresses live ONLY in this table (written by hand / execute_sql, never in git: the repo may be public).
-- Only the back-door lock reads it: the scrape auto-block and the network guard still apply to these addresses.
--
-- Rollback: delete from guard.trusted_ip;  (instant; the lock then needs the key again)
create table if not exists guard.trusted_ip (
  ip text primary key check (ip ~ '^[0-9A-Fa-f:.]{3,45}$'),
  note text not null,
  added_at timestamptz not null default now()
);
revoke all on guard.trusted_ip from public, anon, authenticated;
grant select, insert, update, delete on guard.trusted_ip to service_role;

create or replace function guard.ip_trusted(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(p_ip, '') <> '' and exists (select 1 from guard.trusted_ip t where t.ip = btrim(p_ip));
$fn$;
revoke all on function guard.ip_trusted(text) from public;
grant execute on function guard.ip_trusted(text) to anon, authenticated, service_role;

-- Patch the ONE lock line in the live robot_gate (never a full rewrite: other sessions edit the robot-lane half).
do $patch$
declare
  d text; k int;
  old_line constant text := 'has_gate := guard.gate_valid(hdr ->> ''x-ezhalah-gate'');';
  new_line constant text := 'has_gate := guard.gate_valid(hdr ->> ''x-ezhalah-gate'') or guard.ip_trusted(coalesce(hdr ->> ''cf-connecting-ip'', split_part(coalesce(hdr ->> ''x-forwarded-for'', ''''), '','', 1)));';
begin
  select pg_get_functiondef('public.robot_gate()'::regprocedure) into d;
  if position('guard.ip_trusted' in d) > 0 then raise notice 'robot_gate already reads the trusted list'; return; end if;
  k := (length(d) - length(replace(d, old_line, ''))) / length(old_line);
  if k <> 1 then raise exception 'lock line found % times, want 1 — read the live robot_gate first', k; end if;
  execute replace(d, old_line, new_line);
  if position('guard.ip_trusted' in pg_get_functiondef('public.robot_gate()'::regprocedure)) = 0 then
    raise exception 'patch did not land';
  end if;
end $patch$;
