-- scrape_suspect alerts could never close (unresolvable_alert_kind:scrape_suspect). The scrape alarm
-- workflow raises scrape_suspect:<left(sha256(ip),12)> when it blocks a caller for 24 h in
-- ops_blocked_ip, and nothing ever cleared the alert, so blocks that ended on 2026-10-25 and
-- 2026-10-31 still read as open. The alert's own action ("if it is one of our own robots, delete its
-- row from ops_blocked_ip") ends the same way. This resolver closes an open scrape_suspect alert once
-- no ops_blocked_ip row with that key is still in force (blocked_until in the future). It compares
-- hashes only; no address is read out or written anywhere. Hourly at :16 (a free minute).
create or replace function public.mon_resolve_ended_scrape_blocks()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int := 0; r record;
begin
  for r in
    select e.dedup_key
      from public.alert_event e
     where e.kind = 'scrape_suspect' and e.resolved_at is null
       and e.dedup_key like 'scrape_suspect:%'
       and not exists (
             select 1 from public.ops_blocked_ip b
              where 'scrape_suspect:' || left(encode(sha256(b.ip::bytea), 'hex'), 12) = e.dedup_key
                and b.blocked_until > now())
  loop
    perform public.mon_resolve_key('scrape_suspect', r.dedup_key);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$function$;

revoke all on function public.mon_resolve_ended_scrape_blocks() from public, anon, authenticated;

select cron.schedule('mon-resolve-ended-scrape-blocks', '16 * * * *',
  $$set statement_timeout to '30s'; select public.mon_resolve_ended_scrape_blocks();$$);