"""Browser-layer stress: the things the RPC matrix cannot prove.

Per journey: count parity (headline == RPC total_count) -> first batch card fields vs the user's
selections -> «عرض المزيد» -> later-batch card fields -> identity-level duplicate check -> click-through.
Plus stale-state tests (switching نوع / مجموعة / فئة must not leak the previous selection into the
next request) and the same journeys at a mobile viewport.
"""
import os
# Set QA_DIR / STRESS_DIR to your working directories (defaults: ./.stress-qa, ./.stress-out).
SCRATCH_QA = os.environ.get("QA_DIR", os.path.join(os.getcwd(), ".stress-qa"))
SCRATCH_STRESS = os.environ.get("STRESS_DIR", os.path.join(os.getcwd(), ".stress-out"))
import sys, json, time, re, collections
sys.path.insert(0, SCRATCH_QA)
sys.path.insert(0, SCRATCH_STRESS)
from lib import *
from driver import App
from playwright.sync_api import sync_playwright

OUT = SCRATCH_STRESS
MOBILE = len(sys.argv) > 1 and sys.argv[1] == "mobile"

# (group, نوع, city, deal, period, commercial?)
JOURNEYS = [
    ("الشقق والسكن المشترك", "شقة",        "الرياض", "إيجار", "سنوي", False),
    ("الشقق والسكن المشترك", "دور",        "الرياض", "شراء",  None,   False),
    ("الشقق والسكن المشترك", "غرفة",       "الرياض", "إيجار", "سنوي", False),
    ("الفلل والبيوت",        "فيلا",       "الرياض", "شراء",  None,   False),
    ("الأراضي السكنية",      "أرض سكنية",  "الرياض", "شراء",  None,   False),
    ("الاستراحات والريف",    "استراحة",    "الرياض", "إيجار", "سنوي", False),
    ("التجزئة والمكاتب",     "مكتب",       "الرياض", "إيجار", "سنوي", True),
    ("التجزئة والمكاتب",     "محل",        "جدة",    "إيجار", "سنوي", True),
    ("الصناعة واللوجستيات",  "مستودع",     "الرياض", "إيجار", "سنوي", True),
    ("الأراضي التجارية والصناعية", "أرض تجارية", "جدة", "شراء", None,  True),
]
if MOBILE:
    JOURNEYS = JOURNEYS[:4]

log = []
def P(tag, **kw):
    kw["t"] = tag; kw["view"] = "mobile" if MOBILE else "desktop"
    log.append(kw); print(json.dumps(kw, ensure_ascii=False), flush=True)


def setup(a, grp, ty, city, deal, per, com):
    a.open(); a.tap(deal)
    if per: a.tap(per)
    a.set_city(city)
    if com: a.tap("تجاري")
    a.tap(grp); a.tap(ty)


with sync_playwright() as pw:
    b, ctx, p, errs = new_page(pw, mobile=MOBILE)
    rec = Rec(); rec.attach(p)
    a = App(p, rec, errs)

    for grp, ty, city, deal, per, com in JOURNEYS:
        try:
            setup(a, grp, ty, city, deal, per, com)
            ms = a.search()
            params = rec.last("location_search_candidates_ar")
            head = a.count_headline()
            # ---- count parity: headline vs the RPC's own total_count (same params, limit 1)
            probe = dict(params); probe["p_limit"] = 1; probe["p_offset"] = 0
            d, rms, rerr = rpc("location_search_candidates_ar", probe)
            rpc_total = int(d[0]["total_count"]) if d else 0
            # ---- first batch
            n1 = a.scroll_cards(target=25, max_scrolls=25)
            batch1 = [a.parse_card(c["text"]) for c in a.cards()]
            # ---- «عرض المزيد»
            sm_ms = before = after = None; sm_err = None
            try:
                sm_ms, before, after = a.show_more()
            except Exception as e:
                sm_err = str(e).split("\n")[0][:120]
            a.scroll_cards(target=(after or n1) + 10, max_scrolls=25)
            batch2 = [a.parse_card(c["text"]) for c in a.cards()]
            # ---- identity-level duplicate check over the whole eligible page
            full = dict(params); full["p_limit"] = 1500; full["p_offset"] = 0
            dd, _, _ = rpc("location_search_candidates_ar", full)
            keys = [f"{c['source_table']}:{c['listing_id']}" for c in (dd or [])]
            # ---- card-field validation vs the user's selections
            bad_type   = [c.get("type") for c in batch2 if c.get("type") and c.get("type") != ty]
            bad_city   = [c.get("city_line") for c in batch2 if c.get("city_line") and c.get("city_line") != city]
            bad_period = ([c.get("price_period") for c in batch2
                           if deal == "إيجار" and c.get("price_period") not in ("سنوياً","سنويا")]
                          if per == "سنوي" else [])
            missing = [k for k in ("price","type") if sum(1 for c in batch2 if c.get(k) is None) > len(batch2)*0.5]
            P("journey", ty=ty, city=city, deal=deal, per=per, headline=head, rpc_total=rpc_total,
              parity=(head == rpc_total), ms=ms, sm_ms=sm_ms, cards_b1=n1, cards_after=after,
              sm_err=sm_err, dup_ids=len(keys)-len(set(keys)), eligible_rows=len(keys),
              p_types=(params or {}).get("p_types"), p_beds=(params or {}).get("p_beds_exact"),
              bad_type=bad_type[:3], bad_city=bad_city[:3], bad_period=bad_period[:3],
              cards_missing_fields=missing,
              platforms_b1=len({c.get("platform_host") for c in batch1 if c.get("platform_host")}),
              platforms_b2=len({c.get("platform_host") for c in batch2 if c.get("platform_host")}))
            # ---- click-through: first + a later-batch card
            for idx in ([1, after] if after and after > 1 else [1]):
                if idx > len(batch2): continue
                opened = []
                h = lambda pg: opened.append(pg); ctx.on("page", h)
                try:
                    p.evaluate("(n)=>document.querySelector('[data-qa-card=\"'+n+'\"]')?.scrollIntoView({block:'center'})", str(idx))
                    p.wait_for_timeout(300)
                    p.click(f'[data-qa-card="{idx}"]', timeout=12000)
                    for _ in range(18):
                        p.wait_for_timeout(300)
                        if opened: break
                except Exception as e:
                    P("click", ty=ty, card=idx, ok=False, err=str(e).split("\n")[0][:100])
                    ctx.remove_listener("page", h); continue
                ctx.remove_listener("page", h)
                want = (batch2[idx-1].get("redirect_host") or "").strip()
                host = re.sub(r"^www\.", "", (re.match(r"https?://([^/]+)", opened[0].url) or [None,""])[1]) if opened else None
                P("click", ty=ty, card=idx, ok=bool(opened), host=host, expect=want,
                  match=bool(host and want and (want in host or host in want)))
                for pg in opened:
                    try: pg.close()
                    except Exception: pass
        except Exception as e:
            P("journey-error", ty=ty, err=str(e).split("\n")[0][:160])

    # ---- STALE STATE: switching نوع / مجموعة / فئة must not leak the previous selection ----
    if not MOBILE:
        try:
            setup(a, "الشقق والسكن المشترك", "شقة", "الرياض", "إيجار", "سنوي", False)
            a.search(); first = rec.last("location_search_candidates_ar")
            a.open(); a.tap("إيجار"); a.tap("سنوي"); a.set_city("الرياض")
            a.tap("الفلل والبيوت"); a.tap("فيلا"); a.search()
            second = rec.last("location_search_candidates_ar")
            P("stale-state", case="نوع شقة -> فيلا",
              first=first.get("p_types"), second=second.get("p_types"),
              leaked=bool(set(first.get("p_types") or []) & set(second.get("p_types") or [])))
            a.open(); a.tap("إيجار"); a.tap("سنوي"); a.set_city("الرياض")
            a.tap("تجاري"); a.tap("التجزئة والمكاتب"); a.tap("مكتب"); a.search()
            third = rec.last("location_search_candidates_ar")
            P("stale-state", case="فئة سكني -> تجاري",
              second=second.get("p_types"), third=third.get("p_types"),
              category=third.get("p_category"),
              leaked=bool(set(second.get("p_types") or []) & set(third.get("p_types") or [])))
            # group switch WITHOUT picking a type: p_types must become the group's set, not the old type
            a.open(); a.tap("إيجار"); a.tap("سنوي"); a.set_city("الرياض")
            a.tap("الشقق والسكن المشترك"); a.tap("شقة"); a.tap("شقة")  # select then DESELECT
            a.search(); fourth = rec.last("location_search_candidates_ar")
            P("stale-state", case="نوع deselected -> group level",
              p_types=fourth.get("p_types"), category=fourth.get("p_category"))
        except Exception as e:
            P("stale-state-error", err=str(e).split("\n")[0][:160])

    json.dump(log, open(f"{OUT}/ui_{'mobile' if MOBILE else 'desktop'}.json", "w"), ensure_ascii=False)
    ctx.close(); b.close()
print("UI STRESS DONE")
