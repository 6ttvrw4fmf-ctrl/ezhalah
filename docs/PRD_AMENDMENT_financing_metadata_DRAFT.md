# PRD Amendment — DRAFT (pending owner approval)
## Source-advertised financing / installments as neutral metadata

**Status:** proposal only — do not merge into `Ezhalah PRD.html` until the owner approves.
**Scope:** the owner's "§6/§7 amendment" — i.e. the guided-interview/advanced-filter feature
(rendered §5.4 / §6.4) **and** the AI Agent hard rules (§7.1).
**Trigger:** the Installments / "rent-now-pay-later" (RNPL) advanced filter (live since PR #164)
surfaces a per-listing boolean (`rent_now_pay_later`) that the **source platform already advertises**.
As currently worded, §7.1's *"give buying or financial advice"* prohibition and the neutral-search
positioning can be read to forbid Ezhalah from displaying or filtering on that field at all. This
amendment draws the line explicitly.

---

### The principle in one line
Ezhalah **may display and filter** financing/installment availability that a **source listing itself
advertises**, as neutral factual metadata — exactly as it shows a listing's price or area. Ezhalah
**never originates, calculates, ranks, brokers, or advises on** financing.

---

## Amendment A — Feature/flow (§5.4 Guided interview / §6.4 advanced filters)

Add a new bullet to the guided-interview / advanced-filter feature description:

> **Installments availability (source metadata).** For annual-rent listings, the guided flow may
> offer an optional *"offers installments / rent-now-pay-later"* filter. It is a faithful pass-through
> of a boolean the source listing itself advertises: Ezhalah surfaces it **only when the source states
> it**, filters **solely on that flag**, and shows it as a neutral badge. Ezhalah does **not** compute,
> estimate, originate, broker, rank, or advise on any payment plan; tapping the card opens the source
> platform exactly as any other listing. Coverage is source-dependent — today it is concentrated on a
> subset of platforms — so the filter narrows results to listings that advertise it and **never implies
> the option is unavailable elsewhere**.

---

## Amendment B — AI Agent hard rules (§7.1)

**Keep the existing "Never" box verbatim** (unchanged):

> *Recommend a property · say which is "best / better / good value / a great deal" · give buying or
> financial advice · make a decision for the user · invent or verify listing facts.*

**Add a new "May (neutral pass-through)" note directly beneath the Never/Always boxes:**

> **May — neutral pass-through.** Display and filter on financing/installment options that a **source
> listing itself advertises** (e.g. rent-now-pay-later), as neutral factual metadata — surfaced
> verbatim, filtered only on the source's own flag. This is the same principle as reporting a
> listing's price or area: stating what the source says.
>
> This does **not** relax any "Never." Ezhalah still must not: recommend or rank financing offers;
> compute or estimate payments, instalment amounts, interest, or affordability; originate or broker
> financing; redirect to a lender or payment processor; or give buying or financial advice. It
> surfaces the *existence* of the option as stated by the source, and nothing more.

*(Optional, if a behavior-matrix row is wanted in §7.2):*

| User input | Ezhalah response | Shows listings? |
|---|---|---|
| "show me places with installments / rent now pay later" | Applies the source-advertised installments filter and shows matching listings; no payment math or advice. | Yes (filtered) |
| "how much would the monthly payment be?" | "I can't work out payment amounts or give financial advice — I only show which listings advertise installments. You can check the terms with the source." | No (until re-scoped) |

---

## What explicitly stays unchanged
- **All existing §7.1 prohibitions** (verbatim) — no recommendation, no "best/good deal", no advice,
  no deciding for the user, no inventing/verifying facts.
- **§10 compliance (REGA FAL, PDPL)** — unaffected. This is *display of third-party-advertised
  metadata*, not a financial service offered by Ezhalah. No new license surface.
- **Neutrality** — the filter ranks nothing and recommends nothing; it only includes/excludes on a
  factual source flag, identical to every other structured filter (price, area, bedrooms, age).
- **Fidelity** — the flag is passed through exactly as the source stores it; never inferred, computed,
  or defaulted. (`feedback_listing-fidelity-absolute-rule`.)

## Data reality the owner should weigh when approving
- **9,056 annual-rent apartments** advertise installments today = **38%** of the annual apartment pool.
- **100% of them are from Aqar** (73% of Aqar's apartments carry the flag); every other platform = 0.
- Practical effect: turning the filter ON today effectively narrows results to Aqar listings. The
  neutral wording above ("never implies unavailable elsewhere") is what keeps that honest.
