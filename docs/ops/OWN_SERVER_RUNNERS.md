# Running our GitHub Actions on our own server (security plan Phase 2)

Owner-approved plan, 2026-10-20: move CI and robot jobs off GitHub-hosted runners onto one rented server, so that
the repository can then be made **private** (Phase 3) without a GitHub minutes bill. **Nothing is bought until the
owner approves the checkout.** This file is the recipe, the trial checklist and the rollback.

## Why

- The repo is public, so GitHub-hosted minutes are free today. A private repo pays per minute. Measured load:
  ~1,760 workflow runs a day (2026-10-20/21), about 10,000 run-minutes of wall time, more in billed job-minutes. On
  hosted runners that is roughly $2,700–5,400 a month once private.
- One dedicated server runs the same jobs for a fixed monthly price.

Where the time goes (sample of 1,000 runs, 24 h to 2026-10-21): `workflow_dispatch` 44%, `pull_request` 30%,
`push` 12%, `workflow_run` 10%, `schedule` 5%. Biggest single workflows: Full verification (the required `npm test`),
Wasalt enum liveness, AF backend-truth live check, Dealapp liveness, Common location tests, Web runtime smoke.

## The server

**Hetzner AX102** (dedicated: 16 cores / 32 threads, 128 GB RAM, 2 × 1.92 TB NVMe), about **€159/month + €129 one-time
setup**. Confirm the exact price and setup fee on the checkout page before buying. Any Ubuntu 24.04 server of that size
works the same.

It runs **12 runners** at once (2.5 CPU and 9 GB each). Each one runs **one job in a fresh container, then is thrown
away**, so nothing a job leaves behind reaches the next job.

## The switch (already in every workflow)

Every job says:

```yaml
runs-on: ${{ (github.event_name != 'pull_request' && github.event_name != 'pull_request_target' && vars.EZ_RUNNER) || 'ubuntu-latest' }}
```

- **Variable not set (today):** every job runs on GitHub exactly as before.
- **`EZ_RUNNER = ezhalah-own`:** every job except pull-request checks runs on our server.
- **Pull-request checks always stay on GitHub while the repo is public.** On a public repo anyone can open a pull
  request from a fork. GitHub's own guidance is to never run fork code on a self-hosted runner. Phase 3 (private) is
  what makes it safe to move PR checks too (see below).
- `scripts/verify-runner-switch.ts` (in `npm test`) fails if any job hard-codes a runner or if the expression could
  route a pull-request event to our server.

## Setup (about 30 minutes, after the owner buys the server)

1. Create a **fine-grained GitHub token**: only repository `6ttvrw4fmf-ctrl/ezhalah`, permission **Administration: read
   and write** (needed to register runners), expiry 90 days. Put a calendar reminder to renew it.
2. SSH into the new server with the key Hetzner installed, copy `ops/runner/` onto it, then run:
   `OWNER_IP=<your home IP> bash setup.sh` and paste the token when asked.
3. GitHub → Settings → Actions → Runners: 12 runners named `ezhalah-own-…` show **Idle**.
4. GitHub → Settings → Actions → General → "Fork pull request workflows from outside collaborators": set
   **Require approval for all outside collaborators** (defence in depth; PR events already stay on GitHub).

`setup.sh` closes every inbound port except SSH from the owner's IP, turns off password login, turns on automatic
security updates, and never mounts Docker's control socket into a job.

## Trial (48 hours, money-safe)

| step | do | pass when |
|---|---|---|
| 1 | Settings → Secrets and variables → Actions → **Variables** → New: `EZ_RUNNER` = `ezhalah-own` | — |
| 2 | Dispatch one light workflow (e.g. *Migration drift guard*) | it runs on an `ezhalah-own-…` runner and is green |
| 3 | Dispatch one Playwright workflow (e.g. *Web runtime smoke*) | green; browsers install inside the container |
| 4 | Leave it 48 h | failure rate no worse than the 48 h before; no job waits > 10 min in queue; server CPU < 85% |
| 5 | Check the Hetzner bill page | only the server line |

## Rollback (instant)

Delete the `EZ_RUNNER` variable. The next job goes back to GitHub's runners. Nothing else changes. To stop paying,
cancel the server in the Hetzner console. Hetzner bills dedicated servers monthly; read the cancellation terms on the
order page.

## Phase 3, after the trial passes

1. Owner makes the repo **private** (Settings → General → Danger zone).
2. In one PR, drop the two `github.event_name != 'pull_request…'` clauses so PR checks also run on our server, and
   update `scripts/verify-runner-switch.ts` with them. (On a private repo only collaborators can open PRs.)
3. Watch one day of PR checks. If the queue is too long, raise `RUNNERS` in `/opt/ezhalah-runner/.env` and run
   `docker compose up -d`.

## What this does NOT change

- Secrets stay in GitHub Actions secrets. The server stores only the runner token (root-only file).
- Every deploy still goes through `deploy-frontend.yml` → `scripts/safe-deploy.sh` with all of its locks.
- AGENTS.md rule "our own robots must not take production down" applies unchanged. A faster runner fleet is not
  permission to run more sweeps at once.
