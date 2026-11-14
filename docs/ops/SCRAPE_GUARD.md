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
4. GitHub runs the "hourly" job every 3-5 hours, so each run checks every hour since the last good run (up to 24 h,
   one row per caller per hour). If it stops succeeding, `mon_detect_scrape_alarm_silent()` raises P2 after 8 hours
   (migration 20261023045428; it was 4 hours and fired on normal GitHub delays).

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
**Our own server is there too (owner 2026-11-14, «Yeah unblock»):** `138.201.255.218` (Hetzner, Falkenstein — the
`ezhalah-own` runners, `docs/ops/OWN_SERVER_RUNNERS.md`). Every non-PR job runs from that ONE address, so our own scrapers
and robots read ~400,000 listing rows an hour from it; the alarm blocked it at 14:40 UTC that day and the drift gate of
every deploy then answered HTTP 429 (`robot_gate()` → `guard.ip_is_blocked`), so nothing could ship. It was unblocked and
added to `SCRAPE_ALARM_KNOWN_IPS`. If the server's address ever changes, add the new one the same day.

## Known gaps (stated, not hidden)

- **GitHub's network (Microsoft) is not measured**, because our CI lives there. Closes when CI moves to our own server
  (`docs/ops/OWN_SERVER_RUNNERS.md`).
- **A scraper spread over many addresses** stays under the bar on each one. The next Phase 4 steps (smaller search
  batches, then a lower bar, then a human check on heavy use) narrow this. Nothing makes copying impossible.
- **A shared address** (mobile carrier, campus) could in theory add up past 100,000 from many real people. At
  today's traffic the busiest address is ~12× below the bar. Re-measure before lowering it.

## The front door (Phase 4.3, 2026-10-21)

Real visitors made ~1,400 direct database requests in the 24 h to 2026-10-21. Our own robots made ~290,000 with the
same public key (GitHub CI ~286,000, the owner's machine ~15,000). Closing the direct "back door" is therefore mostly
about moving our robots, not visitors.

- `api/sb.ts` at `/sb/rest/v1/*` (vercel.json rewrite, functions in Tokyo `hnd1` next to the database) forwards the
  web app's REST calls to Supabase. Auth, storage and edge functions stay direct.
- **Vercel BotID** (free Basic) checks each call. SOFT until `EZ_BOTID_ENFORCE=1` is set in Vercel: answers carry
  `x-ezhalah-bot: human|bot|unknown`, nobody is refused.
- **Secret handshake.** Behind the front door, Cloudflare sees our server, not the visitor. So `api/sb.ts` forwards
  the visitor's address (as Vercel measured it) in `x-ezhalah-client-ip` with `x-ezhalah-gate = EZ_GATE_SECRET`.
  `robot_gate` believes it only when the secret matches `guard.front_door_secret` (20261021120255). Otherwise it is
  ignored. The secret lives in the GitHub secret `EZ_GATE_SECRET`, the Vercel env `EZ_GATE_SECRET`, and the database
  (written by the **Front door secret** workflow). It is never written in a file in this repo or in a chat.
- The app uses the front door only when `EXPO_PUBLIC_FRONT_DOOR=1` (src/lib/supabase.ts). While the back door is
  open, a front door that fails (502/503/504 or unreachable) is retried directly.
- The scrape alarm skips front-door traffic (Amazon network + `ezhalah-front-door` marker): it is every visitor
  summed under a few server addresses. **Stated gap**: a scraper going through the front door is BotID's job, not
  the alarm's, until a per-visitor count exists there.

### Turning it on (order matters)

1. Dispatch **Vercel gate secret** (copies the GitHub secret `EZ_GATE_SECRET` into the Vercel Production env; owner
   2026-10-21 chose this over pasting from a laptop file). Manual alternative: Vercel → Settings → Environment Variables → add `EZ_GATE_SECRET` (Production) =
   the value in the Desktop file `EZHALAH-GATE-SECRET-paste-into-Vercel-then-delete.txt`, then delete that file.
2. Dispatch **Front door secret** (stores the same value in the database).
3. Deploy, then confirm `/sb/rest/v1/…` answers and the database sees the visitor's address.
4. After a day of `x-ezhalah-bot` showing real visitors as `human`: set `EZ_BOTID_ENFORCE=1`. **Done 2026-11-12 (owner
   approved):** 48 h of front-door logs read 3,220 + ~2,330 real-visitor calls, every one `bot=human` (0 `bot=bot`); every
   `bot=bot` call carried the robot pass.
   Switch: dispatch **Vercel guard switch** (`.github/workflows/vercel-guard-switch.yml`, `EZ_BOTID_ENFORCE` / `EZ_TURNSTILE_ENFORCE`,
   1 = block, 0 = watch), then deploy through deploy-frontend.yml. Undo = the same with 0. Owner approves each flip.
5. Move our robots off the bare public key (they send the handshake too, from the GitHub secret), then close the back
   door: `robot_gate` refuses the public roles without a valid handshake. Owner present for this step.

## Speed limit (Vercel firewall, owner 2026-11-04: «only let people go at normal human speed»)

One per-IP rate-limit rule on the front door (`/sb/*`, `/api/sb*`): 300 requests per 60 s window, fixed window. Set it
by dispatching **Vercel rate limit** (`.github/workflows/vercel-rate-limit.yml`, mode `log` | `rate_limit` | `off`); it
upserts the rule through the Vercel API and fails unless the ACTIVE config shows it. No deploy needed.

- **Start and stay in `log`** (watch only, nobody refused) until the Firewall overview shows who would have hit it.
- Threshold, measured in edge_logs 2026-11-02/04: busiest real visitor 128 calls/min (p99 91, p50 14); our robots with
  the robot pass reached 595/min. Per 10 s: busiest human 71, robots 174.
- **Before `rate_limit` (429):** (1) our own e2e robots need a bypass condition (a dedicated header the firewall can
  match — not EZ_GATE_SECRET, which would sit in plain text in the firewall config); (2) Saudi mobile carriers share
  addresses (CGNAT), so many real phones can sit behind one IP — check the log hits first; (3) the owner approves.
  A 429 is final for the app (it only retries 502/503/504).
- **Done 2026-11-12 (owner: «speed limit: switch to blocking, with a pass for our robots»).** (1) The bypass is
  `x-ezhalah-ratepass` = sha256(`EZ_GATE_SECRET:speed-limit-pass`): one-way, so the firewall config never holds the
  secret; robots send it from `scripts/lib/robotPassCore.mjs`, the workflow derives the same value, and
  `scripts/verify-speed-limit-robot-pass.ts` pins that both agree. (2) Measured 24 h to 2026-11-12: busiest real visitor
  110 calls/min (vid-keyed), ~3k real calls/day — CGNAT sharing at that volume stays far under 300. (3) Owner approved.
- Undo: dispatch `log` again; off: dispatch `off`.

## Cloudflare Turnstile (owner 2026-10-21: invisible, "users shouldn't verify every time")

Second guard next to BotID. Site key `0x4AAAAAAFfpkJx1Y3UJ9QLd` (public, in src/lib/supabase.ts), widget "Ezhalah",
hostname ezhalah-app.vercel.app, **Invisible** mode, pre-clearance off; secret `TURNSTILE_SECRET_KEY` in the Vercel
project (Production), never in the repo. Once per visit the browser solves the invisible check and trades the token
at `POST /api/human` (Cloudflare siteverify) for a one-hour `ez_human` cookie (HMAC-signed, api/_humanPass.ts),
renewed at 50 minutes. The front door labels every call `x-ezhalah-human: pass|none|off` and refuses only when
`EZ_TURNSTILE_ENFORCE=1`. Runs only when the front door is on. Cloudflare requires Invisible-mode sites to reference
its Turnstile Privacy Addendum in their privacy policy. Done 2026-10-21: owner-approved line in Privacy Policy §6
(src/data/legal.ts + legalEnglish.ts, «Last updated» 21 October 2026), linking https://www.cloudflare.com/turnstile-privacy-policy/.

**Why visitors lack a pass — measured, then made visible (2026-11-04).** 24 h of real browsers (robot=0, BotID human):
iPhones carried the pass on 1,125 calls (111 without), desktop on 29 of 1,157, Android on 0 of 433. ezhalah.com is an
accepted hostname (a test widget on ezhalah.com answered 600010 — "looks automated" in our CDP-driven browser — not
110200 "domain not allowed"). The widget's errors used to be swallowed, so every door call now carries
`ezhalah-tsc=<state>` in x-client-info: `wait` (no outcome yet), `ok` (pass minted), `err<code>` (Cloudflare's code),
`srv<status>` (/api/human refused the token), `load` (script never loaded). Read it next to `ts=pass|none` in edge_logs
before deciding the fix. **Do not enforce Turnstile until desktop and Android pass rates are explained and high.**
Barrier: `scripts/verify-turnstile-reports-why.ts`.

## Network guard: no VPN, Tor or server networks (owner 2026-10-21: «aqar and those websites also don't work with VPN»)

- Lists in `ops_network_block`, refreshed daily at 03:41 UTC by **Network guard lists**
  (`.github/workflows/network-block-lists.yml`): Tor exits (check.torproject.org), X4BNet `lists_vpn` VPN and
  datacenter ranges. The X4BNet repository states no license. It is a public list of address ranges (facts) used
  widely for exactly this. If that ever matters, swap the source; nothing else changes.
- Judged in `robot_gate` (migration 20261021224031) **only for visitors the front door vouches for**. Front-door
  traffic reaches Cloudflare from our own server (a datacenter address), so judging that address would block
  everyone. Lookups are fail-open.
- Our own browser robots (GitHub, Google Cloud = datacenter) send `x-ezhalah-robot: <EZ_GATE_SECRET>`. The front
  door turns that into `x-ezhalah-robot: 1` for the database, and they are never judged.
- **`block` since 2026-11-12 10:32 UTC (owner: «VPN block: switch to blocking, with a friendly turn off your VPN
  message»).** Watch mode had counted 2–7 datacenter calls a day and no VPN/Tor; the robots carry the pass and the app's
  NetworkBlockedNotice («فضلاً أوقف الـ VPN») already handles the 403. Undo: set mode back to `watch`.
- **Mode** (`guard.network_block_mode`): was `watch` (count only, in `ops_network_block_hits`, POST/RPC calls),
  then `block` (HTTP 403 «This network is not supported», with a message to turn the VPN off), or `off`.
  Switch: `update guard.network_block_mode set mode = 'block', set_at = now();` (service role / SQL editor).
- Before `block`: (1) a day of `watch` numbers, (2) our Playwright robots that browse the real site send the robot
  pass, (3) the app shows a friendly «turn off your VPN» message on that 403 instead of a generic error.
