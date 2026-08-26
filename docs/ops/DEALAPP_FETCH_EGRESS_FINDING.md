# Deal App detail fetches: the shell response is an EGRESS effect, and it is permanent

**Status: root cause established and measured. NOT fixed — the fix is an owner provider decision.**
**Investigated 2026-08-26. No listing has been deactivated. No liveness policy exists or was changed.**

## The finding, in one line

`dealapp.sa` serves a data-bearing detail page to ordinary networks and a **permanently** listing-less
page to GitHub Actions egress, for the **same ids, at the same moment**. Roughly **78–83%** of ids are
affected from a runner versus **~11%** off-runner. Nothing about our client, our request volume, or the
listings themselves explains it.

**Therefore `last_seen_at` for dealapp is not a liveness signal.** ~75% of dealapp "not seen at source"
is a false negative manufactured by where the job runs. No age-based, staleness-based or
"not seen" removal policy can be built on it, and none has been.

## What the failure actually looks like

Every production failure — ~900 of ~1,200 attempted per shard, on all 12 shards — lands in exactly
**one** bucket: `status_200_no_listing_schema:same_url_ng_state_no_schema`
(`scrape_runs.notes`, persisted since 2026-08-12).

That bucket means: HTTP 200, no redirect, and the Angular `ng-state` block **fully hydrated** — but
with no `real-estate-listing` key inside `schemaMarkupScripts`. Zero `redirected_away`, zero
`same_url_no_ng_state`. There is no block page, no challenge, no rate-limit response, no 4xx.

It is byte-for-byte the shape a **genuinely nonexistent ad id** returns. That is what made this
unfalsifiable from the outside for so long, and it is why every earlier verdict was wrong.

## The measurements (all reproducible via `.github/workflows/dealapp-fetch-diagnostic.yml`)

| # | probe | result | what it eliminated |
|---|---|---|---|
| 1 | 4 client variants × 4 **hand-picked** ids ([32998202697](https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/32998202697)) | all 4 pass | **nothing — the sample was invalid** (see below) |
| 2 | `--volume 600` sitemap ids ([32999375439](https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/32999375439)) | **88.0% shell, FLAT** across all 10 deciles (81.7/80.0/96.7/80.0/95.0/83.3/91.7/91.7/85.0/95.0) | **sustained volume** — the rate does not climb with request index |
| 3 | `--population 60`, 5 clients, same runner, same ids ([33000533871](https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/33000533871)) | A 78.3 / B 78.3 / C 78.3 / D 78.3 / **E-system-`curl` 83.3** | **the client** — TLS fingerprint, headers, HTTP library, even the binary |
| 3b | same 60 ids, same `curl` binary, **off-runner** | **11.7% shell** | isolates the one remaining variable: **egress** |
| 4 | `--retry 60`, re-request the shells at 5 s / 15 s / 45 s / 120 s ([33001226104](https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/33001226104)) | 49 shells, **0 recovered in every round**; control **10/10** | **cold render / transient** — the shell is permanent per id |
| 4b | the 7 off-runner shells, re-requested | **7/7 recovered immediately** | confirms transience exists off-runner but not on it |

Probe 3's four curl_cffi variants failed on **exactly 47 of 60 each** — identical counts, not a
spread. The failure is **deterministic per id**, which is what motivated probe 4.

## Why probe 1's verdict was wrong, and the rule that follows

Probe 1 tested four ids that had **already been confirmed alive**. Such ids return a data-bearing page
from every client on every network, so the probe could only ever produce a pass. It reported "client
and egress both exonerated" and sent the investigation to chase volume for an entire cycle.

> **Rule: never diagnose this on a hand-picked sample.** A sample drawn from ids already known to be
> alive cannot fail, so it cannot discriminate anything. Draw the population from dealapp's own
> sitemap (`--volume` / `--population` / `--retry` all do), and keep fixed ids only as controls —
> notably the bogus id, which must always come back with no listing schema.

## What is NOT the cause

Ruled out by measurement, not by argument: the parser; the classifier; the TLS impersonation profile;
request headers; the HTTP library; the `curl` binary; sustained volume; concurrency; time of day;
the URL form (`https://dealapp.sa/ar/ad-details/{id}`, confirmed against the sitemap's own `<loc>`);
and transient/cold rendering.

The listings themselves are also not the cause: every id probed comes from dealapp's own sitemap, so
the source publishes it as live, and the off-runner control retrieves the full schema for ~89% of them.

## What remains, and why this file stops here

The only surviving variable is the **network egress identity of the GitHub Actions runner**.

Changing it means routing dealapp through a proxy — a **real external-provider and compliance
decision**, and one this investigation is explicitly not authorised to take
(`docs/ops/AGENT_AUTHORITY.md` RED list: business decisions, anything not easily reversible). It is
also **not** to be folded into the Wasalt proxy question: that is a separate frozen investigation with
a separate provider, and combining them was ruled out by the owner on 2026-08-26.

There is no scraper-side fix. Probe 4 closes that door: retries cannot recover a response that is
permanent, and production's `fetch_one` already makes 3 attempts.

## Standing constraints while this is unresolved

1. **Do not treat "not seen at source" as evidence a dealapp listing is gone.** It is ~75% false
   negative from CI. This is the whole reason no removal policy has been created.
2. **Do not silence the coverage/staleness barriers to make them green.** They are correctly
   reporting a real fetch shortfall; the shortfall is just not caused by dead inventory.
3. **`dealapp_recover` returning `unknown=N of N` is the expected output**, not a bug in `recover.py` —
   it cannot classify what it cannot fetch. It only ever REACTIVATES, so it is safe as-is.
4. The diagnostic workflow is `workflow_dispatch` only and **must never be put on a schedule**.
