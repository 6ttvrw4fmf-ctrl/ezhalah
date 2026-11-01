"""Every Python caller of OUR database with the public key carries the handshake AND its visible tag (backlog 817).

The anon path (af_score.anon_client, used by af_score and af_robot) sent x-ezhalah-gate but the API logs only keep
x-client-info, which supabase-py drops when custom headers are given, so ~950 gated calls a day read as bare-key
calls. This test executes the header builder and discovers, by shape, any other scrapers/ module that reads the
public key without going through it.
"""
import pathlib
import re

from scrapers.common import af_score

ROOT = pathlib.Path(__file__).resolve().parents[3]


def test_anon_client_sends_secret_and_visible_tag(monkeypatch):
    """EXECUTES anon_client() against a stub create_client and reads the headers it really hands over."""
    import sys
    import types

    seen = {}

    class _Opts:
        def __init__(self, headers):
            seen["headers"] = headers

    fake = types.ModuleType("supabase")
    fake.create_client = lambda url, key, options=None: options
    lib = types.ModuleType("supabase.lib")
    co = types.ModuleType("supabase.lib.client_options")
    co.SyncClientOptions = _Opts
    monkeypatch.setitem(sys.modules, "supabase", fake)
    monkeypatch.setitem(sys.modules, "supabase.lib", lib)
    monkeypatch.setitem(sys.modules, "supabase.lib.client_options", co)
    monkeypatch.setenv("SUPABASE_URL", "https://aannarbkwcymrotzwdbo.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "k")
    monkeypatch.setenv("EZ_GATE_SECRET", "s3cret")
    af_score.anon_client()
    assert seen["headers"]["x-ezhalah-gate"] == "s3cret"
    assert "ezhalah-gate" in seen["headers"]["X-Client-Info"]


def test_mutation_tagless_headers_are_caught():
    tagless = {"x-ezhalah-gate": "s3cret"}
    assert "ezhalah-gate" not in tagless.get("X-Client-Info", "")


_PUBLIC_KEY = re.compile(r"SUPABASE_ANON_KEY|EXPO_PUBLIC_SUPABASE_KEY|sb_publishable_")


def test_every_public_key_reader_in_scrapers_uses_the_gated_client():
    readers = [
        p for p in ROOT.joinpath("scrapers").rglob("*.py")
        if "tests" not in p.parts and _PUBLIC_KEY.search(p.read_text(encoding="utf-8", errors="ignore"))
    ]
    bare = [str(p.relative_to(ROOT)) for p in readers
            if "GATE_TAG" not in p.read_text(encoding="utf-8", errors="ignore")]
    assert readers, "discovery found nothing: the pattern is broken"
    assert not bare, f"reads the public key without the gate tag: {bare}"
