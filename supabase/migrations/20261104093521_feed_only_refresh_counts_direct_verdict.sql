-- mon_detect_refresh_coverage(): for haraj, a direct own-page ALIVE verdict counts as "refreshed"
-- (owner decision 7, 2026-11-04, «Yes, use your picks»).
--
-- WHY. haraj is a STREAM (hourly sitemap files of NEW posts), never a catalogue: once a post leaves
-- the newest files no crawl can see it again, so last_seen_at only ever moves on new posts. Its
-- liveness is CANDIDATE_PLUS_DIRECT through scrapers/haraj/run.py:_verify_gone, which re-reads every
-- active row's own page and stamps last_verified_alive_at (never last_seen_at, by the liveness
-- contract). Measured before this change: 16,197 active haraj rows, 1,052 re-seen by the crawl inside
-- the 72h window, 16,195 directly verified ALIVE inside it. refresh_coverage:haraj (P1) had been open
-- since 2026-10-30 reading «only 6.5% re-seen» over a population the oracle was proving live daily.
--
-- SCOPE. Only platforms in feed_only (haraj). For every other platform refresh_coverage still measures
-- the CRAWL alone: its job is to notice a crawl that stopped re-seeing a catalogue, and a liveness
-- oracle that keeps running would hide exactly that. A new feed-only platform joins the array only by
-- owner decision. The stale sweep (mark_stale_listings_inactive) already reads
-- greatest(last_seen_at, last_verified_alive_at) fleet-wide since 20261104032124.
--
-- Pinned offline by scripts/verify-feed-only-refresh-counts-direct-verdict.ts (the same predicate as
-- scripts/lib/refreshCoverage.ts, executed, plus the feed_only array read back from this file).
do $mig$
declare
  src text := pg_get_functiondef('public.mon_detect_refresh_coverage'::regproc);
  out text := src;
  n int;
  a1 constant text := $a$seen text[] := '{}'; gone text;$a$;
  b1 constant text := $a$seen text[] := '{}'; gone text;
        feed_only constant text[] := array['haraj'];  -- owner decision 7, 2026-11-04$a$;
  a2 constant text := $a$filter (where last_seen_at > now() - make_interval(hours => %s))$a$;
  b2 constant text := $a$filter (where %s > now() - make_interval(hours => %s))$a$;
  a3 constant text := $a$where active', win, t) into a, r;$a$;
  b3 constant text := $a$where active',
        case when rec.p = any(feed_only) then 'greatest(last_seen_at, last_verified_alive_at)'
             else 'last_seen_at' end,
        win, t) into a, r;$a$;
  a4 constant text := $a$'coverage_pct', pct, 'window_hours', win, 'severity', sev,$a$;
  b4 constant text := $a$'coverage_pct', pct, 'window_hours', win, 'severity', sev,
                           'measure', case when rec.p = any(feed_only)
                             then 'crawl re-seen OR direct own-page ALIVE verdict (feed-only platform, owner 2026-11-04)'
                             else 'crawl re-seen (last_seen_at)' end,$a$;
begin
  if md5(src) <> '42c777c229580d1389a307d8dec1775d' then
    raise exception 'mon_detect_refresh_coverage moved (md5 %), refusing to needle-edit', md5(src);
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
  n := (length(out) - length(replace(out, a4, ''))) / length(a4);
  if n <> 1 then raise exception 'anchor a4 matched % times', n; end if;
  out := replace(out, a4, b4);
  execute out;
end
$mig$;
