"""Regression test for scrapers/wasalt/diagnose_proxy.classify() (owner-requested, 2026-08-24).

Guards against the exact bug this script shipped with on its first draft: classify() defaulted
EVERY single-shot curl_cffi result chain (paths B/C/D, which have no 'dns'/'proxy_tcp' keys of
their own) to DNS_FAIL, because `result_chain.get("dns", {}).get("ok")` reads as falsy when the
"dns" key is simply absent -- not just when DNS genuinely failed. A real SSL/connection-reset
failure on the no-proxy baseline path was misclassified as DNS_FAIL as a result. This test fails
on the old code and passes on the fix."""
from scrapers.wasalt.diagnose_proxy import classify


def test_single_shot_chain_without_staged_keys_is_not_forced_to_dns_fail():
    # This is exactly the shape path_d (direct, no proxy) produces: no "dns"/"proxy_tcp" stages,
    # just a single curl_cffi result. The old code returned "DNS_FAIL" unconditionally here.
    chain = {"curl_cffi_direct": {"ok": False,
                                   "error": "SSLError: Failed to perform, curl: (35) Recv "
                                            "failure: Connection reset by peer."}}
    assert classify(chain) == "TLS_FAILURE"


def test_connect_timeout_is_distinguished_from_tls_failure():
    chain = {"curl_cffi_via_proxy": {"ok": False,
                                      "error": "Timeout: Failed to perform, curl: (28) "
                                               "Connection timed out after 15000 milliseconds."}}
    assert classify(chain) == "CONNECT_TIMEOUT"


def test_could_not_resolve_proxy_is_a_dns_failure_even_though_it_says_proxyerror():
    # curl error 5 ("Couldn't resolve proxy") is fundamentally a DNS failure on the proxy's own
    # hostname, even though curl_cffi wraps it in a ProxyError -- DNS must win this classification.
    chain = {"curl_cffi_via_proxy": {"ok": False,
                                      "error": "ProxyError: Failed to perform, curl: (5) Could "
                                               "not resolve proxy: bad.invalid."}}
    assert classify(chain) == "DNS_FAIL"


def test_proxy_connect_refused_without_resolve_failure_is_proxy_tcp_fail():
    chain = {"curl_cffi_via_proxy": {"ok": False,
                                      "error": "ProxyError: Failed to perform, curl: (7) Could "
                                               "not connect to proxy: connection refused."}}
    assert classify(chain) == "PROXY_TCP_FAIL"


def test_http_status_codes_map_to_named_buckets():
    assert classify({"curl_cffi_via_proxy": {"ok": True, "status_code": 403}}) == "HTTP_403"
    assert classify({"curl_cffi_via_proxy": {"ok": True, "status_code": 429}}) == "HTTP_429"
    assert classify({"curl_cffi_via_proxy": {"ok": True, "status_code": 200}}) == "OK"
    assert classify({"curl_cffi_via_proxy": {"ok": True, "status_code": 503}}) == "HTTP_5XX"


def test_staged_chain_still_reports_a_real_dns_failure_as_dns_fail():
    # Path A DOES have staged keys -- confirm a genuine DNS failure there is still caught.
    chain = {"dns": {"ok": False, "error": "gaierror: Name or service not known"}}
    assert classify(chain) == "DNS_FAIL"


def test_staged_chain_with_dns_ok_but_no_proxy_tcp_key_is_not_misread_as_proxy_fail():
    # A staged chain where DNS succeeded and proxy_tcp simply hasn't been recorded yet must not
    # be misread the same way the original bug misread absent keys as failures.
    chain = {"dns": {"ok": True, "addrs": ["1.2.3.4"]}}
    assert classify(chain) == "UNKNOWN"
