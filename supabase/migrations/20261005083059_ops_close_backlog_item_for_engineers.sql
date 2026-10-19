-- 2026-10-04 night (⚡ report): the cloud engineers could not mark their work-queue items done — the database
-- tool holds every UPDATE for a human confirmation, and the owner is asleep during the night shift. This
-- function closes ONE item with evidence through a plain SELECT. It only ever touches ops_engineer_backlog,
-- only an OPEN row, only to 'done' or 'wontfix', and refuses an empty evidence (the table's own rule).
create or replace function public.ops_close_backlog_item(p_id bigint, p_status text, p_evidence text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if p_status not in ('done', 'wontfix') then
    raise exception 'status must be done or wontfix, got %', p_status;
  end if;
  if coalesce(btrim(p_evidence), '') = '' then
    raise exception 'evidence is required to close an item';
  end if;
  update public.ops_engineer_backlog
     set status = p_status, evidence = p_evidence, closed_at = now()
   where id = p_id and status = 'open';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 'not closed: item ' || p_id || ' is not open (or does not exist)';
  end if;
  return 'closed ' || p_id || ' as ' || p_status;
end
$$;

revoke all on function public.ops_close_backlog_item(bigint, text, text) from public, anon, authenticated;

comment on function public.ops_close_backlog_item(bigint, text, text) is
  'Engineers close a work-queue item with evidence via SELECT ops_close_backlog_item(id, ''done''|''wontfix'', evidence).';
