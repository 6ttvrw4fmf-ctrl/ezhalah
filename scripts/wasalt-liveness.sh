#!/bin/zsh
# Wasalt LIVENESS — checks wasalt_*_listings rows are still alive on wasalt.sa.
# Daily local job (cloud blocked). Mirrors Aqar's daily liveness sweep.

set -u
cd "$(dirname "$0")/.."
[ -f scrapers/.env ] && { set -a; . scrapers/.env; set +a; } || exit 1

PY="scrapers/.venv/bin/python"
LOG="/tmp/wasalt-liveness.log"
echo "── $(date)  Wasalt liveness starting" >> "$LOG"

# Both tables, light shard count (Wasalt's total is much smaller than Aqar's).
"$PY" -m scrapers.aqar.liveness --table wasalt_residential_listings --shards 4 --shard 0 >> "$LOG" 2>&1
"$PY" -m scrapers.aqar.liveness --table wasalt_commercial_listings  --shards 1 --shard 0 >> "$LOG" 2>&1

echo "── $(date)  Wasalt liveness done" >> "$LOG"
