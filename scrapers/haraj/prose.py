"""Facts of an UNLICENSED Haraj offer, read only from the seller's OWN words (owner 2026-10-17: «all real-estate
offers», reversing 10-16's licensed-only). A post with REGA's licence block is read by parse.py as before; a
post without one has no structured fields at all (its JSON-LD carries the title, the body — often empty — and
the city), so every fact here is a phrase the seller wrote, and every rule below says NULL rather than guess:

  price   only a number TIED to a price word («السعر», «سعر», «بسعر», «المطلوب», «الايجار», «القيمة», «بـ»),
          units scaled («الف» ×1,000, «مليون» ×1,000,000); a bid («السوم», «على السوم», «سوم») is NO price;
          two different figures, a range («من … إلى …»), a deposit / commission / instalment → NULL;
          a phone number, a year, a count («بـ 3 غرف») is never a price.
  period  from the same phrase («شهري», «سنوي», «يومي»); silent → the repo's judge-by-price rule (caller).
  area    only an area phrase («مساحة 600 م», «600 متر مربع», «م٢»); two different areas → NULL; a street
          width («شارع 15 م») or a floor count («2 دور») is never an area.
  type    the first property word of the TITLE (our taxonomy); a plural («شقق», «فلل», «اراضي») is several
          units — a catalogue, never stored; two different unit words → NULL (not stored).
  deal    «للبيع» vs «للإيجار»; both → NULL (not stored).
  district only «حي X» resolved through the shared catalogue (caller); two different districts → NULL.
Pure functions — no network, no DB. Pinned by scrapers/common/tests/test_haraj_prose_offers.py.
"""
from __future__ import annotations

import re
from typing import Optional

from scrapers.common import normalize as N

_AR = "ء-ي"
_B = rf"(?<![{_AR}\w])"
_E = rf"(?![{_AR}\w])"
_DIG = str.maketrans("٠١٢٣٤٥٦٧٨٩٫٬", "0123456789.,")


def norm(s: Optional[str]) -> str:
    s = (s or "").translate(_DIG)
    s = re.sub(r"[ً-ْٰـ]", "", s)        # tashkeel + tatweel
    s = re.sub(r"[أإآ]", "ا", s).replace("ى", "ي").replace("ة", "ه")
    s = s.replace("ـ", "")
    return re.sub(r"[ \t]+", " ", s)


# ── deal ──────────────────────────────────────────────────────────────────────────────────────
_SALE = re.compile(_B + r"(?:للبيع|بيع|للبيع)" + _E)
_RENT = re.compile(_B + r"(?:للايجار|ايجار|الايجار|للاجار|اجار|للتاجير|تاجير|للتاجر)" + _E)


def deal_of(title: str, body: str) -> Optional[str]:
    """Buy / Rent from the post's own words; both named → the title decides only if it names one, else None."""
    for txt in (norm(title), norm(f"{title}\n{body}")):
        s, r = bool(_SALE.search(txt)), bool(_RENT.search(txt))
        if s != r:
            return "Buy" if s else "Rent"
        if s and r:
            return None
    return None


# ── type (TITLE first) ────────────────────────────────────────────────────────────────────────
# (pattern, our type) in normalized spelling. Plurals = several units = a catalogue.
_SINGULAR = [
    (r"تاون هاوس", "تاون هاوس"), (r"شقه", "Apartment"), (r"(?:فيلا|فيله|فله)", "Villa"),
    (r"(?:دبلكس|دوبلكس|دوبليكس)", "Duplex"), (r"(?:استديو|ستوديو|استوديو)", "Studio"),
    (r"عماره", "Building"), (r"(?:استراحه)", "Rest House"), (r"شاليه", "Chalet"), (r"مزرعه", "Farm"),
    (r"(?:ارض)", "LAND"), (r"دور", "Floor"), (r"محل", "Shop"), (r"مكتب", "Office"), (r"مستودع", "Warehouse"),
    (r"معرض", "Showroom"), (r"ورشه", "Workshop"), (r"مصنع", "Factory"), (r"فندق", "Hotel"),
    (r"غرفه", "Room"), (r"(?:بيت|منزل|حوش|قصر)", "Villa"),
]
_PLURAL = r"(?:شقق|فلل|اراضي|عمائر|محلات|مكاتب|مستودعات|غرف|استراحات|شاليهات|مزارع|بيوت|ادوار|معارض|استديوهات|استوديوهات)"
_TYPE_RE = re.compile(_B + r"(?:ال|ب|و|لل)?(" + "|".join(p for p, _ in _SINGULAR) + "|" + _PLURAL + r")" + _E)
_INSIDE = re.compile(r"(?:في|ب|داخل|ضمن|بداخل|من|فوق|علي|على)\s*$")


def _type_of_word(w: str) -> Optional[str]:
    for p, t in _SINGULAR:
        if re.fullmatch(p, w):
            return t
    return None


_OFFER_UNIT = re.compile(r"(?:للبيع|للايجار|للاجار|للتاجير)\s+(?:ال)?("
                         + "|".join(p for p, _ in _SINGULAR) + r")" + _E)


def body_offers_several_units(body: Optional[str]) -> bool:
    """The body offers two or more DIFFERENT units («للبيع شاليه … للبيع استراحة بالطائف …», HRJ11190705938,
    backlog 615): a catalogue, whatever the title says. The same unit offered twice («للبيع استراحة … للبيع
    استراحة مميزة», HRJ11190717503) is one unit. Tuned on the 10-17 stored window (1 of 1,156 moves), gated on
    the untouched 10-18 window (0 of 1,249 move; commercial 0 of 154)."""
    types = {_type_of_word(m.group(1)) for m in _OFFER_UNIT.finditer(norm(body))}
    return len(types - {None}) >= 2


def type_of(title: str, body: str) -> tuple[Optional[str], str]:
    """(our type or None, reason). The first unit word of the TITLE (else the body's first) decides; a plural
    first word is a catalogue; a second, different unit word not introduced by «في/ب/داخل…» is ambiguous."""
    if body_offers_several_units(body):
        return None, "catalogue:body"
    for txt in (norm(title), norm(body)):
        hits = list(_TYPE_RE.finditer(txt))
        if not hits:
            continue
        first = hits[0].group(1)
        if re.fullmatch(_PLURAL, first):
            return None, f"catalogue:{first}"
        t = _type_of_word(first)
        for h in hits[1:]:
            w = h.group(1)
            if re.fullmatch(_PLURAL, w):
                continue                     # a count of rooms / floors inside the unit («شقة 4 غرف»)
            t2 = _type_of_word(w)
            if t2 and t2 != t and t2 != "Room" and not _INSIDE.search(txt[:h.start()]):
                return None, f"two unit words:{first}/{w}"
        if t == "LAND":
            com = re.search(r"ارض\s+(?:\S+\s+)?تجاري", txt)
            res = re.search(r"ارض\s+(?:\S+\s+)?سكني", txt)
            agr = re.search(r"ارض\s+(?:\S+\s+)?زراعي", txt)
            if sum(map(bool, (com, res, agr))) == 1:
                t = "Commercial Land" if com else ("Residential Land" if res else "Farm")
            else:
                t = "أرض"                     # usage not stated (or several): the owner's 10-10 «أرض»
        return t, f"type word «{first}»"
    return None, "no unit word"


# ── numbers ───────────────────────────────────────────────────────────────────────────────────
_NUM = r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
_SCALE = r"(?:\s*(الف|الاف|آلاف|ألف|k|K|مليون|ملايين|مليونين))?"
_PHONE = re.compile(r"(?<!\d)(?:\+?966|00966|0)?5\d{8}(?!\d)")


def _value(num: str, scale: Optional[str]) -> Optional[int]:
    try:
        v = float(num.replace(",", ""))
    except ValueError:
        return None
    if scale:
        v *= 1_000_000 if scale.startswith("مليون") or scale == "ملايين" else 1000
    return int(round(v)) if v > 0 else None


# ── price ─────────────────────────────────────────────────────────────────────────────────────
_BID = re.compile(_B + r"(?:السوم|على السوم|سوم|علي السوم|السوم وصل|سومه|سومها)" + _E)
_PRICE_WORD = (r"(?:السعر|سعر|بسعر|السعر المطلوب|المطلوب|الايجار|ايجار|الاجار|اجار|القيمه|بقيمه|قيمه|الثمن|"
               r"بمبلغ|مبلغ)")
_FILLER = (r"(?:\s*[:：\-–=]\s*|\s+)(?:(?:السنوي|الشهري|اليومي|سنوي|شهري|يومي|المطلوب|النهائي|فقط|هو|يبدا من|"
           r"الاجمالي|الكلي|للشقه|للفيلا|للارض|للمحل|للدور|ريال|ر\.?س)\s*[:\-]?\s*){0,3}")
_PRICE_RE = re.compile(_B + r"(?:و|ف)?" + _PRICE_WORD + _FILLER + _NUM + _SCALE)
# «بـ 3000», «ب3000 شهري», «بـ 250 الف»: the bare preposition is weak, so it needs a unit, a currency or a period.
_BI_RE = re.compile(r"(?<![" + _AR + r"\w])(?:ب|للايجار|للاجار|للبيع|للتاجير)\s?" + _NUM + _SCALE)
# «سعر المتر 1200», «المتر بـ 900», «1200 للمتر»: the metre rate (kept only for land, by the caller)
_PPM_RE = re.compile(r"(?:سعر\s*(?:ال)?متر|(?<![" + _AR + r"])المتر\s*(?:ب|بـ)?)\s*[:\-]?\s*" + _NUM + _SCALE)
_MILLION_WORD = re.compile(_B + _PRICE_WORD + r"(?:\s*[:\-]\s*|\s+)(?:فقط\s+)?(مليون|مليونين)(\s*(?:ونص|ونصف))?" + _E)
# what may follow the figure for it to be a price: a currency, a period, punctuation or the end — never a noun
_NOT_A_PRICE_AFTER = re.compile(r"^\s*(?:غرف|غرفه|غرفتين|دور|ادوار|شقق|شقه|متر|م2|م²|م\b|م$|حمام|دورات|دوره|سنوات|سنه|"
                                r"سنين|عام|شارع|كيلو|كم|دقائق|دقيقه|ساعات|ساعه|نفر|اشخاص|شخص|سيارات|مواقف|"
                                r"هـ|ه\b|مراحل|دفعات|اقساط|يوم|ايام|شهور|اشهر)")
# a deposit / commission / instalment / income word RIGHT before the figure (or its price word) is not the price
_NOT_PRICE_BEFORE = re.compile(r"(?:عربون|العربون|تامين|التامين|ضمان|عموله|العموله|سعي|السعي|قسط|القسط|اقساط|دفعه اولي|"
                               r"الدفعه الاولي|دفعه|مقدم|المقدم|خصم|الدخل|دخل|عداد|فاتوره|رسوم|ضريبه|الضريبه)"
                               r"\s*(?:[:\-]|مبلغ|قدره|بقيمه|بمبلغ)?\s*$")
_PERIOD = [("monthly", re.compile(_B + r"(?:شهري|شهريا|بالشهر|في الشهر|الشهري|للشهر|شهر)" + _E)),
           ("annual", re.compile(_B + r"(?:سنوي|سنويا|بالسنه|في السنه|السنوي|للسنه|سنه|دفعتين|دفعه واحده)" + _E)),
           ("daily", re.compile(_B + r"(?:يومي|يوميا|اليومي|الليله|ليله|باليوم|اسبوعي|الاسبوعي|الاسبوع)" + _E))]
_PER_M = re.compile(r"(?:سعر\s*(?:ال)?متر|المتر|للمتر|بالمتر)\s*$")
_RANGE = re.compile(_NUM + _SCALE + r"\s*(?:-|–|الي|الى|لين|حتي|حتى)\s*" + _NUM + _SCALE)


def asking_price(title: str, body: str) -> dict:
    """{'price', 'period', 'per_meter', 'phrase', 'why'} from the seller's own words. price None = not stated
    (or a bid, or ambiguous) — the card then reads «السعر عند الطلب»."""
    t = norm(f"{title}\n{body}")
    out = {"price": None, "period": None, "per_meter": False, "phrase": None, "why": "no price phrase"}
    if _BID.search(t):
        out["why"] = "bid («السوم»): no price"
        return out
    cands: list[tuple[int, Optional[str], bool, str]] = []
    for m in (list(_PRICE_RE.finditer(t)) + list(_BI_RE.finditer(t)) + list(_MILLION_WORD.finditer(t))
              + list(_PPM_RE.finditer(t))):
        if m.re is _MILLION_WORD:
            v = (2_000_000 if m.group(1) == "مليونين" else 1_000_000) + (500_000 if m.group(2) else 0)
            num_end, num_txt = m.end(), m.group(1)
        else:
            num_txt, scale = m.group(1), m.group(2)
            if _PHONE.fullmatch(num_txt.replace(",", "")) or len(num_txt.replace(",", "").split(".")[0]) > 9:
                continue                                         # a phone number, never a price
            v = _value(num_txt, scale)
            num_end = m.end()
            if v is None:
                continue
            after = t[num_end:num_end + 14]
            if _NOT_A_PRICE_AFTER.match(after):
                continue                                         # «بـ 3 غرف», «سعر 2 دور», a year «1445 هـ»
            if m.re is _BI_RE and not (scale or re.match(r"\s*(?:ريال|ر\.?س|شهري|سنوي|يومي|للشهر|للسنه|بالشهر|بالسنه)", after)
                                       or (v >= 100 and re.match(r"\s*(?:$|\n|[.,،!؟)])", after))):
                continue                                         # the bare «ب» needs a unit / currency / period / an end
            if re.fullmatch(r"(?:13|14)\d\d", num_txt) and re.match(r"\s*ه", after):
                continue
        if re.match(r"\s*(?:ريال\s*)?(?:او|ا و|الي|الى|-|–|لين|حتي|حتى|ل)\s*\d", t[num_end:num_end + 20]):
            out["why"] = "two figures («او» / a range): no single price"
            return out
        before = t[max(0, m.start() - 25):m.start()]
        if _NOT_PRICE_BEFORE.search(before):
            continue                                             # a deposit, commission, instalment, income
        window = t[max(0, m.start() - 4):num_end + 22]
        period = next((p for p, r in _PERIOD if r.search(window)), None)
        per_m = m.re is _PPM_RE or bool(re.match(r"\s*(?:ريال\s*)?(?:للمتر|بالمتر|/\s*م)", t[num_end:num_end + 14]))
        cands.append((v, period, per_m, t[m.start():num_end + 12].strip()))
    if not cands:
        return out
    if _RANGE.search(t) and any(c[3] for c in cands if _RANGE.search(c[3])):
        out["why"] = "a price range: no single price"
        return out
    totals = {c for c in cands if not c[2]}
    values = {c[0] for c in totals} or {c[0] for c in cands}
    if len(values) != 1:
        out["why"] = f"several figures {sorted(values)}: no single price"
        return out
    v = values.pop()
    pick = next(c for c in cands if c[0] == v)
    periods = {c[1] for c in cands if c[0] == v and c[1]}
    out.update(price=v, period=periods.pop() if len(periods) == 1 else None, per_meter=pick[2] and not totals,
               phrase=pick[3][:80], why="price phrase")
    return out


# ── area ──────────────────────────────────────────────────────────────────────────────────────
_AREA_WORD = r"(?:مساحه|المساحه|مساحتها|مساحته|بمساحه|المساحه الاجماليه|مساحه الارض|مساحتها الاجماليه)"
# «مساحه 96 الف» is 96,000 m² in the seller's own words (Haraj 18263173 was stored as 96 m², 2026-10-17).
_AREA_SCALE = r"(?:\s*(الف|الاف)" + _E + r")?"
_UNIT = r"(?:م2|م²|م٢|متر\s*مربع|مترمربع|مترا\s*مربعا|متر|م)"
_AREA1 = re.compile(_B + _AREA_WORD + r"(?:\s*[:：\-]\s*|\s+)(?:(?:الارض|تقريبا|حوالي|كامله|الاجماليه|تبلغ|تقدر ب)\s*[:\-]?\s*){0,2}"
                    + _NUM + _AREA_SCALE + r"(?:\s*" + _UNIT + r")?(?![\d])")
_AREA2 = re.compile(r"(?<![\d.,])" + _NUM + _AREA_SCALE + r"\s*(?:م2|م²|م٢|متر\s*مربع|مترمربع|مترا\s*مربعا)" + _E)
# «10 في 8», «20×30»: two sides of a plot, never its area (and never multiplied: source is truth).
_DIMS_AFTER = re.compile(r"\s*(?:في|x|X|×|\*)\s*\d")
_STREET_BEFORE = re.compile(r"(?:شارع|عرض|عرضه|بعرض|عرضها|الشارع)\s*[:\-]?\s*$")


def area_of(title: str, body: str) -> dict:
    t = norm(f"{title}\n{body}")
    vals: dict[float, str] = {}
    for rx in (_AREA1, _AREA2):
        for m in rx.finditer(t):
            if _STREET_BEFORE.search(t[max(0, m.start() - 12):m.start()]):
                continue
            num = m.group(1)
            if _DIMS_AFTER.match(t, m.end(1)):
                continue                                         # «10 في 8» (Haraj 18263149, 2026-10-17)
            try:
                v = float(num.replace(",", ""))
            except ValueError:
                continue
            if m.group(2):
                v *= 1000
            if 10 <= v <= 10_000_000:
                vals.setdefault(v, t[m.start():m.end()].strip())
    if len(vals) != 1:
        return {"area": None, "phrase": None, "why": "no area phrase" if not vals else f"several areas {sorted(vals)}"}
    v, phrase = next(iter(vals.items()))
    return {"area": v, "phrase": phrase[:60], "why": "area phrase"}


# ── district: only «حي X» ─────────────────────────────────────────────────────────────────────
_HAYY = re.compile(r"(?:^|[\s،,.\-(])(?:ب|في|ف)?\s*حي\s+([" + _AR + r"0-9 ]{2,40})")


def district_phrases(title: str, body: str) -> list[str]:
    """Candidate names after «حي» (1-3 words each, longest first) for the caller to resolve in the catalogue."""
    out: list[str] = []
    for m in _HAYY.finditer(norm(f"{title}\n{body}")):
        words = m.group(1).split()
        for k in (3, 2, 1):
            if len(words) >= k:
                out.append(" ".join(words[:k]))
    return out


def facts(title: str, body: str, ptype: Optional[str]) -> dict:
    """Every other fact the seller stated (silent → absent): rooms, bathrooms, age, street + facade, amenities."""
    text = f"{title}\n{body}"
    out: dict = {}
    dwelling = ptype in {"Apartment", "Villa", "Floor", "Duplex", "Studio", "Room", "Rest House", "Chalet", "تاون هاوس"}
    if dwelling:
        rooms = N.rooms_from_phrase(norm(text))
        if rooms.get("bedrooms"):
            out["bedrooms"] = rooms["bedrooms"]
        from scrapers.haraj.parse import baths_of
        b = baths_of(text)
        if b:
            out["bathrooms"] = b
    age = N.age_from_labelled_prose(text)
    if age is not None:
        out["property_age"] = age
    width, facade = N.street_from_prose(text)
    if width:
        out["street_width_m"] = width
    if facade:
        out["direction"] = facade
    out.update(N.prose_amenities(text))
    return out
