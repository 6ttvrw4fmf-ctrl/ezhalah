#!/bin/zsh
# Wasalt COMMERCIAL 4-hour LIGHT sweep — keeps wasalt_commercial_listings fresh.
# Local-only (wasalt.sa geo-blocks GitHub's cloud IPs). Mirrors Aqar's commercial sweep.

set -u
cd "$(dirname "$0")/.."
[ -f scrapers/.env ] && { set -a; . scrapers/.env; set +a; } || { echo "[wasalt-com-sweep] missing scrapers/.env" >&2; exit 1; }

export SCRAPE_MIN_INTERVAL=0.3
PY="scrapers/.venv/bin/python"
LOG="/tmp/wasalt-commercial-sweep.log"
echo "── $(date)  Wasalt commercial sweep starting" >> "$LOG"

printf '%s\n' shop office warehouse commercial-land showroom building land \
  | while read slug; do echo "$slug sale"; echo "$slug rent"; done \
  | xargs -P 4 -n 2 sh -c '"$0" -m scrapers.wasalt.run --type commercial --slug "$1" --deal "$2" --pages 3 2>&1 | tail -1' "$PY" \
  >> "$LOG" 2>&1

echo "── $(date)  Wasalt commercial sweep done" >> "$LOG"
