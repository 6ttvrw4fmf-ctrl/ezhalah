-- mark_stale_listings_inactive(): a row a DIRECT liveness oracle proved ALIVE is not stale.
--
-- ROOT CAUSE. The daily stale sweep (pg_cron jobid 13, 04:00 UTC) and its coverage gate measured
-- "source evidence this row still exists" with last_seen_at ONLY. Since the liveness contract
-- (scrapers/common/liveness_contract.py) split the two facts, a direct fetch of the listing's own
-- page that answers ALIVE stamps last_verified_alive_at and NOT last_seen_at. So a platform whose
-- crawl sees only a slice but whose oracle re-fetches every row read as stale. Measured before this
-- change: muhaysini_residential 18,785 active, 7,024 "stale" by last_seen_at, 0 by either stamp,
-- 18,785 directly verified in the last 3 days; haraj_residential 13,315 vs 2; haraj_commercial 958
-- vs 0; muhaysini_commercial 266 vs 0. The result was stale_breaker_escape (muhaysini, 13 days),
-- stale_coverage_gate (haraj, muhaysini) and stale_listings_detected over rows proven live.
--
-- THE FIX makes the sweep tell the two cases apart: the latest source evidence is
-- greatest(last_seen_at, last_verified_alive_at) (greatest() ignores NULL, so a never-verified row
-- is judged on last_seen_at exactly as before). A row with neither stamp inside the window is still
-- reported. This path never deactivates anything (n := 0 on every branch); no kill rule moves.
do $mig$
declare
  src text := pg_get_functiondef('public.mark_stale_listings_inactive'::regproc);
  out text := src;
  n int;
  a1 constant text := $a$last_seen_at < now() - $1 * interval ''1 day''', t)$a$;
  b1 constant text := $a$greatest(last_seen_at, last_verified_alive_at) < now() - $1 * interval ''1 day''', t)$a$;
  a2 constant text := $a$last_seen_at > now() - make_interval(hours => %s)'$a$;
  b2 constant text := $a$greatest(last_seen_at, last_verified_alive_at) > now() - make_interval(hours => %s)'$a$;
  a3 constant text := $a$'measure', 'distinct ACTIVE rows whose last_seen_at was refreshed inside the window. '$a$;
  b3 constant text := $a$'measure', 'distinct ACTIVE rows whose greatest(last_seen_at, last_verified_alive_at) is inside the window '
                    || '(a direct liveness oracle ALIVE verdict counts: it is stronger evidence than crawl presence). '$a$;
begin
  if md5(src) <> '46b864145225e1897ce0ad014c0732e2' then
    raise exception 'mark_stale_listings_inactive moved (md5 %), refusing to needle-edit', md5(src);
  end if;
  n := (length(out) - length(replace(out, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'anchor a1 matched % times', n; end if;
  out := replace(out, a1, b1);
  n := (length(out) - length(replace(out, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'anchor a2 matched % times', n; end if;
  out := replace(out, a2, b2);
  n := (length(out) - length(replace(out, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'anchor a3 matched % times', n; end if;
  out := replace(out, a3, b3);
  execute out;
end
$mig$;
