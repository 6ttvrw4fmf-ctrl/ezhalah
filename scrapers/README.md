# Ezhalah scrapers

Python + Playwright + curl_cffi pipeline that pulls listings from the partner property
platforms and upserts them into the Supabase `listings` table the app reads.

This folder is **separate from the Expo app** — different runtime (Python vs Node),
different lifecycle (schedules vs deploys). Same repo, just isolated here.

## Status
**v0 — skeleton only.** The shared helpers (`common/db.py`, `common/http.py`,
`common/normalize.py`) and the per-platform scrapers (`aqar/`, etc.) are stubs and will
be filled in incrementally. Running anything in here right now is a no-op.

## Setup (one time)

```bash
cd scrapers
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
# Then open .env and paste the Supabase service-role key.
```

## What lives where

```
scrapers/
├── requirements.txt        # Python deps (playwright, curl_cffi, supabase, dotenv)
├── .env.example            # template — copy to .env, fill the service-role key
├── .gitignore              # never commit .venv or .env
├── README.md               # this file
├── common/                 # shared helpers across all scrapers
│   ├── db.py               # Supabase client + upsert helper (TODO)
│   ├── http.py             # curl_cffi session w/ realistic headers (TODO)
│   └── normalize.py        # raw site fields → canonical `listings` row (TODO)
└── aqar/                   # FIRST scraper target — Aqar.sa
    ├── discover.py         # walks listing pages → yields listing URLs (TODO)
    ├── enrich.py           # fetches one URL → normalized row (TODO)
    └── run.py              # orchestrates discover → enrich → upsert (TODO)
```

## DB tables this scraper writes to

- **`listings`** — one row per unique listing. Upserted on `(source_platform, source_id)`.
- **`scrape_runs`** — health log; one row per scraper run (platform, started/finished,
  ok, rows_seen, rows_upserted, notes). Use it to spot a broken source fast.

Both tables live in the project's Supabase. Public clients can SELECT active listings;
only the service-role key can INSERT / UPDATE.

## Rules of the road

- **Be polite.** Throttle requests (default: 1/sec/platform), respect robots.txt where
  reasonable, identify with a non-deceptive User-Agent in dev.
- **Never delete listings.** When a listing disappears from a source, set
  `active = false` and keep the row for analytics.
- **Always upsert.** Re-scrapes update `last_seen_at` and refresh changed fields; the
  `(source_platform, source_id)` unique constraint prevents duplicates.
- **Never commit `.env`.** Only `.env.example` belongs in git.
