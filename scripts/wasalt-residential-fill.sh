#!/bin/zsh
# Wasalt RESIDENTIAL DEEP FILL — bulk loader, manual run. Local (cloud blocked).
# Mirrors Aqar's "Aqar residential deep fill". 800 pages × every slug × sale+rent, 6 parallel.

set -u
cd "$(dirname "$0")/.."
[ -f scrapers/.env ] && { set -a; . scrapers/.env; set +a; } || exit 1

export SCRAPE_MIN_INTERVAL=0.25
PY="scrapers/.venv/bin/python"
LOG="/tmp/wasalt-residential-fill.log"
echo "── $(date)  Wasalt residential DEEP FILL starting" >> "$LOG"

printf '%s\n' apartment villa-townhouse floor building land rest-house chalet farm room duplex \
  | while read slug; do echo "$slug sale"; echo "$slug rent"; done \
  | xargs -P 6 -n 2 sh -c '"$0" -m scrapers.wasalt.run --type residential --slug "$1" --deal "$2" --pages 800 2>&1 | tail -1' "$PY" \
  >> "$LOG" 2>&1

echo "── $(date)  Wasalt residential DEEP FILL done" >> "$LOG"
