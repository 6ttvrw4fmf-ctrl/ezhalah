# Verifying production from an agent session

**A `curl` that fails from an agent container is NOT evidence that production is down.**

This document exists because that mistake is easy to make and expensive: a routine that reports
"production unreachable" when it is actually serving traffic normally will trigger an emergency
response for nothing — or worse, prompt a "fix" deploy that was never needed.

## The trap

Agent sessions run inside a sandbox whose outbound network policy allows **only** `api.github.com`
plus the package registries. Everything else is refused at the CONNECT layer, *before* any request
reaches the internet:

```
$ curl -sS https://ezhalah-app.vercel.app
curl: (56) CONNECT tunnel failed, response 403
```

That 403 comes from the local egress proxy. `api.vercel.com` and `*.supabase.co` are blocked the
same way. The site is fine; the container simply cannot dial it.

**Never conclude anything about production health from a `curl` inside an agent session.**

## The two paths that DO work

Both were verified working on 2026-08-04.

### 1. Supabase `net.http_get` (preferred — gives status code and body)

The request originates from Supabase's servers, which have open egress. Run via the Supabase MCP
`execute_sql` tool on project `aannarbkwcymrotzwdbo`:

```sql
-- 1. fire the request; returns a request id
select net.http_get(url := 'https://ezhalah-app.vercel.app', timeout_milliseconds := 20000) as request_id;

-- 2. read the response back (substitute the id from step 1)
select id, status_code, length(content) as bytes,
       substring(content from '_expo/static/js/web/[A-Za-z0-9._-]+\.js') as bundle
from net._http_response where id = <request_id>;
```

A healthy production response looks like `status_code: 200`, ~75 KB, and a
`_expo/static/js/web/entry-<hash>.js` bundle reference.

### 2. Vercel MCP `web_fetch_vercel_url`

```
mcp__Vercel__web_fetch_vercel_url(url: "https://ezhalah-app.vercel.app")
```

Returns the rendered page. Useful as an independent second opinion, and it can reach deployments
behind Vercel Authentication.

## Proving a deploy actually shipped

The bundle hash is the ground truth. Capture it **before** and **after**:

- **hash changed** → the new build is live on the canonical alias
- **hash identical** → nothing shipped, regardless of what any tool reported

`scripts/safe-deploy.sh` already asserts this automatically after `vercel --prod` (via
`dtg_alias_serves`) and FAILS rather than reporting success on an alias that did not move. This
manual check is for confirming after the fact, or when investigating without deploying.

## Checking the pipeline without deploying

`AGENTS.md`: *"Never deploy to test the deployment pipeline."* To confirm the credentials and the
target lock are healthy, dispatch the deploy workflow with **`dry_run: true`**. It verifies the
secrets, authenticates the Vercel token, asserts the target lock and checks the required production
env vars — then stops. The `safe-deploy.sh` step is gated `if: ${{ !inputs.dry_run }}` and
`verify-deploy-workflow-guard.ts` fails CI if that gating is ever removed or inverted.

## Driving the live UI from a cloud routine (browser E2E)

**Real browser E2E against `https://ezhalah-app.vercel.app` IS possible from a cloud container** —
three Search & Matching QA runs (2026-08-11 → 2026-08-13) recorded it as `BLOCKED` and fell back to
API-only verification, which is why this is written down.

Two things have to be right, and the failure they produce is misleading:

1. **Chromium must be pointed at the egress proxy** — `--proxy-server=$HTTPS_PROXY`. Without it,
   navigation fails with `ERR_CONNECTION_RESET` (not a proxy error), which reads like a policy
   denial but is not one.
2. **Chromium must cap TLS at 1.2** — `--ssl-version-max=tls1.2`. The gateway RESETS Chromium's
   TLS 1.3 ClientHello, again surfacing as `ERR_CONNECTION_RESET` *after* a successful `CONNECT`,
   with **nothing** in `curl -sS "$HTTPS_PROXY/__agentproxy/status"` — the proxy's own recent-failure
   list stays empty because from its side the tunnel opened fine. A genuine policy denial looks
   different (`ERR_TUNNEL_CONNECTION_FAILED`, and the host appears in the status endpoint), so the
   two are distinguishable: **reset = transport, tunnel-failed = policy.**

   This caps the TLS version only. Certificate verification stays ON — never pass
   `--ignore-certificate-errors`.

```python
b = await p.chromium.launch(
    headless=True,
    executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",  # pinned; pip's
    args=["--no-sandbox", "--disable-dev-shm-usage",                       # playwright wants a
          "--ssl-version-max=tls1.2",                                      # newer build than the
          f"--proxy-server={os.environ['HTTPS_PROXY']}",                   # image ships
          "--disable-background-networking"])
```

Do **not** run `playwright install` — the image pre-installs browsers under
`/opt/pw-browsers`, and a `pip install playwright` will pull a version whose expected build number
does not match, so pass `executable_path` explicitly.

Two behaviours to expect once it runs, both normal:

- **The results list is virtualised.** Cards unmount as they leave the viewport, so counting what is
  in the DOM at one scroll position undercounts. Scroll the whole list and accumulate by the card's
  «#N» rank badge — that badge is the reliable per-card anchor.
- **Card display order is NOT the RPC row order.** `orderByScope()` in `src/data/remote.ts`
  re-orders for geography/type diversification after the RPC's platform round-robin. Comparing card
  #N to RPC row N therefore produces false mismatches; compare the displayed SET against the
  eligible SET instead, and assert rank contiguity (no gaps, no duplicates) for pagination.

## Related

- `docs/DEPLOY_SAFETY.md` — deploy rules, the deployment lock, emergency rollback
- `docs/ops/AGENT_AUTHORITY.md` — what a routine may do without asking
- `docs/ops/SEARCH_MATCH_QA_ENGINEER.md` — the Search & Matching QA spec this harness serves
