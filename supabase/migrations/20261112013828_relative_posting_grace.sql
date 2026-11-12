-- mon_detect_relative_posting_floor_unsafe(): the search-index check waited 30 minutes after a row was last seen,
-- on the belief that sync_search_posted_at() runs every 10 minutes. It runs every 30 (pg_cron jobid 234,
-- '29-59/30 * * * *'), and returns without writing when the search-index writer lock is busy. So a row crawled just
-- after one sync could be judged before the next one ran: a false P1. Wait 75 minutes — two sync runs plus slack.
-- A sync that stops for longer still raises.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_detect_relative_posting_floor_unsafe()'::regprocedure);
  out_def := replace(src, $n$and r.last_seen_at < now() - interval '30 minutes'$n$,
                          $n$and r.last_seen_at < now() - interval '75 minutes'$n$);
  if out_def = src then
    raise exception 'grace anchor not found — refusing to guess';
  end if;
  execute out_def;
  if position($n$interval '75 minutes'$n$ in pg_get_functiondef('public.mon_detect_relative_posting_floor_unsafe()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector still waits 30 minutes';
  end if;
end $$;
