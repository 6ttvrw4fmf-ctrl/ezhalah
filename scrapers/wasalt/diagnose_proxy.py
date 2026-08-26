"""Wasalt proxy failure-layer discriminator (owner-requested, 2026-08-24).

Diagnosis ONLY — makes exactly ONE request per stage against ONE real listing URL. Never writes
to the database, never touches scrape_runs/listings, never prints the proxy credentials (only the
proxy's hostname + a short one-way hash of the full URL, so the owner can compare it against the
DataImpulse dashboard without this script ever revealing the secret).

Context: wasalt scrape_runs' failure rate stepped from 0-1% to 57-68% on 2026-08-17 and has stayed
there through a concurrency-cap fix (#827, #1020) and a claimed proxy rotation (2026-08-24), both
of which left the failure rate unchanged (see GitHub issue #1019). Every failure observed so far
is `curl: (28) Connection timed out after 15000ms` -- a connection-layer failure, never an HTTP
response. This script exists to find out which layer actually dies:

    DNS -> proxy TCP connect -> CONNECT tunnel to wasalt.sa -> TLS handshake -> HTTP response

and separately, whether the failure follows the scraper's TLS/JA3 impersonation ("chrome124" via
curl_cffi) or happens identically with a plain, non-impersonated TLS client -- which discriminates
"wasalt fingerprints our client" from "wasalt/the pool blocks by IP regardless of client".

Run once, manually, via the `wasalt-proxy-diagnostic.yml` workflow_dispatch. Never loop this.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import ssl
import sys
import time
from urllib.parse import urlsplit

from curl_cffi import requests as cc

TARGET_URL = "https://wasalt.sa/en/property/5-bedrooms-duplex-sale-5891944"
TARGET_HOST = "wasalt.sa"
TARGET_PATH = "/en/property/5-bedrooms-duplex-sale-5891944"
IP_ECHO_URL = "http://ip-api.com/json"  # plain HTTP so the proxy tunnel/TLS steps aren't required
CONNECT_TIMEOUT = 15


def redact_proxy_url(purl: str) -> dict:
    """Never returns the secret. Only the host/port + a short fingerprint hash, so the owner can
    compare this run's proxy identity against the DataImpulse dashboard without this script ever
    printing (or this log ever storing) the actual credentials."""
    u = urlsplit(purl)
    return {
        "scheme": u.scheme,
        "host": u.hostname,
        "port": u.port,
        "has_auth": bool(u.username or u.password),
        "url_sha256_12": hashlib.sha256(purl.encode()).hexdigest()[:12],
    }


def stage_dns(host: str) -> dict:
    t0 = time.monotonic()
    try:
        infos = socket.getaddrinfo(host, None)
        addrs = sorted({i[4][0] for i in infos})
        return {"ok": True, "addrs": addrs, "ms": round((time.monotonic() - t0) * 1000, 1)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "ms": round((time.monotonic() - t0) * 1000, 1)}


def stage_proxy_tcp(host: str, port: int) -> dict:
    t0 = time.monotonic()
    try:
        sock = socket.create_connection((host, port), timeout=CONNECT_TIMEOUT)
        return {"ok": True, "ms": round((time.monotonic() - t0) * 1000, 1), "_sock": sock}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "ms": round((time.monotonic() - t0) * 1000, 1)}


def stage_connect_tunnel(sock: socket.socket, proxy_user: str | None, proxy_pass: str | None,
                          target_host: str, target_port: int) -> dict:
    """Issues a raw HTTP CONNECT through the proxy socket to target_host:target_port. Tests
    whether the PROXY ITSELF can reach wasalt.sa at the TCP layer -- independent of TLS/HTTP."""
    t0 = time.monotonic()
    try:
        req = f"CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n"
        if proxy_user or proxy_pass:
            import base64
            cred = base64.b64encode(f"{proxy_user or ''}:{proxy_pass or ''}".encode()).decode()
            req += f"Proxy-Authorization: Basic {cred}\r\n"
        req += "\r\n"
        sock.settimeout(CONNECT_TIMEOUT)
        sock.sendall(req.encode())
        resp = sock.recv(4096)
        status_line = resp.split(b"\r\n", 1)[0].decode(errors="replace")
        ok = b" 200 " in resp.split(b"\r\n", 1)[0]
        return {"ok": ok, "status_line": status_line,
                "ms": round((time.monotonic() - t0) * 1000, 1)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "ms": round((time.monotonic() - t0) * 1000, 1)}


def stage_tls_plain(sock: socket.socket, server_hostname: str) -> dict:
    """Plain Python ssl (NOT browser-impersonated) TLS handshake over the already-tunnelled
    socket. This is the fingerprint CONTROL -- Python's default OpenSSL ClientHello looks nothing
    like Chrome's, so if this succeeds where curl_cffi (chrome124 impersonation) fails, that is
    real evidence for a TLS/JA3 fingerprint block rather than an IP block."""
    t0 = time.monotonic()
    try:
        ctx = ssl.create_default_context()
        tls_sock = ctx.wrap_socket(sock, server_hostname=server_hostname)
        cipher = tls_sock.cipher()
        return {"ok": True, "ms": round((time.monotonic() - t0) * 1000, 1),
                "cipher": cipher[0] if cipher else None, "_tls_sock": tls_sock}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "ms": round((time.monotonic() - t0) * 1000, 1)}


def stage_http_plain(tls_sock: ssl.SSLSocket, host: str, path: str) -> dict:
    """Raw HTTP/1.1 GET over the already-established plain-TLS socket -- no curl_cffi, no browser
    impersonation, minimal headers. Reports status code + a body signature if any bytes arrive."""
    t0 = time.monotonic()
    try:
        req = (f"GET {path} HTTP/1.1\r\nHost: {host}\r\n"
               f"User-Agent: ezhalah-diagnostic/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n")
        tls_sock.settimeout(CONNECT_TIMEOUT)
        tls_sock.sendall(req.encode())
        chunks = []
        try:
            while True:
                b = tls_sock.recv(4096)
                if not b:
                    break
                chunks.append(b)
                if sum(len(c) for c in chunks) > 20000:  # enough to see status + a body signature
                    break
        except socket.timeout:
            pass
        raw = b"".join(chunks)
        ttfb_ms = round((time.monotonic() - t0) * 1000, 1)
        if not raw:
            return {"ok": False, "error": "empty response (0 bytes)", "ms": ttfb_ms}
        status_line = raw.split(b"\r\n", 1)[0].decode(errors="replace")
        body_sig = raw[-400:].decode(errors="replace") if len(raw) > 400 else raw.decode(errors="replace")
        return {"ok": True, "status_line": status_line, "ms": ttfb_ms,
                "bytes_received": len(raw), "body_signature": body_sig[:300]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "ms": round((time.monotonic() - t0) * 1000, 1)}


def stage_curl_cffi(url: str, proxies: dict | None, impersonate: str | None, timeout: int) -> dict:
    """The scraper's actual stack (or, with impersonate=None, curl_cffi's default TLS -- a second,
    independent fingerprint control that doesn't require the raw-socket path above)."""
    t0 = time.monotonic()
    try:
        kwargs = {"timeout": timeout}
        if proxies:
            kwargs["proxies"] = proxies
        s = cc.Session(impersonate=impersonate) if impersonate else cc.Session()
        r = s.get(url, **kwargs)
        ms = round((time.monotonic() - t0) * 1000, 1)
        return {"ok": True, "status_code": r.status_code, "ms": ms,
                "bytes_received": len(r.content or b""),
                "body_signature": (r.text or "")[:300]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "ms": round((time.monotonic() - t0) * 1000, 1)}


def _classify_error_text(err: str) -> str:
    """Maps a curl_cffi/requests exception string into a layer bucket. Used for the single-shot
    curl_cffi paths (B/C/D), which don't have per-stage DNS/TCP/TLS results of their own -- only
    Path A (the raw socket discriminator) gets that granularity directly."""
    e = err.lower()
    if "could not resolve" in e:
        return "DNS_FAIL"
    if "proxyerror" in e or "could not connect to proxy" in e:
        return "PROXY_TCP_FAIL"
    if "ssl" in e or "tls" in e or "certificate" in e:
        return "TLS_FAILURE"
    if "connection reset" in e:
        return "CONNECTION_RESET"
    if "could not connect" in e or "connection refused" in e:
        return "TCP_FAIL"
    if "empty reply" in e or "empty response" in e:
        return "BODY_INVALID"
    if "timeout" in e or "timed out" in e:
        return "CONNECT_TIMEOUT"
    return "HTTP_LAYER_FAIL"


def _classify_status(code) -> str:
    try:
        code = int(code)
    except (TypeError, ValueError):
        return "HTTP_STATUS_UNKNOWN"
    if code == 401:
        return "HTTP_401"
    if code == 403:
        return "HTTP_403"
    if code == 429:
        return "HTTP_429"
    if 500 <= code < 600:
        return "HTTP_5XX"
    if code == 200:
        return "OK"
    return f"HTTP_{code}"


def classify(result_chain: dict) -> str:
    """Maps the deepest stage reached into one bucket. This is exactly the classification the
    owner asked for so future failures don't collapse into a single generic 'blocked/transient'.
    Only applies the DNS/proxy_tcp/tunnel/tls staged checks when this chain actually HAS those
    stages (Path A); single-shot curl_cffi chains (B/C/D) fall straight to error-text/status
    classification instead of being misread as a missing DNS stage."""
    has_staged = "dns" in result_chain or "proxy_tcp" in result_chain
    if has_staged:
        if not result_chain.get("dns", {}).get("ok", True):
            return "DNS_FAIL"
        if not result_chain.get("proxy_tcp", {}).get("ok", True):
            return "PROXY_TCP_FAIL"
        if "connect_tunnel" in result_chain and not result_chain["connect_tunnel"].get("ok"):
            return "PROXY_TUNNEL_FAIL"  # proxy reachable, but it can't reach wasalt.sa itself
        if "tls" in result_chain and not result_chain["tls"].get("ok"):
            return "TLS_FAILURE"

    http = (result_chain.get("http_plain") or result_chain.get("curl_cffi_via_proxy")
            or result_chain.get("curl_cffi_no_impersonation") or result_chain.get("curl_cffi_direct"))
    if not http:
        return "UNKNOWN"
    if not http.get("ok"):
        return _classify_error_text(str(http.get("error", "")))
    code = http.get("status_code")
    if code is None and http.get("status_line"):
        parts = http["status_line"].split()
        code = parts[1] if len(parts) > 1 else None
    return _classify_status(code)


def main() -> int:
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    report: dict = {"target_url": TARGET_URL, "purl_present": bool(purl)}

    if not purl:
        print(json.dumps({"error": "WASALT_PROXY_URL not set in this environment"}, indent=2))
        return 1

    u = urlsplit(purl)
    proxy_host, proxy_port = u.hostname, u.port or (443 if u.scheme == "https" else 80)
    report["proxy_identity"] = redact_proxy_url(purl)

    # ---- Path A: raw layered discriminator (plain, non-impersonated TLS client) ----
    chain_a: dict = {}
    chain_a["dns"] = stage_dns(proxy_host)
    print("DNS  ", json.dumps(chain_a["dns"]), flush=True)

    tcp = stage_proxy_tcp(proxy_host, proxy_port)
    sock = tcp.pop("_sock", None)
    chain_a["proxy_tcp"] = tcp
    print("PROXY_TCP  ", json.dumps(tcp), flush=True)

    if sock:
        tunnel = stage_connect_tunnel(sock, u.username, u.password, TARGET_HOST, 443)
        chain_a["connect_tunnel"] = tunnel
        print("CONNECT_TUNNEL  ", json.dumps(tunnel), flush=True)

        if tunnel.get("ok"):
            tls = stage_tls_plain(sock, TARGET_HOST)
            tls_sock = tls.pop("_tls_sock", None)
            chain_a["tls"] = tls
            print("TLS_PLAIN  ", json.dumps(tls), flush=True)

            if tls_sock:
                http_plain = stage_http_plain(tls_sock, TARGET_HOST, TARGET_PATH)
                chain_a["http_plain"] = http_plain
                print("HTTP_PLAIN  ", json.dumps({k: v for k, v in http_plain.items()
                                                   if k != "body_signature"}), flush=True)
                try:
                    tls_sock.close()
                except Exception:
                    pass
        try:
            sock.close()
        except Exception:
            pass

    chain_a["classification"] = classify(chain_a)
    report["path_a_raw_plain_client_via_proxy"] = chain_a

    # ---- Path B: the scraper's actual stack (curl_cffi, chrome124 impersonation) via proxy ----
    proxies = {"http": purl, "https": purl}
    curl_result = stage_curl_cffi(TARGET_URL, proxies, "chrome124", CONNECT_TIMEOUT)
    chain_b = {"curl_cffi_via_proxy": curl_result}
    chain_b["classification"] = classify(chain_b)
    report["path_b_curl_cffi_chrome124_via_proxy"] = chain_b
    print("CURL_CFFI_CHROME124  ", json.dumps({k: v for k, v in curl_result.items()
                                                if k != "body_signature"}), flush=True)

    # ---- Path C: curl_cffi WITHOUT impersonation via proxy -- a second fingerprint control ----
    curl_plain = stage_curl_cffi(TARGET_URL, proxies, None, CONNECT_TIMEOUT)
    chain_c = {"curl_cffi_no_impersonation": curl_plain}
    chain_c["classification"] = classify(chain_c)
    report["path_c_curl_cffi_no_impersonation_via_proxy"] = chain_c
    print("CURL_CFFI_PLAIN  ", json.dumps({k: v for k, v in curl_plain.items()
                                            if k != "body_signature"}), flush=True)

    # ---- Path D: direct, no proxy -- baseline sanity check only (GH runner IP, not Saudi) ----
    direct = stage_curl_cffi(TARGET_URL, None, "chrome124", CONNECT_TIMEOUT)
    report["path_d_direct_no_proxy_baseline"] = {"curl_cffi_direct": direct,
                                                  "classification": classify({"curl_cffi_via_proxy": direct})}
    print("DIRECT_NO_PROXY  ", json.dumps({k: v for k, v in direct.items()
                                            if k != "body_signature"}), flush=True)

    # ---- Path E: exit IP/ASN/country currently observed through the proxy (plain HTTP, cheap) ----
    ip_echo = stage_curl_cffi(IP_ECHO_URL, proxies, None, 10)
    report["observed_exit"] = ip_echo

    print("\n=== SUMMARY ===")
    print(json.dumps({
        "path_a_classification": chain_a["classification"],
        "path_b_classification (scraper's real stack)": chain_b["classification"],
        "path_c_classification (curl_cffi, no impersonation)": chain_c["classification"],
        "path_d_classification (direct, no proxy)": report["path_d_direct_no_proxy_baseline"]["classification"],
        "proxy_identity": report["proxy_identity"],
        "observed_exit_ok": ip_echo.get("ok"),
        "observed_exit_body": ip_echo.get("body_signature") if ip_echo.get("ok") else ip_echo.get("error"),
    }, indent=2, ensure_ascii=False))

    print("\n=== FULL REPORT (JSON) ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
