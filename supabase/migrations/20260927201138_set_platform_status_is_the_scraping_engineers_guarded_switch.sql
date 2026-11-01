-- The Scraping Engineer's on/off switch for a site that is down ON ITS SIDE (owner rule 2026-09-24,
-- amended 2026-09-26: a down site's listings AND logo leave, the platform count drops, and it comes
-- back by itself). docs/ops/SCRAPING_ENGINEER.md rule 4 makes this the engineer's ONLY database write
-- besides its run log, so a flip is a guarded data change, never a migration that drifts.
--
-- Guards, each one a real trap:
--   * only 'active' <-> 'dormant'. Never 'retired': the v2 search gate hides only 'dormant', so a
--     'retired' flip would put a dead site's listings BACK into search. Retiring is the owner's call;
--   * never touches a platform that is already 'retired';
--   * refuses without evidence, and appends it as a dated line to notes, the same log
--     scrapers/common/restore_dormant.py writes, so every flip can be explained later.
-- Nothing is deleted or deactivated. Not public API: no anon/authenticated execute.

create or replace function public.set_platform_status(p_platform text, p_status text, p_evidence text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if p_status is null or p_status not in ('active', 'dormant') then
    raise exception 'set_platform_status: status must be active or dormant, got %', p_status;
  end if;
  if coalesce(btrim(p_evidence), '') = '' then
    raise exception 'set_platform_status: evidence is required';
  end if;
  select status into v_old from platform_registry where platform = p_platform for update;
  if not found then
    raise exception 'set_platform_status: unknown platform %', p_platform;
  end if;
  if v_old = 'retired' then
    raise exception 'set_platform_status: % is retired; only the owner changes that', p_platform;
  end if;
  if v_old = p_status then
    return format('%s is already %s', p_platform, p_status);
  end if;
  update platform_registry
     set status = p_status,
         updated_at = now(),
         notes = concat_ws(E'\n', nullif(notes, ''),
                   format('[%s] %s -> %s: %s',
                          to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
                          v_old, p_status, btrim(p_evidence)))
   where platform = p_platform;
  return format('%s: %s -> %s', p_platform, v_old, p_status);
end;
$$;

revoke all on function public.set_platform_status(text, text, text) from public, anon, authenticated;

-- Executed against production at apply time. Every call below must be REFUSED or be a no-op, so
-- this block cannot change any platform.
do $verify$
declare
  v_active text;
  v_before timestamptz;
  v_after  timestamptz;
  v_msg    text;
  v_refused boolean;
begin
  select platform, updated_at into v_active, v_before
    from platform_registry where status = 'active' order by platform limit 1;

  -- 1. 'retired' is refused
  v_refused := false;
  begin perform set_platform_status(v_active, 'retired', 'verify'); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'retired was not refused'; end if;

  -- 2. empty evidence is refused
  v_refused := false;
  begin perform set_platform_status(v_active, 'dormant', '  '); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'empty evidence was not refused'; end if;

  -- 3. unknown platform is refused
  v_refused := false;
  begin perform set_platform_status('__no_such_platform__', 'dormant', 'verify'); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'unknown platform was not refused'; end if;

  -- 4. a retired platform cannot be switched on
  if exists (select 1 from platform_registry where status = 'retired') then
    v_refused := false;
    begin
      perform set_platform_status((select platform from platform_registry where status = 'retired' limit 1), 'active', 'verify');
    exception when others then v_refused := true; end;
    if not v_refused then raise exception 'a retired platform was switched on'; end if;
  end if;

  -- 5. same-status call is a no-op: nothing written
  v_msg := set_platform_status(v_active, 'active', 'verify no-op');
  select updated_at into v_after from platform_registry where platform = v_active;
  if v_after is distinct from v_before or v_msg not like '%already active' then
    raise exception 'same-status call was not a no-op: % / % -> %', v_msg, v_before, v_after;
  end if;

  -- 6. not callable with the public key
  if has_function_privilege('anon', 'public.set_platform_status(text,text,text)', 'execute') then
    raise exception 'anon can execute set_platform_status';
  end if;

  raise notice 'set_platform_status verified: refuses retired / empty evidence / unknown / retired->active, no-op on same status, not public';
end $verify$;
