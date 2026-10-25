"""Facts WORDS + VECTORS job — the owner's VECTOR COMBO (2026-10-24). Zero paid AI: GitHub Actions CPU only.

    python -m scrapers.facts.words --phase benchmark --run-id facts-words-bench-2026-10-25
    python -m scrapers.facts.words --phase full --run-id facts-words-2026-10-25 --shard 0/4
    python -m scrapers.facts.words --selftest                     # no network, no env, no model

  1. WORD CHECKER (scrapers/facts/word_checker.py) decides yes/no with proof → public.listing_facts
     (model='word-checker-v1', a new run_id; source_value = the source table's own structured field).
  2. VECTORS: title + description, PDPL-sanitised, embedded by a FREE multilingual model on the runner's CPU
     (intfloat/multilingual-e5-small, 384-d, revision pinned) → public.listing_embeddings (halfvec).
  3. FINDER: per fact, seeds = ads the checker said yes; candidates = ads it left blank whose vector is as close
     to the seeds as the seeds are to each other. The phrases over-represented in the candidates are the
     "new words" list for owner review. A vector NEVER writes a yes or a no — only the list.

benchmark = exactly the ads of the LLM run `facts-test-2026-10-24` (keys read from listing_facts), so the
words, the vectors and the LLM are compared on the same ads. full = every active ad, sharded by id range.
Reads are paged (500 rows) with a pause; writes go only to listing_facts and listing_embeddings.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import time
from collections import Counter, defaultdict
from typing import Any, Optional

from scrapers.facts import word_checker as W
from scrapers.facts.extract import GT_COLUMNS, _text_col, norm, platform_of, source_value

BENCH_SOURCE_RUN = "facts-test-2026-10-24"
MODELS = {   # name → (HF repo, pinned revision, text prefix)
    "e5-small": ("intfloat/multilingual-e5-small", "614241f622f53c4eeff9890bdc4f31cfecc418b3", "query: "),
    "minilm-l12": ("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                   "e8f8c211226b894fcb81acc59f3b34ba3efd5f42", ""),
}
PAGE = 500
PAUSE_S = 0.15
MIN_NORM_CHARS = 20


# ── tables ────────────────────────────────────────────────────────────────────────────────────────────────
def all_tables(platforms: Optional[set[str]]) -> list[str]:
    """Every per-platform listing table the liveness registry knows (one registry, not a hand list)."""
    from scrapers.common.liveness_policies import NOT_PRODUCTION_SEARCHABLE, POLICIES
    ps = sorted(p for p in POLICIES if p not in NOT_PRODUCTION_SEARCHABLE and (not platforms or p in platforms))
    return [f"{p}_{k}_listings" for p in ps for k in ("residential", "commercial")]


def _select_cols(table: str, cols: list[str]) -> str:
    return ",".join(["id", "ad_number", "listing_url", "title", f"text:{_text_col(table)}"] + cols)


def _fetch(q_builder, table: str, gt_cols: list[str]):
    """Run a query, dropping a ground-truth column the table lacks (as extract.py does). None = no such table."""
    for _ in range(len(GT_COLUMNS) + 1):
        try:
            return q_builder(_select_cols(table, gt_cols)).execute().data or []
        except Exception as e:
            msg = str(e)
            if "PGRST205" in msg or "42P01" in msg or "does not exist" in msg and "relation" in msg:
                return None
            m = re.search(r"column \w+\.(\w+) does not exist", msg)
            if not m or m.group(1) not in gt_cols:
                raise
            gt_cols.remove(m.group(1))
    raise RuntimeError(f"{table}: could not select")


# ── benchmark: the LLM run's ads + its facts ──────────────────────────────────────────────────────────────
def bench_keys(client) -> tuple[dict[str, list[str]], dict[tuple[str, str], dict[str, Any]]]:
    by_table: dict[str, set[str]] = defaultdict(set)
    llm: dict[tuple[str, str], dict[str, Any]] = defaultdict(dict)
    last = 0
    while True:
        page = client.table("listing_facts").select("id,table_name,platform,listing_key,fact,value_bool,value_num") \
            .eq("run_id", BENCH_SOURCE_RUN).gt("id", last).order("id").limit(1000).execute().data or []
        for r in page:
            by_table[r["table_name"]].add(r["listing_key"])
            if r["fact"] != "_none":
                llm[(r["platform"], r["listing_key"])][r["fact"]] = r["value_bool"] if r["value_bool"] is not None else r["value_num"]
        if len(page) < 1000:
            break
        last = page[-1]["id"]
    return {t: sorted(k) for t, k in by_table.items()}, llm


def read_bench(client, table: str, keys: list[str]) -> list[dict[str, Any]]:
    gt = list(GT_COLUMNS)
    out: list[dict[str, Any]] = []
    for i in range(0, len(keys), 150):
        chunk = keys[i:i + 150]
        rows = _fetch(lambda sel: client.table(table).select(sel).in_("ad_number", chunk), table, gt)
        out.extend(rows or [])
        time.sleep(PAUSE_S)
    return out


# ── full: every active ad, this shard's id slice of every table ───────────────────────────────────────────
def read_full(client, table: str, shard: int, shards: int, limit: int):
    gt = list(GT_COLUMNS)
    lo_hi = []
    for asc in (True, False):
        r = _fetch(lambda sel: client.table(table).select(sel).order("id", desc=not asc).limit(1), table, gt)
        if r is None:
            return
        if not r:
            return
        lo_hi.append(int(r[0]["id"]))
    lo, hi = lo_hi
    span = (hi - lo) // shards + 1
    a, b = lo + shard * span, min(hi, lo + (shard + 1) * span - 1)
    last, n = a - 1, 0
    while last < b and (not limit or n < limit):
        rows = _fetch(lambda sel: client.table(table).select(sel).eq("active", True).gt("id", last).lte("id", b)
                      .order("id").limit(PAGE), table, gt) or []
        if not rows:
            break
        last = int(rows[-1]["id"])
        n += len(rows)
        yield rows
        time.sleep(PAUSE_S)


# ── embeddings ────────────────────────────────────────────────────────────────────────────────────────────
class Embedder:
    def __init__(self, name: str):
        import torch
        from sentence_transformers import SentenceTransformer
        torch.set_num_threads(os.cpu_count() or 2)
        repo, rev, self.prefix = MODELS[name]
        self.name = name
        self.model = SentenceTransformer(repo, revision=rev, device="cpu")
        self.model.max_seq_length = 256
        self.seconds = 0.0
        self.count = 0

    def encode(self, texts: list[str]):
        t0 = time.time()
        v = self.model.encode([self.prefix + t for t in texts], batch_size=64, normalize_embeddings=True,
                              convert_to_numpy=True, show_progress_bar=False)
        self.seconds += time.time() - t0
        self.count += len(texts)
        return v


def vec_literal(v) -> str:
    return "[" + ",".join(f"{x:.4f}" for x in v) + "]"


def text_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


# ── finder: vectors find what the words missed; they never decide ────────────────────────────────────────
_STOP = frozenset(norm(w) for w in (
    "في", "من", "علي", "على", "الى", "إلى", "مع", "و", "او", "أو", "عن", "ان", "أن", "هذا", "هذه", "التي", "الذي", "كل",
    "يوجد", "به", "بها", "لل", "ال", "ثم", "the", "and", "with", "for", "of", "a", "to", "in", "is", "للبيع", "للايجار",
    "شقه", "فيلا", "حي", "الرياض", "جده", "متر", "م", "غرفه", "غرف", "نوم", "دوره", "مياه", "صاله"))


def _grams(words: list[str]) -> set[str]:
    out = set()
    for n in (1, 2, 3):
        for i in range(len(words) - n + 1):
            g = words[i:i + n]
            if all(w in _STOP or w.isdigit() for w in g) or g[0] in _STOP or g[-1] in _STOP:
                continue
            if any(len(w) > 25 for w in g):
                continue
            out.add(" ".join(g))
    return out


def finder(E, facts: list[dict[str, Any]], texts: list[str], llm: Optional[list[dict[str, Any]]],
           min_count: int, rng: random.Random) -> dict[str, Any]:
    """E: (n, d) unit vectors; facts[i]: checker facts of ad i; texts[i]: its normalised text; llm[i]: LLM facts."""
    import numpy as np
    n = len(facts)
    report: dict[str, Any] = {}
    known = {f: [W._n(s if isinstance(s, str) else s[0]).lstrip("^").rstrip("$") for s in specs]
             for f, specs in W.FACT_TOKENS.items()}
    words_of = [t.split()[:400] for t in texts]
    for fact in sorted(W.FACT_TOKENS):
        seeds = [i for i in range(n) if facts[i].get(fact) is True]
        blank = [i for i in range(n) if fact not in facts[i]]
        if len(seeds) < 10 or not blank:
            continue
        S = E[rng.sample(seeds, min(3000, len(seeds)))]
        k = 5

        def topk(M, drop_self: bool):
            out = []
            kk = min(k, len(S) - 1)
            for j in range(0, len(M), 4096):
                sims = M[j:j + 4096] @ S.T
                top = np.sort(np.partition(sims, -(kk + 1), axis=1)[:, -(kk + 1):], axis=1)
                out.append((top[:, :-1] if drop_self else top[:, 1:]).mean(axis=1))
            return np.concatenate(out)
        probe = rng.sample(seeds, min(500, len(seeds)))
        seed_scores = topk(E[probe], drop_self=True)  # a seed's closeness to OTHER seeds (its own 1.0 dropped)
        tau = float(np.percentile(seed_scores, 25))
        b_scores = topk(E[blank], drop_self=False)
        order = np.argsort(-b_scores)
        cap = max(20, min(2000, int(0.03 * len(blank))))
        cand = [blank[j] for j in order[:cap] if b_scores[j] >= tau]
        rest = [blank[j] for j in order[cap:]]
        row: dict[str, Any] = {"seeds": len(seeds), "blank": len(blank), "tau": round(tau, 4), "candidates": len(cand)}
        if llm is not None:
            lt = lambda i: llm[i].get(fact) is True
            row["cand_llm_true"] = sum(1 for i in cand if lt(i))
            row["blank_llm_true"] = sum(1 for i in blank if lt(i))
        if cand and rest:
            c_c, c_b = Counter(), Counter()
            for i in cand:
                c_c.update(_grams(words_of[i]))
            for i in rng.sample(rest, min(len(rest), 20000)):
                c_b.update(_grams(words_of[i]))
            nb = min(len(rest), 20000)
            scored = []
            for g, c in c_c.items():
                if c < min_count or any(kw and kw in g for kw in known[fact]):
                    continue
                pc, pb = c / len(cand), c_b[g] / nb
                if pc > 3 * pb:
                    scored.append((round(pc - pb, 4), g, c, c_b[g]))
            scored.sort(reverse=True)
            row["new_words"] = [[g, c, b] for _s, g, c, b in scored[:30]]
        report[fact] = row
    return report


def neighbour_sanity(E, facts, llm, rng) -> dict[str, Any]:
    """Do a pool ad's nearest neighbours talk about pools? share of the 5 NN that have the fact vs the base rate."""
    import numpy as np
    out = {}
    n = len(facts)
    for fact in ("pool", "majlis", "elevator", "well", "gym", "furnished", "roof", "annex"):
        has = [bool(facts[i].get(fact) is True or (llm and llm[i].get(fact) is True)) for i in range(n)]
        seeds = [i for i in range(n) if facts[i].get(fact) is True]
        if len(seeds) < 10:
            continue
        probe = rng.sample(seeds, min(40, len(seeds)))
        sims = E[probe] @ E.T
        hits = tot = 0
        for r, i in enumerate(probe):
            sims[r, i] = -1
            nn = np.argpartition(-sims[r], 5)[:5]
            hits += sum(has[j] for j in nn)
            tot += 5
        out[fact] = {"nn_share": round(hits / tot, 3), "base_rate": round(sum(has) / n, 3), "probes": len(probe)}
    return out


# ── the run ───────────────────────────────────────────────────────────────────────────────────────────────
def run(args: argparse.Namespace) -> int:
    import numpy as np
    from scrapers.common.db import sb
    client = sb()
    rng = random.Random(20261025)
    platforms = set(args.platforms.split(",")) - {""} if args.platforms else None
    emb = Embedder(args.model) if args.embed else None
    t_start = time.time()
    stats = Counter()
    per_platform: dict[str, Counter] = defaultdict(Counter)
    keep_vecs, keep_facts, keep_texts, keep_llm = [], [], [], []
    llm_all: Optional[dict] = None

    def store_facts(rows: list[dict[str, Any]]) -> None:
        for i in range(0, len(rows), 500):
            for attempt in range(4):
                try:
                    client.table("listing_facts").upsert(rows[i:i + 500], on_conflict="platform,listing_key,fact,run_id",
                                                        ignore_duplicates=True).execute()
                    break
                except Exception as e:
                    if attempt == 3:
                        raise
                    print(f"  ! listing_facts upsert retry: {str(e)[:120]}")
                    time.sleep(5 * (attempt + 1))

    def store_vecs(rows: list[dict[str, Any]]) -> None:
        for i in range(0, len(rows), 200):
            for attempt in range(4):
                try:
                    client.table("listing_embeddings").upsert(rows[i:i + 200], on_conflict="table_name,listing_key,model").execute()
                    break
                except Exception as e:
                    if attempt == 3:
                        raise
                    print(f"  ! listing_embeddings upsert retry: {str(e)[:120]}")
                    time.sleep(5 * (attempt + 1))

    def existing_hashes(table: str, keys: list[str]) -> dict[str, str]:
        if not keys:
            return {}
        r = client.table("listing_embeddings").select("listing_key,text_hash").eq("table_name", table) \
            .eq("model", args.model).in_("listing_key", keys).execute().data or []
        return {x["listing_key"]: x["text_hash"] for x in r}

    def process(table: str, rows: list[dict[str, Any]]) -> None:
        platform = platform_of(table)
        fact_rows, todo = [], []
        for r in rows:
            key = str(r.get("ad_number") or "")
            if not key:
                continue
            text = W.clean_text(r.get("title"), r.get("text"))
            nt = norm(text)
            pp = per_platform[platform]
            pp["ads_read"] += 1
            if len(nt) < MIN_NORM_CHARS:
                pp["too_short"] += 1
                continue
            pp["ads_checked"] += 1
            found = W.check(text)
            if found:
                pp["ads_with_fact"] += 1
            pp["facts"] += len(found)
            for f in found:
                fact_rows.append({"run_id": args.run_id, "platform": platform, "table_name": table, "listing_key": key,
                                  "listing_url": r.get("listing_url") if args.phase == "benchmark" else None,
                                  "model": W.MODEL, "source_value": source_value(f["fact"], r), **f})
            todo.append((key, text, nt, {f["fact"]: next(f[k] for k in ("value_bool", "value_num", "value_text")
                                                           if f[k] is not None) for f in found}))
        store_facts(fact_rows)
        stats["facts"] += len(fact_rows)
        if not todo:
            return
        if emb is None:
            for key, _text, nt, fv in todo:
                if args.finder and (args.phase == "benchmark" or len(keep_facts) < args.finder_cap):
                    keep_facts.append(fv)
                    keep_texts.append(nt)
                    keep_llm.append((llm_all or {}).get((platform, key), {}))
            return
        have = existing_hashes(table, [k for k, *_ in todo]) if args.phase == "full" else {}
        need = [(k, t, nt, fv) for k, t, nt, fv in todo if have.get(k) != text_hash(t)]
        stats["embed_skipped_same_text"] += len(todo) - len(need)
        if need:
            V = emb.encode([t for _k, t, _nt, _fv in need])
            store_vecs([{"platform": platform, "table_name": table, "listing_key": k, "model": args.model,
                         "embedding": vec_literal(v), "text_hash": text_hash(t)} for (k, t, _nt, _fv), v in zip(need, V)])
            stats["embedded"] += len(need)
            if args.finder:
                for (k, _t, nt, fv), v in zip(need, V):
                    if args.phase == "benchmark" or len(keep_facts) < args.finder_cap:
                        keep_vecs.append(v.astype(np.float32))
                        keep_facts.append(fv)
                        keep_texts.append(nt)
                        keep_llm.append((llm_all or {}).get((platform, k), {}))

    shard, shards = (int(x) for x in args.shard.split("/"))
    if args.phase == "benchmark":
        keys, llm_all = bench_keys(client)
        print(f"benchmark: {sum(len(v) for v in keys.values())} ads over {len(keys)} tables from {BENCH_SOURCE_RUN}")
        for table, ks in sorted(keys.items()):
            if platforms and platform_of(table) not in platforms:
                continue
            ks = ks[:args.limit] if args.limit else ks
            rows = read_bench(client, table, ks)
            process(table, rows)
            print(f"  {table}: {len(rows)}/{len(ks)} read · facts so far {stats['facts']} · {int(time.time() - t_start)}s")
    else:
        tables = all_tables(platforms)
        print(f"full: shard {shard}/{shards} over {len(tables)} candidate tables")
        for table in tables:
            got = 0
            for rows in read_full(client, table, shard, shards, args.limit):
                process(table, rows)
                got += len(rows)
            if got:
                print(f"  {table}: {got} active ads · facts so far {stats['facts']} · embedded {stats['embedded']} · "
                      f"{int(time.time() - t_start)}s")
    secs = int(time.time() - t_start)
    summary: dict[str, Any] = {
        "run_id": args.run_id, "phase": args.phase, "shard": args.shard, "seconds": secs,
        "ads_read": sum(p["ads_read"] for p in per_platform.values()),
        "ads_checked": sum(p["ads_checked"] for p in per_platform.values()),
        "ads_with_fact": sum(p["ads_with_fact"] for p in per_platform.values()),
        "facts": stats["facts"], "embedded": stats["embedded"], "embed_skipped_same_text": stats["embed_skipped_same_text"],
        "embed_seconds": round(emb.seconds, 1) if emb else 0,
        "embed_per_second": round(emb.count / emb.seconds, 1) if emb and emb.seconds else None,
        "model": args.model if emb else None, "per_platform": {p: dict(c) for p, c in sorted(per_platform.items())},
    }
    if args.finder and keep_vecs:
        E = np.vstack(keep_vecs)
        summary["neighbour_sanity"] = neighbour_sanity(E, keep_facts, keep_llm if llm_all else None, rng)
        summary["finder"] = finder(E, keep_facts, keep_texts, keep_llm if llm_all else None,
                                   min_count=3 if args.phase == "benchmark" else 8, rng=rng)
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"words-{args.phase}-{shard}of{shards}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in summary.items() if k not in ("per_platform", "finder")}, ensure_ascii=False))
    print(f"wrote {path}")
    return 0


def selftest() -> None:
    import numpy as np
    W.selftest()
    assert vec_literal([0.12345, -1.0]) == "[0.1235,-1.0000]"
    assert all_tables({"aqar"}) == ["aqar_residential_listings", "aqar_commercial_listings"]
    # finder on a toy space: two "pool" ads + one blank ad sitting right next to them → it is the candidate,
    # and its unknown word («بركه») surfaces; the far-away blank ad does not.
    rng = random.Random(1)
    base = np.zeros(8, dtype=np.float32)
    base[0] = 1
    far = np.zeros(8, dtype=np.float32)
    far[1] = 1
    vecs, facts, texts = [], [], []
    noise = lambda: np.array([rng.random() * 0.05 for _ in range(8)], dtype=np.float32)
    for i in range(12):
        v = base + noise()
        vecs.append(v / np.linalg.norm(v))
        facts.append({"pool": True})
        texts.append(f"مسبح خاص {i}")
    for i in range(3):
        v = base + noise() * 0.5
        vecs.append(v / np.linalg.norm(v))
        facts.append({})
        texts.append("بركه سباحه داخليه")
    for i in range(40):
        v = far + noise()
        vecs.append(v / np.linalg.norm(v))
        facts.append({})
        texts.append(f"شقه عائليه {i}")
    rep = finder(np.vstack(vecs), facts, texts, None, min_count=2, rng=rng)
    assert rep["pool"]["candidates"] == 3, rep["pool"]
    assert any("بركه" in g for g, *_ in rep["pool"]["new_words"]), rep["pool"]
    print("words selftest ok")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--phase", choices=("benchmark", "full"), default="benchmark")
    ap.add_argument("--run-id", default="")
    ap.add_argument("--limit", type=int, default=0, help="max ads per table (0 = all)")
    ap.add_argument("--platforms", default="")
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--model", choices=sorted(MODELS), default="e5-small")
    ap.add_argument("--no-embed", dest="embed", action="store_false")
    ap.add_argument("--no-finder", dest="finder", action="store_false")
    ap.add_argument("--finder-cap", type=int, default=120_000)
    ap.add_argument("--out", default="facts-words-out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return 0
    if not re.fullmatch(r"facts-words[A-Za-z0-9._-]{3,50}", args.run_id or ""):
        ap.error("--run-id must start with facts-words (letters, digits, . _ -)")
    if not re.fullmatch(r"\d/\d", args.shard) or int(args.shard[0]) >= int(args.shard[2]):
        ap.error("--shard i/n")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
