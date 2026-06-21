#!/bin/zsh
# Wasalt CLEANUP — permanently deletes long-dead wasalt_*_listings rows.
# Weekly local job (cloud blocked). Mirrors Aqar's weekly cleanup.

set -u
cd "$(dirname "$0")/.."
[ -f scrapers/.env ] && { set -a; . scrapers/.env; set +a; } || exit 1

PY="scrapers/.venv/bin/python"
LOG="/tmp/wasalt-cleanup.log"
echo "── $(date)  Wasalt cleanup starting" >> "$LOG"

"$PY" -m scrapers.aqar.cleanup --table wasalt_residential_listings >> "$LOG" 2>&1
"$PY" -m scrapers.aqar.cleanup --table wasalt_commercial_listings  >> "$LOG" 2>&1

echo "── $(date)  Wasalt cleanup done" >> "$LOG"
