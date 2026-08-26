#!/bin/zsh
# RETIRED 2026-08-23 — this wrapper invoked the legacy no-recheck hard-deleter. It now refuses.
#
# It used to run `python -m scrapers.aqar.cleanup --table wasalt_{residential,commercial}_listings`,
# which deleted on age + strike count alone: no final source re-check before deleting, no anomaly or
# fraction circuit breaker, an unbounded loop (PAGE=1000 was a batch size, not a cap), and no
# per-row audit trail. Across both platforms that path removed 21,371 rows with no recoverable
# record of which listings they were.
#
# wasalt is the sharper case: its enum-liveness sweep failed on 2026-08-19 and 2026-08-21 (100%
# proxy timeouts, 0 rows), so the missing_count strikes this script trusted had not moved since
# 2026-08-18 — and 2,254 wasalt rows were deleted on 2026-08-23 against those stale strikes.
#
# wasalt is now on the unified retention engine (PR #898; platform_retention_policy.enabled = true,
# applied 2026-08-23), which re-fetches every row's own URL immediately before deleting it and
# treats any 403/429/5xx/timeout as inconclusive rather than dead. The scheduled path is
# .github/workflows/wasalt-cleanup.yml (pg_cron gh-wasalt-cleanup, Sun 02:30 UTC).
#
# Kept as a loud refusal rather than deleted, so a local crontab that still calls it fails visibly.
#
# Regression guard: scripts/verify-no-unguarded-deleter.ts (in `npm test`).

set -u

cat >&2 <<'EOF'
REFUSED: scripts/wasalt-cleanup.sh is RETIRED and will not delete anything.

wasalt retention now runs through the unified engine, which re-probes each listing before deleting:

    python -m scrapers.common.cleanup --platform wasalt --dry-run

Drop --dry-run only after reading the dry-run report. The scheduled path is
.github/workflows/wasalt-cleanup.yml (pg_cron gh-wasalt-cleanup, Sundays 02:30 UTC).
EOF

exit 2
