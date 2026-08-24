"""Wasalt ordinary-browser-access discriminator (owner-requested, 2026-08-24).

Answers ONE question: does a stock, unmodified Playwright/Chromium session -- doing nothing an
ordinary user's browser wouldn't also do -- retrieve a real wasalt.sa listing page? See GitHub
issue #1019: curl_cffi (even with Chrome TLS impersonation) and a plain HTTP client both hit
Cloudflare's "Just a moment..." JS challenge or a silent connect timeout, because neither can
execute JavaScript. A real browser executes the page's own JS as intended, which is what
Cloudflare's basic challenge is designed to let through automatically -- that is not a bypass,
it is what "browser" means.

Explicit boundaries (owner-mandated, 2026-08-24):
  - NO stealth/anti-detection patches, NO fingerprint spoofing, NO plugins that hide automation.
    This launches a completely stock Chromium via Playwright's default API.
  - NO interaction with any interactive challenge element (a checkbox, a "verify you are human"
    widget, a CAPTCHA). If the page still shows an interactive challenge after a generous,
    ordinary wait, that is read as FAIL / SOURCE-BLOCKED -- this script clicks nothing.
  - NO CAPTCHA-solving service, NO anti-bot bypass API of any kind.
  - Makes ONE navigation via the proxy path (Ezhalah's normal, necessary network path to a
    Saudi-facing site) and, for context only, ONE secondary navigation with no proxy. Diagnosis
    only -- zero database writes.

Run once via workflow_dispatch. This is the single discriminator the owner asked for; do not turn
this into a loop or a repeated check.
"""
from __future__ import annotations

import json
import os
import sys
import time
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

TARGET_URL = "https://wasalt.sa/en/property/5-bedrooms-duplex-sale-5891944"
NAV_TIMEOUT_MS = 45_000  # generous, ordinary-user-patience wait -- Cloudflare's passive JS
                          # challenge normally clears in ~4-5s for a real browser; this is not
                          # being tuned to force a pass, it just avoids a hair-trigger false FAIL.
CF_CHALLENGE_TITLE_MARKERS = ("just a moment", "attention required", "checking your browser")
CF_INTERACTIVE_MARKERS = (  # if any of these appear, STOP -- do not interact, classify as FAIL
    "cf-turnstile", "g-recaptcha", "h-captcha", "verify you are human", "i am human",
)


def proxy_dict_for_playwright(purl: str) -> dict | None:
    if not purl:
        return None
    u = urlsplit(purl)
    server = f"{u.scheme}://{u.hostname}:{u.port}"
    d = {"server": server}
    if u.username:
        d["username"] = u.username
    if u.password:
        d["password"] = u.password
    return d


def run_one(playwright, *, use_proxy: bool, proxy_conf: dict | None) -> dict:
    t0 = time.monotonic()
    browser = playwright.chromium.launch(headless=True)  # stock launch, no extra flags
    context_kwargs = {}
    if use_proxy and proxy_conf:
        context_kwargs["proxy"] = proxy_conf
    context = browser.new_context(**context_kwargs)
    page = context.new_page()
    result: dict = {"use_proxy": use_proxy, "target_url": TARGET_URL}
    try:
        response = page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        result["initial_status"] = response.status if response else None

        # Ordinary wait for whatever the page's own JS does on load (a real user's browser would
        # do exactly this -- no interaction, just time passing). Not a challenge-solving routine.
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass  # a page that never goes idle (e.g. polling widgets) isn't a failure by itself

        title = (page.title() or "").strip()
        content = page.content()
        final_url = page.url

        title_lower = title.lower()
        content_lower = content.lower()

        result["final_url"] = final_url
        result["title"] = title
        result["is_cf_challenge_title"] = any(m in title_lower for m in CF_CHALLENGE_TITLE_MARKERS)
        result["has_interactive_challenge_marker"] = any(
            m in content_lower for m in CF_INTERACTIVE_MARKERS)
        # Loose, selector-free signal that REAL listing content rendered: wasalt's own branding
        # plus a price-shaped string (SAR or the Arabic ريال). Not exact DOM knowledge, but
        # sufficient to distinguish "a real property page" from "an interstitial".
        result["looks_like_real_listing"] = (
            ("wasalt" in content_lower)
            and (" sar" in content_lower or "ريال" in content or "sar " in content_lower)
            and not result["is_cf_challenge_title"]
        )
        result["content_length"] = len(content)
        result["body_excerpt"] = content[:600]
        result["ms"] = round((time.monotonic() - t0) * 1000, 1)
        result["ok"] = True
    except Exception as e:
        result["ok"] = False
        result["error"] = f"{type(e).__name__}: {e}"
        result["ms"] = round((time.monotonic() - t0) * 1000, 1)
    finally:
        context.close()
        browser.close()
    return result


def classify(result: dict) -> str:
    if not result.get("ok"):
        return "NAV_FAILED"
    if result.get("has_interactive_challenge_marker"):
        return "INTERACTIVE_CHALLENGE_PRESENT_NOT_ATTEMPTED"  # deliberately not clicked/solved
    if result.get("is_cf_challenge_title"):
        return "CF_CHALLENGE_NOT_CLEARED"
    if result.get("looks_like_real_listing"):
        return "REAL_CONTENT_LOADED"
    return "INCONCLUSIVE"


def main() -> int:
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    proxy_conf = proxy_dict_for_playwright(purl)

    with sync_playwright() as p:
        print("=== PRIMARY: via WASALT_PROXY_URL (Ezhalah's normal network path) ===", flush=True)
        primary = run_one(p, use_proxy=True, proxy_conf=proxy_conf)
        primary_class = classify(primary)
        print(json.dumps({k: v for k, v in primary.items() if k != "body_excerpt"}, indent=2),
              flush=True)
        print(f"PRIMARY_CLASSIFICATION  {primary_class}", flush=True)

        print("\n=== SECONDARY (context only): direct, no proxy ===", flush=True)
        secondary = run_one(p, use_proxy=False, proxy_conf=None)
        secondary_class = classify(secondary)
        print(json.dumps({k: v for k, v in secondary.items() if k != "body_excerpt"}, indent=2),
              flush=True)
        print(f"SECONDARY_CLASSIFICATION  {secondary_class}", flush=True)

    verdict = "PASS" if primary_class == "REAL_CONTENT_LOADED" else "FAIL"
    print("\n=== VERDICT ===")
    print(json.dumps({
        "PLAYWRIGHT_NORMAL_BROWSER_ACCESS": verdict,
        "primary_classification (via proxy -- the production-relevant path)": primary_class,
        "secondary_classification (no proxy, context only)": secondary_class,
        "SOURCE_BLOCKED": "NO" if verdict == "PASS" else "YES",
    }, indent=2))

    print("\n=== FULL REPORT (JSON, includes body excerpts) ===")
    print(json.dumps({"primary": primary, "secondary": secondary}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
