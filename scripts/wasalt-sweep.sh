#!/bin/zsh
# Wasalt 4-hour LIGHT sweep — keeps wasalt_*_listings fresh on the user's Mac.
#
# Lives on the Mac (NOT the cloud) because wasalt.sa geo-blocks GitHub's datacenter IPs.
# Runs from launchd every 4h: hits every residential + commercial type-slug for 3 pages
# (≈ 96 listings/slug), batch-upserts; new listings get inserted, existing refresh last_seen_at.
# Total per cycle ≈ 17 slugs × 2 deals × ~90 rows = ~3,000 upserts. Polite (~6 procs, 0.3s spacing).

set -u
cd "$(dirname "$0")/.."

# Load Supabase creds for the scraper (.env file under scrapers/).
if [ -f scrapers/.env ]; then
  set -a
  . scrapers/.env
  set +a
else
  echo "[wasalt-sweep] missing scrapers/.env — aborting" >&2
  exit 1
fi

export SCRAPE_MIN_INTERVAL=0.3
PY="scrapers/.venv/bin/python"
LOG="/tmp/wasalt-sweep.log"
echo "── $(date)  Wasalt sweep starting" >> "$LOG"

# Light 3-page sweep × all slugs × sale/rent, 6 parallel.
{
  printf '%s\n' residential:apartment residential:villa-townhouse residential:floor \
    residential:building residential:land residential:rest-house residential:chalet \
    residential:farm residential:room residential:duplex \
    commercial:shop commercial:office commercial:warehouse commercial:commercial-land \
    commercial:showroom commercial:building commercial:land \
  | while read combo; do
      type="${combo%%:*}"; slug="${combo##*:}"
      echo "$type $slug sale"
      echo "$type $slug rent"
    done \
  | xargs -P 6 -n 3 sh -c '"$0" -m scrapers.wasalt.run --type "$1" --slug "$2" --deal "$3" --pages 3 2>&1 | tail -1' "$PY" \
  >> "$LOG" 2>&1
} || true

echo "── $(date)  Wasalt sweep done" >> "$LOG"
