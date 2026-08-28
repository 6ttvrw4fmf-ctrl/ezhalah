# AF + Trending health ratings — how the numbers are produced (owner-mandated 2026-08-28)

**Every health number in this routine's FINAL REPORT is DERIVED from
`scripts/lib/afContractCoverage.ts`. No health line may be hand-estimated, carried forward from a
previous run, or "calibrated" against last run's figure.**

## Why this file exists

On 2026-08-28 this routine reported `ADVANCED FILTER HEALTH: 9.4/10` and, asked what produced the
9.4, had no answer beyond judgement anchored to the previous run's number. The owner's objection was
exact:

> Do not give 9.5/10 just because tests are green. A 9.5 must mean the actual product is extremely
> close to the canonical Product Contract in production.

That objection was correct. Recomputed against the contract rule by rule, the same production state
scores **8.4/10 overall, not 9.5** — the reported numbers were roughly a full point optimistic. The
gap was not a lie about test results; every test result reported was real. It was a **denominator
error**: the score was computed over "things I looked at", and rules nobody has ever tested were
silently absent from the average instead of scoring zero.

## The unit of measurement is the contract rule

`docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md` currently defines **122 R-numbered rules**. (Its own
SUMMARY line says "RULES DOCUMENTED: 74" — that count is stale; the parser finds 122. Reported to
the owner, not corrected here, because §0.1 forbids this routine from editing the contract.)

Every one of those 122 is graded, every run. `scripts/verify-af-contract-coverage-map.ts` (in
`npm test`) fails the build if a contract rule is missing from the map, if a graded rule has
vanished from the contract, if a grade cites a barrier file that does not exist or that nothing ever
executes, or if the grade ordering is tampered with.

## The grades

| grade | meaning | score |
|---|---|---|
| **L** | live-tested against **production** in the run being scored — a real browser journey, or a live RPC/DB differential | 1.00 |
| **B** | barrier-protected: an executing check asserts the rule's own invariant, green this run | 0.85 |
| **P** | partial — covered only indirectly, or a two-part rule where only one part holds | 0.50 |
| **N** | no meaningful coverage, **or** production is known not to implement the rule | 0.00 |

**L outranks B deliberately.** A barrier proves the code is self-consistent. It cannot see a fix that
never deployed, a runtime condition, or data drift. The contract is a promise about what the *user*
experiences, so only a live journey fully discharges it. This is not pedantry: on 2026-08-27 nine
barriers were green over a Trending surface that was dead for every narrowed real user, because
every barrier ran as a privileged role and never saw the anon query plan.

**B at 0.85, not 1.0**, encodes exactly that residual risk. A suite that is entirely green and never
touches production caps this routine at 8.5/10 — which is the intended message.

## The weights — user impact, never implementation effort

| weight | meaning |
|---|---|
| **3** | load-bearing: break it and the user is shown a **wrong answer**, or a truthful narrowing is lost |
| **2** | important: correctness of the interaction rather than of the number |
| **1** | illustrative/structural: worked examples, rationale sentences, cross-references |

```
score(dimension) = 10 × Σ(weight × gradeScore) / Σ(weight)
```

## What each reported line is computed over

| report line | entries |
|---|---|
| `ADVANCED FILTER HEALTH` | every `dim: 'af'` entry (118: contract §§1–13 minus the integrity rules, plus X1) |
| `TRENDING CITIES` / `TRENDING DISTRICTS` | the `dim: 'trending'` entries (T1–T12), split city/district |
| `AF DATA INTEGRITY` | `dim: 'integrity'` — contract R2.5.x, R13.2, R13.3 plus D1–D5 |
| `OVERALL AF + TRENDING` | all entries, one weighted average |
| `AF SYSTEM RATING` | **not a coverage score.** How close the *product as specified* is to §0's philosophy — judged, and it must be stated as a judgement, never dressed as a measurement |
| `ENGINEER PERFORMANCE` | how well the run executed the 12 steps. Also a judgement; state it as one |

## Two structural gaps this methodology exposed

1. **Trending is not in the Product Contract at all.** The "canonical source of truth for what
   Advanced Filter does" covers Advanced Filter only. Trending Cities and Trending Districts — which
   this routine owns and which carry the same count-honesty obligations — have **no R-numbers
   anywhere**. T1–T12 are this file's own reconstruction from Parts 2 and 3 of
   `AF_TRENDING_DATA_INTEGRITY_ENGINEER.md`. Ranking a rule set that the routine wrote for itself is
   weaker evidence than ranking against an owner-authored contract. **Owner decision needed:** extend
   the Product Contract to cover Trending, or authorise a separate Trending contract.
2. **A live owner rule has no R-number.** "A failed or timed-out probe is not a *not-useful*
   verdict" (owner 2026-08-26) is implemented in `src/lib/afProbe.ts` and barriered by
   `verify-af-probe-failure-not-a-verdict.ts`, but appears nowhere in the contract. It is carried in
   the map as `X1` so the gap stays visible, and the barrier refuses to let that register be emptied
   silently.

## What this methodology does NOT claim

Stated plainly, because a score that oversells itself is the problem this file exists to fix:

- It measures **coverage-weighted conformance to the written contract**. It is not a bug count, and
  it cannot see a defect in a rule nobody wrote down.
- The barrier enforces *structural* honesty — rule present, barrier real, barrier executes, evidence
  stated, ordering sane. It **cannot verify that an evidence sentence is true.** An agent that
  writes a false evidence line and an unearned `L` will pass. The defence against that is the run
  report, where every `L` must cite a number a reader can re-measure.
- `L` means "live-tested **in the run being scored**". Grades therefore *decay*: a rule proved live
  on 2026-08-27 and untouched on 2026-08-28 falls to `B`. This is intended — it makes the score
  reflect what this run actually knows, and it puts steady downward pressure on stale coverage.

## Using it

```
node --experimental-strip-types scripts/verify-af-contract-coverage-map.ts
```

prints the per-dimension scores and the L/B/P/N tally. Update the grades in
`scripts/lib/afContractCoverage.ts` as the run proceeds — a rule you live-tested today becomes `L`
with the measurement in its `evidence` string — then read the numbers off the barrier's own output
into the FINAL REPORT. Never type a health number the tool did not print.
