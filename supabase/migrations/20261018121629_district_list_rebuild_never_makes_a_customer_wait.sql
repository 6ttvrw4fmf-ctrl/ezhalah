-- 2026-10-18, follow-up to 20261018120750. THE DISTRICT LIST REBUILD NEVER MAKES A CUSTOMER WAIT.
--
-- MEASURED LIVE 12:10:56-12:11:28 UTC. district-recovery-pipeline (:10) asked for ACCESS EXCLUSIVE on
-- loc_canonical_district (the TRUNCATE in refresh_loc_canonical_district) while the :59 detector sweep, running for
-- 12 minutes by then, held ACCESS SHARE on it; a customer's district_options_ar call (PostgREST) then queued behind
-- the pipeline. resolve_district_ar reads the same table. It happens every hour the sweep runs long: 10:59 ran 900 s
-- and the 11:10 pipeline took 292 s against its usual ~60 s.
--
-- THE FIX. The rebuild DELETEs instead of TRUNCATEs: ROW EXCLUSIVE, which no reader waits on, and readers keep the
-- old list until the rebuild commits (the MVCC rule #7505 applies to district_recovery). One statement is swapped in
-- the RUNNING body, the needle checked to occur exactly once, so nothing else in the function changes.
--
-- Also: the work list and its detector (20261018120750) are not public API, so anon/authenticated lose EXECUTE.
set local statement_timeout = '120s';
set local lock_timeout = '5s';

do $mig$
declare
  old_stmt constant text := 'truncate public.loc_canonical_district;';
  new_stmt constant text := 'delete from public.loc_canonical_district;';
  def text; occ int;
begin
  def := pg_get_functiondef('public.refresh_loc_canonical_district'::regproc);
  occ := (length(def) - length(replace(def, old_stmt, ''))) / length(old_stmt);
  if occ <> 1 then raise exception 'refresh_loc_canonical_district: truncate needle found % times, expected 1', occ; end if;
  execute replace(def, old_stmt, new_stmt);
end
$mig$;

revoke execute on function public.served_district_not_offered() from public, anon, authenticated;
revoke execute on function public.mon_detect_served_district_not_offered() from public, anon, authenticated;

-- PROOF at apply: nothing truncates the list any more, and the public API cannot run the work list.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosrc ~* 'truncate\s+(public\.)?loc_canonical_district') then
    raise exception 'PROOF: a function still truncates loc_canonical_district';
  end if;
  if position('delete from public.loc_canonical_district;' in pg_get_functiondef('public.refresh_loc_canonical_district'::regproc)) = 0 then
    raise exception 'PROOF: the rebuild no longer clears the list before refilling it';
  end if;
  if has_function_privilege('anon', 'public.served_district_not_offered()', 'execute')
     or has_function_privilege('anon', 'public.mon_detect_served_district_not_offered()', 'execute') then
    raise exception 'PROOF: anon can still run the work list or its detector';
  end if;
end $$;
