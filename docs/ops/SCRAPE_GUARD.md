# Scrape guard: catch and auto-block bulk listing downloads (security plan Phase 4)

## Owner decision (2026-10-21, permanent until the owner changes it)

**Block automatically for 24 hours at 100,000 listing rows (or 6,000 requests) from one address in one hour. No
alert ping; a quiet record only. Lower the number later.**

The owner asked about 5,000 and 10,000. Both would block real people today. Measured 24 h to 2026-10-21: every search
quietly loads about 1,000 rows, and the busiest real visitor pulled **8,009 rows in one hour** just by searching. A
university, office or mobile network also shares one address across many people. **The bar may be lowered toward
10,000 only after searches load small batches** (re-measure real visitors first and record the numbers here).

## How it works

1. `.github/workflows/scrape-alarm.yml` runs `scripts/scrape-alarm.ts` every hour at :17. It reads the past hour of
   API-gateway logs and adds up, per address, the listing rows returned (`scripts/lib/scrapeAlarm.ts`).
2. Over the bar → the address goes into `ops_blocked_ip` for 24 h and `ops_scrape_suspect` (both service_role only).
   A P3 `scrape_suspect` record carries country / city / network / device, never the address.
3. `robot_gate()` (the PostgREST pre-request hook every REST/RPC call passes through) refuses a blocked address with
   **HTTP 429** for the public and signed-in roles. It **fails open**: if the lookup breaks, requests go through.
   Our robots using the service key are never checked.
4. If the hourly job stops succeeding, `mon_detect_scrape_alarm_silent()` raises P2 after 4 hours.

Verified live 2026-10-21: the owner's own address, blocked for 40 s, got 429 on a table read and on an RPC. After
unblocking it got 200. Faking `x-forwarded-for` / `x-real-ip` still got 429, and faking `cf-connecting-ip` is refused
by Cloudflare itself (403).

## Everyday commands (Supabase SQL editor)

```sql
select * from ops_blocked_ip where blocked_until > now();             -- who is blocked right now
select * from ops_scrape_suspect order by created_at desc limit 20;   -- who was caught, where from
delete from ops_blocked_ip where ip = '<address>';                    -- unblock one address now
```

If a blocked address turns out to be ours, unblock it and add it to the repo variable `SCRAPE_ALARM_KNOWN_IPS`
(comma-separated). The owner's home connection is already there.

## Known gaps (stated, not hidden)

- **GitHub's network (Microsoft) is not measured**, because our CI lives there. Closes when CI moves to our own server
  (`docs/ops/OWN_SERVER_RUNNERS.md`).
- **A scraper spread over many addresses** stays under the bar on each one. The next Phase 4 steps (smaller search
  batches, then a lower bar, then a human check on heavy use) narrow this. Nothing makes copying impossible.
- **A shared address** (mobile carrier, campus) could in theory add up past 100,000 from many real people. At
  today's traffic the busiest address is ~12× below the bar. Re-measure before lowering it.
