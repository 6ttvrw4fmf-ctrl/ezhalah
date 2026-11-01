-- The ♻️ Lifecycle Engineer's on/off switch for a website's 30-day deletion (owner, 2026-09-27:
-- "apply it to everything, all websites"). docs/ops/LIFECYCLE_ENGINEER.md hard rule 9 makes this the
-- engineer's ONLY way to change platform_retention_policy, so turning deletion on is a guarded data
-- change, never a migration that drifts and never a raw UPDATE.
--
-- Guards, each one a real trap:
--   * turning deletion ON requires the platform's most recent dry run (last 7 days) to be clean:
--     not aborted, re-checked at least one listing at the source, and found 0 of them still live.
--     A dry run that re-checked nothing proves nothing; one that found a live listing among the
--     "dead" means the site's hiding is wrong, and deleting on top of it would make it permanent;
--   * only 'active' platforms can be switched on (a dormant site's checks all come back unknown);
--   * a new policy row gets the table's safe defaults (30 days, 3 strikes, source re-check) with a
--     smaller batch (300). The switch never changes any threshold of an existing row;
--   * turning deletion OFF is always allowed: it is the safe direction;
--   * refuses without evidence and appends it as a dated line to the policy's note.
-- The cleanup engine stays default-deny on top of this: a platform without a registered dead-check
-- in scrapers/common/cleanup.py PLATFORMS still deletes nothing. Not public API.

create or replace function public.set_platform_retention(p_platform text, p_enabled boolean, p_evidence text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_old    boolean;
  v_run    record;
  v_line   text;
begin
  if p_enabled is null then
    raise exception 'set_platform_retention: enabled must be true or false';
  end if;
  if coalesce(btrim(p_evidence), '') = '' then
    raise exception 'set_platform_retention: evidence is required';
  end if;

  select true, enabled into v_exists, v_old
    from platform_retention_policy where platform = p_platform for update;
  v_exists := coalesce(v_exists, false);

  if not v_exists and not exists (select 1 from platform_registry where platform = p_platform) then
    raise exception 'set_platform_retention: unknown platform %', p_platform;
  end if;
  if v_exists and v_old = p_enabled then
    return format('%s retention is already %s', p_platform, case when p_enabled then 'on' else 'off' end);
  end if;
  if not v_exists and not p_enabled then
    return format('%s retention is already off (no policy row)', p_platform);
  end if;

  if p_enabled then
    if not exists (select 1 from platform_registry where platform = p_platform and status = 'active') then
      raise exception 'set_platform_retention: % is not active; only an active site can have deletion turned on', p_platform;
    end if;
    select dry_run, aborted, rechecked, reactivated, ran_at into v_run
      from cleanup_runs
     where platform = p_platform and dry_run and ran_at > now() - interval '7 days'
     order by ran_at desc limit 1;
    if not found then
      raise exception 'set_platform_retention: % has no dry run in the last 7 days', p_platform;
    end if;
    if v_run.aborted then
      raise exception 'set_platform_retention: %''s latest dry run (%) aborted', p_platform, v_run.ran_at;
    end if;
    if coalesce(v_run.rechecked, 0) = 0 then
      raise exception 'set_platform_retention: %''s latest dry run re-checked nothing, so it proves nothing', p_platform;
    end if;
    if coalesce(v_run.reactivated, 0) > 0 then
      raise exception 'set_platform_retention: %''s latest dry run found % live listing(s) among the "dead"; fix the checker first',
        p_platform, v_run.reactivated;
    end if;
  end if;

  v_line := format('[%s] deletion %s via set_platform_retention: %s',
                   to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
                   case when p_enabled then 'ON' else 'OFF' end, btrim(p_evidence));
  if v_exists then
    update platform_retention_policy
       set enabled = p_enabled,
           note = concat_ws(E'\n', nullif(note, ''), v_line)
     where platform = p_platform;
  else
    insert into platform_retention_policy (platform, enabled, max_delete_per_run, note)
    values (p_platform, true, 300, v_line);
  end if;
  return format('%s retention: %s -> %s', p_platform,
                case when not v_exists then 'none' when v_old then 'on' else 'off' end,
                case when p_enabled then 'on' else 'off' end);
end;
$$;

revoke all on function public.set_platform_retention(text, boolean, text) from public, anon, authenticated;

-- Executed against production at apply time. Every call below must be REFUSED or be a no-op, so
-- this block cannot change any policy. Any failure rolls the whole migration back.
do $verify$
declare
  v_before   text;
  v_after    text;
  v_msg      text;
  v_refused  boolean;
  v_untested text;
  v_rows     bigint;
begin
  select count(*) into v_rows from platform_retention_policy;

  -- 1. empty evidence is refused
  v_refused := false;
  begin perform set_platform_retention('aqar', false, '  '); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'empty evidence was not refused'; end if;

  -- 2. unknown platform is refused
  v_refused := false;
  begin perform set_platform_retention('__no_such_platform__', true, 'verify'); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'unknown platform was not refused'; end if;

  -- 3. turning ON a site with no dry run is refused (and inserts nothing)
  select p.platform into v_untested
    from platform_registry p
   where p.status = 'active'
     and not exists (select 1 from platform_retention_policy r where r.platform = p.platform)
     and not exists (select 1 from cleanup_runs c where c.platform = p.platform and c.dry_run
                      and c.ran_at > now() - interval '7 days')
   order by p.platform limit 1;
  if v_untested is null then raise exception 'no untested active platform to prove the dry-run guard with'; end if;
  v_refused := false;
  begin perform set_platform_retention(v_untested, true, 'verify'); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'enabling % without a dry run was not refused', v_untested; end if;

  -- 4. null enabled is refused
  v_refused := false;
  begin perform set_platform_retention('aqar', null, 'verify'); exception when others then v_refused := true; end;
  if not v_refused then raise exception 'null enabled was not refused'; end if;

  -- 5. same-state call is a no-op: nothing written
  select note into v_before from platform_retention_policy where platform = 'aqar';
  v_msg := set_platform_retention('aqar', true, 'verify no-op');
  select note into v_after from platform_retention_policy where platform = 'aqar';
  if v_after is distinct from v_before or v_msg not like '%already on' then
    raise exception 'same-state call was not a no-op: %', v_msg;
  end if;

  -- 6. nothing was inserted
  if (select count(*) from platform_retention_policy) <> v_rows then
    raise exception 'a refused or no-op call inserted a policy row';
  end if;

  -- 7. not callable with the public key
  if has_function_privilege('anon', 'public.set_platform_retention(text,boolean,text)', 'execute') then
    raise exception 'anon can execute set_platform_retention';
  end if;

  raise notice 'set_platform_retention verified: refuses empty evidence / unknown / no dry run / null, no-op on same state, inserts nothing, not public';
end $verify$;
