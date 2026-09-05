# Recommendation — absence must never start the irreversible deletion path

**Status:** recommendation only. Nothing here is applied. Incident **#24 (P1)** stays OPEN until the
owner decides, because every option below changes deletion semantics on a path that ends in a
permanent, unrecoverable delete.

**Scope discipline.** Nothing in this document weakens a source-truth requirement, and nothing here
deletes anything on absence. Every proposal ADDS a precondition to deleting. The engine's existing
guards — the final re-probe, the 30%-inconclusive freeze, the platform-health gate, the anomaly and
fraction caps, `max_delete_per_run`, and the per-row `cleanup_deletion_log` audit trail — all stay
exactly as they are.

---

## 1. What is already correct, so it does not get "fixed"

`scrapers/common/cleanup.py` is a careful engine and its final gate is genuinely three-valued:

```python
def verdict(status, body, dead_marker) -> str:
    if status is None:      return "unknown"   # network / proxy failure
    if status in (404, 410):return "dead"
    if status != 200:       return "unknown"   # 403 / 429 / 5xx
    return "dead" if dead_marker(body) else "live"
```

`unknown` skips, `live` reactivates, only `dead` deletes. **Today, with the policy as configured, a
listing cannot be deleted on absence alone.** All four enabled platforms (`aqar`, `aqarcity`,
`gathern`, `wasalt`) have `require_source_recheck = true`, verified in production 2026-09-05.

So this is not a live breach. It is a structure in which one thing stands between absence and a
permanent delete, and that one thing is defeatable in three ways.

## 2. The three real weaknesses

### (a) The re-check is a database flag, not an invariant

```python
else:
    status, v = None, "dead"     # explicit opt-out (not used by default policy)
```

`require_source_recheck` lives in a row of `platform_retention_policy`. Set it false for a platform
and the engine hard-deletes on absence alone — precisely the behaviour of the retired deleter that
removed **21,371 rows unrecoverably**. No code change, no PR, no review: one `UPDATE`.

### (b) The clock is 100% absence

```sql
active = false AND missing_count >= 3 AND last_seen_at < now() - 30 days
```

All three are absence signals. `missing_count` is incremented by `prune_unseen()` from crawl
absence, which `docs/ops/LISTING_LIVENESS.md` classifies as UNKNOWN and explicitly says is "a
candidate signal and never a verdict". So absence alone decides *who stands on the trapdoor*; only
the last probe decides whether it opens.

The measured size of that gap is not hypothetical. Gathern's own 18-day pilot found **14 of 50
(28%)** age+strike-eligible rows were STILL LIVE at the final re-check. Roughly one in four rows
reaching the final probe should not be there at all — and that single probe absorbs all of it.

### (c) The 30 days is measured from the wrong event

`_age_days()` measures from `last_seen_at` — *"30 days since we last saw it"*, not *"30 days since
the source said it was gone"*. A listing whose death is confirmed today but which was last seen 45
days ago is immediately deletable. **There is no observation window after the death evidence at
all**, so a single bad probe — a WAF 404 storm, a source migrating URLs, a `dead_marker` that
matches a generic error page — deletes on first sight.

---

## 3. The recommendation

**Make the clock run on EVIDENCE and require that evidence twice, far apart.**

### Step 1 — record when the source first said "gone"

Add `first_dead_evidence_at timestamptz` (nullable) to the listing tables, written **only** by
`scrapers/common/liveness_contract.py` on a DIRECT dead verdict. Specifically:

| probe verdict | `first_dead_evidence_at` |
|---|---|
| `dead` (404/410, or 200 + registered dead-marker) | set, if currently NULL — otherwise left alone |
| `live` (200, no dead-marker) | **cleared to NULL**, and the row reactivated |
| `unknown` (network, 403, 429, 5xx, parser failure, no crawl) | **untouched** — neither set nor cleared |

That last row is the whole rule: UNKNOWN neither starts nor stops the clock. It is not evidence in
either direction. Absence — `prune_unseen()`, `missing_count`, `last_seen_at` — must never write
this column.

### Step 2 — make eligibility require it

```sql
-- from
active = false AND missing_count >= 3 AND last_seen_at        < now() - 30 days
-- to
active = false AND missing_count >= 3 AND first_dead_evidence_at IS NOT NULL
                                      AND first_dead_evidence_at < now() - 30 days
```

`missing_count` and `last_seen_at` stay — as a cheap pre-filter for *what is worth re-probing*.
They simply stop being sufficient. The consequence is the one that matters:

> Deletion now requires **two independent DIRECT dead observations at least 30 days apart** — the
> one that set `first_dead_evidence_at`, and the existing final re-probe. A one-off 404 storm can
> delete nothing, because the second observation is a month away and a single `live` in between
> clears the column and cancels the deletion outright.

This is the restore-and-cancel behaviour `LISTING_LIFECYCLE_ENGINEER.md` §3 already requires, made
structural instead of incidental.

### Step 3 — close the flag

Add a CHECK constraint so `require_source_recheck = false` cannot be stored, and delete the
`status, v = None, "dead"` branch. A safety gate that a single UPDATE can disable is not a gate.
Pin both with a barrier that executes the engine's own predicate against a policy row with the flag
false and proves it refuses.

*(Of the three steps this one is the smallest and the most clearly safe — it removes a bypass and
changes no behaviour any platform currently uses. It is the only step I would be willing to apply
without an owner decision, and I have not, because it sits inside the same P1.)*

### Step 4 — a detector, so the rule is watched and not merely written

`mon_detect_deletion_clock_without_evidence` — any row old enough to be eligible that carries no
`first_dead_evidence_at`. Under the new rule that count must be **0**; while it is non-zero it is
the exact population the old rule would have deleted on absence. Add it to `mon_run_all_detectors()`
in the same migration, or it is decoration.

---

## 4. Rollout that cannot create a gap

1. **Add the column and start writing it.** Change nothing about deletion. Zero risk.
2. **Report-only for 30 days.** Run the detector; watch `first_dead_evidence_at` populate. This
   period *measures* the exposure: every row that ages into eligibility with a NULL column is a row
   the current rule would have put on the trapdoor with no standing evidence.
3. **Switch the predicate.** Because the column needs 30 days to age, deletions naturally pause for
   one window. **That pause is the correct behaviour, not an outage** — it is the system declining
   to delete anything it cannot yet prove twice. Retention is a floor, never a deadline; nothing
   breaks if a dead listing is retained for 60 days instead of 30.
4. **Then close the flag** (step 3) and land the barrier.

## 5. What this does NOT do

- It does not delete anything on absence — it makes that structurally impossible.
- It does not relax any existing guard. Every gate in §1 stays.
- It does not touch what makes a listing *inactive* (invisible to users). That path is already
  correct and correctly separate: a source-confirmed dead listing stops being shown **immediately**;
  only the permanent delete waits. Users never see a listing this document is about.
- It does not make deletion faster, and it should not. The only thing an unrecoverable delete needs
  to be is *right*.
