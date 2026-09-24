// A COUNT SURFACE IS PAIRED TO A CARD BY ITS REQUEST, NEVER BY ARRIVAL ORDER (routine #5, 2026-09-24).
//
// `apartment_guided_counts_ar` is not one call per card. Since `primeFooterCounts` shipped
// (2026-09-21) a tap is followed by a SERIAL WALK that prices every option of the question — one
// call each, ~680 ms apart, measured on production — so "the last response" is the last PRIMED
// OPTION, not the user's selection. A journey that compares the card's chip to the last response
// therefore accuses a perfectly correct card.
//
// Measured on production 2026-09-24 by verify-af-live-truth.ts, both journeys it had run:
//   Residential/Buy/Apartment/الرياض — card 2,968 (المطبخ) vs last response 5,488 (عداد ماء مستقل)
//   Residential/Buy/Villa/الرياض     — card 10,904 vs last response 385
// Both were reported as «the card's count IS the count RPC's cnt_selected: FAIL». Both were false.
//
// The rule is AGENTS.md harness note 3, in one function so no journey re-derives it differently.
// PURE on purpose, so scripts/verify-af-count-pairing-is-by-request.ts can EXECUTE it against a
// synthetic walk instead of grepping for it.

export type CountPair = { body: any; resp: any[] };

/**
 * The count call that priced what the card is showing: the LATEST call whose `cnt_selected` is the
 * number on screen. `null` means no count call explains the chip — which is the real defect the
 * assertion exists for (a chip the client derived rather than fetched).
 *
 * THE WHOLE CONVERSATION, NOT JUST THE CALLS AFTER THE TAP. Measured on production 2026-09-24:
 * tapping an option fires **zero** count calls, because `primeFooterCounts` already priced that
 * option during the search wait and `settledGuidedCounts` remembers it — which is exactly what that
 * walk was built for ("the button's number after the FIRST tap on any option", remote.ts). A rule
 * that only looks after the tap therefore reports «the chip did not come from a count RPC» about a
 * card whose number came from a count RPC a few seconds earlier.
 */
export function pairCountForChip(pairs: readonly CountPair[], chip: number | null): CountPair | null {
  if (chip == null) return null;
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (Number(pairs[i].resp?.[0]?.cnt_selected) === chip) return pairs[i];
  }
  return null;
}

/**
 * The stricter pairing the assertion actually needs: the call that priced the number on screen AND
 * carried the option the user tapped. Searching for BOTH at once matters — the priming walk prices
 * every option, so "some call returned this number" alone would let a card showing a DIFFERENT
 * option's count pass.
 *
 * `via` says how it was identified: `'literal'` when the tapped key is spelled in the body
 * (`p_amenities`, `p_bath_min`, `p_street_width_min`), `'moved'` for a key the body cannot spell —
 * property_age writes `p_is_new_construction: true` for «جديد» — where the fallback is that the body
 * moved off the pre-AF scope. `null` means nothing priced that number, which is a real finding.
 */
export function pairCountForSelection(
  pairs: readonly CountPair[], chip: number | null, tappedKey: string, baseBody: any,
): { paired: CountPair | null; via: 'literal' | 'moved' | null } {
  if (chip == null) return { paired: null, via: null };
  const matches = pairs.filter((p) => Number(p.resp?.[0]?.cnt_selected) === chip);
  for (let i = matches.length - 1; i >= 0; i--) {
    if (pricedTheTappedOption(matches[i], baseBody, tappedKey).literal) return { paired: matches[i], via: 'literal' };
  }
  // THE FALLBACK IS ONLY FOR A KEY THE BODIES CANNOT SPELL. If ANY call in this conversation spelled
  // the tapped key, then the key IS representable for this question and a literal match is required —
  // otherwise «the card shows مواقف's number while the user tapped المطبخ» would pair through the
  // fallback, since parking's body has also "moved off the pre-AF scope". Proven both ways in
  // scripts/verify-af-count-pairing-is-by-request.ts.
  if (pairs.some((p) => pricedTheTappedOption(p, baseBody, tappedKey).literal)) return { paired: null, via: null };
  for (let i = matches.length - 1; i >= 0; i--) {
    if (pricedTheTappedOption(matches[i], baseBody, tappedKey).movedKeys.length) return { paired: matches[i], via: 'moved' };
  }
  return { paired: null, via: null };
}

/**
 * Did that call price the option the user actually tapped? Without this, a card showing some OTHER
 * option's number still finds a match in a walk that prices every option.
 *
 * The key is literal in the body for the token questions (`p_amenities`) and the ladder rungs
 * (`p_bath_min`, `p_street_width_min`). Where it is not representable — property_age writes
 * `p_is_new_construction: true` for «جديد» — `literal` is false and the caller falls back to
 * `movedKeys`, which must be non-empty: the paired body has to have moved off the pre-tap scope.
 */
export function pricedTheTappedOption(paired: CountPair | null, preBody: any, tappedKey: string): {
  literal: boolean; movedKeys: string[]; ok: boolean;
} {
  if (!paired) return { literal: false, movedKeys: [], ok: false };
  const literal = JSON.stringify(paired.body).includes(`"${tappedKey}"`)
    || Object.values(paired.body ?? {}).some((v) => String(v) === tappedKey);
  const movedKeys = preBody
    ? Object.keys({ ...preBody, ...paired.body })
        .filter((k) => JSON.stringify(preBody[k]) !== JSON.stringify(paired.body[k]))
    : [];
  return { literal, movedKeys, ok: literal || movedKeys.length > 0 };
}
