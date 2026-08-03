-- Senior audit run #3 (2026-08-03): auto_recover_false_inactive still carried the pre-PR#277
-- extreme-price exclusion (price_total>1e9 / ppm>3e5 / price_annual>1e8), so extreme-but-valid rows
-- false-killed with missing_count=0 could NEVER self-heal — contradicting the owner's
-- extreme-price verify-then-preserve rule (implemented for dealapp in PR#277). Run #2 flagged this
-- but HELD it because the killer was unpinned; run #3 pinned the killer (the shared
-- _sanitize_price active=False clause in scrapers/common/db.py, fixed in the same batch as this
-- migration) — with the killer removed, restoring the recovery net's documented behavior is safe:
-- no flap risk remains, and recovery stays row-by-row via the existing guarded mechanism
-- (missing_count=0 + last_seen_at within window), no manual mass activation.
-- Guarded needle-edit per the RPC full-body-replace rule: built from the LIVE function def,
-- aborts if the anchor is not found exactly once.
do $mig$
declare src text; out text; needle text;
begin
  src := pg_get_functiondef('public.auto_recover_false_inactive'::regproc);
  needle := '         and not ( coalesce(price_total, 0)     > 1000000000
                or coalesce(price_per_meter, 0) > 300000
                or coalesce(price_annual, 0)    > 100000000 )
';
  if position(needle in src) = 0 then
    raise exception 'auto_recover_false_inactive: price-exclusion needle not found — aborting (function shape changed)';
  end if;
  out := replace(src, needle, '');
  if out = src or position('price_per_meter' in out) > 0 then
    raise exception 'auto_recover_false_inactive: edit did not apply cleanly — aborting';
  end if;
  execute out;
end
$mig$;
