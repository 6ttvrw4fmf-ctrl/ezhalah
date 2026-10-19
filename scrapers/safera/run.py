"""Safera — safera.inblaj.net. inblaj.net tenant; the parser lives in scrapers/common/inblaj_platform.py
(one WordPress product, several tenant offices — see that module's header for the measured source
shape and the reasons this is shared rather than copied three times)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common.inblaj_platform import run_platform  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(run_platform(slug="safera", base="https://safera.inblaj.net", source="Safera", prefix="SAF"))
