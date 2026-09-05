"""sadin's new-gallery photo pass must NEVER sweep a video's /display URL into photo_urls.

The defect this pins, found live 2026-09-05: newer detail pages moved the gallery to
/media/property-assets/{PID}/{32-hex}/display?v=N — extensionless, so the legacy
.png/.jpe?g/.webp regex scored 0 hits on 4/4 sampled pages with 17-21 photos each. The trap in
the fix: each video's own /display?v=N URL is embedded as `<source src="..." type="video/mp4">`
(live-verified: 200 video/mp4, 97MB), so a bare `src=` match would store a 97MB video as a photo
— a WRONG image, which the house rules rank worse than a missing one. The pass therefore matches
ONLY `<img src=` / `data-gallery-item=` attributes AND excludes any 32-hex hash that also emits a
/poster? URL (every video asset does). Also pinned: pid-anchoring (a related-listings block must
never donate photos), source gallery order (hero first — equals og:image on both verified
listings, 3MJ6E=18 and QMWAU=15 photos), the apex-host prefix (www. 308-redirects these), the
widened legacy fallback (the JSON-LD image is an ABSOLUTE main.png URL the old leading-"/" regex
missed), and no-photos → EMPTY list (never a substitute).
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.sadin.run import BASE, _photos  # noqa: E402

PID = "3MJ6E"
H_HERO = "a" * 32
H_TH1 = "b" * 32
H_TH2 = "c" * 32
H_VID = "d" * 32

NEW_PAGE = f"""
<script type="application/ld+json">{{"image": "https://sadin.com.sa/media/properties/{PID}/main.png"}}</script>
<img src="/media/property-assets/{PID}/{H_HERO}/display?v=6" alt="">
<video poster="/media/property-assets/{PID}/{H_VID}/poster?v=2">
  <source src="/media/property-assets/{PID}/{H_VID}/display?v=2" type="video/mp4">
</video>
<div data-gallery-item="/media/property-assets/{PID}/{H_TH1}/display?v=1"></div>
<div data-gallery-item="/media/property-assets/{PID}/{H_TH2}/display?v=3"></div>
<a href="/property/ZZZZZ"><img src="/media/property-assets/ZZZZZ/{'e' * 32}/display?v=1"></a>
"""

got = _photos(NEW_PAGE, PID)
# 1. THE REASON THIS FILE EXISTS: the video's own /display URL must not be in photo_urls —
#    neither via its <source src= (attribute anchoring) nor any other reference (poster-hash ban).
assert not any(H_VID in u for u in got), f"video display URL captured as a photo: {got}"
# 2. Per-listing binding: the related listing's pid-anchored asset never leaks in.
assert not any("ZZZZZ" in u for u in got), f"related-listing photo leaked: {got}"
# 3. Source gallery order, hero (the <img>, = og:image) first; apex host, not the www BASE.
assert got == [f"https://sadin.com.sa/media/property-assets/{PID}/{h}/display?v={v}"
               for h, v in ((H_HERO, 6), (H_TH1, 1), (H_TH2, 3))], got
# 4. New pass hit → the legacy JSON-LD main.png (the same hero) must NOT be appended too.
assert not any(u.endswith("main.png") for u in got), f"hero duplicated via legacy main.png: {got}"

# 5. Legacy fallback still works, now including the ABSOLUTE-URL JSON-LD form, main.png first,
#    host normalized so relative + absolute references to the same file dedupe to one URL.
OLD_PAGE = f"""
<script type="application/ld+json">{{"image": "https://sadin.com.sa/media/properties/{PID}/main.png"}}</script>
<img src="/media/properties/{PID}/g2.webp">
<img src="/media/properties/{PID}/main.png">
<img src="/static/logo.png">
"""
got = _photos(OLD_PAGE, PID)
assert got == [f"{BASE}/media/properties/{PID}/main.png",
               f"{BASE}/media/properties/{PID}/g2.webp"], got

# 6. A page publishing no photos keeps an EMPTY list — fewer images, never a wrong one.
assert _photos("<html><body>no gallery here</body></html>", PID) == []

print("ok: sadin new-gallery pass excludes video /display URLs, binds per-pid, keeps source order")
