#!/bin/zsh
# Wasalt COMMERCIAL DEEP FILL — bulk loader, manual run. Local (cloud blocked).
# Mirrors Aqar's "Aqar commercial fill". 400 pages × every slug × sale+rent, 4 parallel.

set -u
cd "$(dirname "$0")/.."
[ -f scrapers/.env ] && { set -a; . scrapers/.env; set +a; } || exit 1

export SCRAPE_MIN_INTERVAL=0.25
PY="scrapers/.venv/bin/python"
LOG="/tmp/wasalt-commercial-fill.log"
echo "── $(date)  Wasalt commercial DEEP FILL starting" >> "$LOG"

printf '%s\n' shop office warehouse commercial-land showroom building land \
  | while read slug; do echo "$slug sale"; echo "$slug rent"; done \
  | xargs -P 4 -n 2 sh -c '"$0" -m scrapers.wasalt.run --type commercial --slug "$1" --deal "$2" --pages 400 2>&1 | tail -1' "$PY" \
  >> "$LOG" 2>&1

echo "── $(date)  Wasalt commercial DEEP FILL done" >> "$LOG"
