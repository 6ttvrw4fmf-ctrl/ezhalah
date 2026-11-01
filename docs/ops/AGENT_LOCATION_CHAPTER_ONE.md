# AI Agent location Chapter 1

Owner approved installation on 2026-10-14. Deployment and observed production verification are recorded in
[the installation PR](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/7105).
A deployed function or an active note alone does not establish verified behavior.

The model interprets Arabic, English and mixed-language location intent, proposes canonical Arabic
city/district names, and sends the complete intended location in `location_plan`. The edge validates
those proposals with the existing bounded `loc_classify` catalog RPC before allowing a search.
The owner-approved [search controls](AGENT_SEARCH_CONTROLS.md) extend location scope to explicit REGION or NATIONWIDE requests. CITY remains the default and requires exactly one Saudi city. Multiple districts form an OR-set inside that city. A district
without a city can infer its parent only when the full catalog, including zero-inventory places,
leaves exactly one valid city. Inventory popularity cannot choose a location.

Unrelated refinements preserve the confirmed location. Add, replace, remove, clear and new-search
instructions produce a complete new selection; an ambiguous bare district requires clarification.
An explicit city change revalidates the district selection and must disclose incompatible removals.
Unknown names and unsupported geographic constraints stop the search. Connection failures are
reported as failures, never as no listings. Directions, landmarks and radius requests require
validated mapping/capability; without it, the agent asks for a city/district instead of broadening.
The existing clarification budget remains: when exhausted, unresolved geography still cannot search.

The model is responsible for interpreting the requested operation and spelling/alias proposals.
`locationPlan.ts` enforces catalog membership, city uniqueness, district parentage, and bounded
failure handling. This is not a claim that a saved prompt alone implements all validation.
Request-based checks recognize explicit region/nationwide requests; broadening without explicit intent or confirmed scope is refused.
Recognition hints are resolved against the catalog; administrative district aliases are allowed, including
explicitly removed references validated against previous state. Unknown landmarks remain unsupported.
Request-based checks additionally stop unsupported proximity/directional scopes and ambiguous bare
district replacements. Explicit city changes revalidate inherited districts; incompatible removals
use the existing visible `notice` channel. An explicit new-search request clears location context.
`queryFromBackend` consumes the validated full state; the conversation merge respects intentional
empty district selections. Existing property filters and the other chat's reply-language policy remain.

## Release sequence

1. Hold `agent-edge-surface`; merge the code through the repository gate and deploy the frontend
   and agent through their production workflows. The new behavior remains inactive without the marker.
2. Hold `production` and execute `supabase/agent-notes/location-chapter-one.sql` verbatim.
   It replaces note 3, retires conflicting notes 4–7, and reconciles only the location clauses in
   notes 8–9 after exact baseline checks. Unrelated policies stay.
   It refuses to exceed 20,000 wrapper-inclusive characters, below the loader's 21,000 limit.
3. Wait for the 60-second notes cache, then test actual production UI conversations: city, region,
   multiple cities, unique/shared districts, add/replace/remove/clear, city switch, typo/transliteration,
   unknown and unsupported locations, and preservation of unrelated filters. Open a resulting card
   and compare its displayed fields/link with the source. Record observed results before certifying.

Rollback: while holding `production`, run `location-chapter-one.rollback.sql`. It restores only the
seven affected notes, refuses later edits, and removes the activation marker. The code then uses the
prior behavior. `location-chapter-one.before.json` is the exact baseline of those seven notes.

`scripts/verify-agent-location-plan.ts` executes the validator and conversation merge, tests failed
lookups/timeouts, and proves mutations to city uniqueness, district parentage, and full-catalog use
are caught. CI retains the complete existing barrier suite.
