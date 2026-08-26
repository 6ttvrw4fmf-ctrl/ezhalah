// Builds the spoken script for a property-search response (owner structure requirement, 2026-08-19):
//   "إزهله" -> short pause -> the AI summary -> short pause -> visible property cards, in order,
//   each separated by a short pause -> short pause -> the closing "showed you N, want more?" note
//   and its available actions (owner request, 2026-08-23), when the caller supplies one. Never reads
//   raw JSON, ids, URLs, source-table names, or any other internal field — every card fact comes
//   from the SAME Arabic display helpers ResultCard.tsx itself uses (src/lib/listingDisplay.ts), and
//   `closingNote` is text the CALLER already renders on screen (agent.tsx) — never re-derived here
//   — so what's spoken can never disagree with what's shown.
import type { Listing } from '@/data/listings';
import { translate } from '@/i18n';
import { listingTypeAr, listingLocationAr, listingPriceAr, listingPlatformAr } from './listingDisplay';
import type { ReadAloudSegment } from './readAloud';

const INTRO_WORD = 'إزهله';
const PAUSE_MS = 450; // short, natural — long enough to read as a beat, not a stall

// One card's spoken facts — the headline ones already shown at a glance: type, district/city,
// price, bedrooms, bathrooms, area, then the platform it's hosted on (owner request, 2026-08-22:
// "include the platform name also after each property card" — mirrors the card's own visible
// "مستضاف على X" badge via listingPlatformAr, so it can never say a different platform than what's
// shown). Still NOT spoken: id, source_url, description/title free text, amenity badges,
// discount/RNPL panels, "recently added" — matches the owner's "keep it concise" instruction.
function cardSpeech(listing: Listing): string {
  const headline = `${listingTypeAr(listing)} في ${listingLocationAr(listing)}`;
  const price = listingPriceAr(listing);
  const stats: string[] = [];
  if (listing.beds > 0) stats.push(`${listing.beds} ${translate('ar', listing.beds === 1 ? 'Bed' : 'Beds')}`);
  if ((listing.bathrooms ?? 0) > 0) stats.push(`${listing.bathrooms} ${translate('ar', listing.bathrooms === 1 ? 'Bath' : 'Baths')}`);
  if (listing.area > 0) stats.push(`${translate('ar', 'Area')} ${listing.area} ${translate('ar', 'm²')}`);
  const sentences = [headline, price];
  if (stats.length) sentences.push(stats.join('، '));
  sentences.push(listingPlatformAr(listing));
  return sentences.join('. ');
}

// `visibleListings` must be exactly what's ON SCREEN right now (the caller's own reveal-count
// slice) — never the full fetched set, so a card still mid-reveal-animation or behind an un-tapped
// «عرض المزيد» is never spoken (owner requirement: "no hidden listing should be spoken"). No further
// cap here — owner request, 2026-08-22: read every visible card, not just the first few ("it
// doesn't do it for all the cards... do it all"). Previously capped at 5; removed.
//
// `closingNote` (owner request, 2026-08-23 — "read the note... and say the button also"): the same
// «عرضت لك أول N إعلانات...» text + available-action sentence agent.tsx already renders below the
// cards, already composed by the caller from the SAME variables the visible Text/buttons use — this
// function only ever appends it, verbatim, as the final spoken segment. Omit/empty when that block
// isn't rendered (e.g. an Advanced Filter interview is open) — never speak an action that isn't on
// screen to tap.
export function buildResultsReadAloudSegments(summaryText: string, visibleListings: Listing[], closingNote?: string): ReadAloudSegment[] {
  const segments: ReadAloudSegment[] = [{ text: INTRO_WORD, pauseAfterMs: PAUSE_MS }];
  const summary = summaryText.trim();
  if (summary) segments.push({ text: summary, pauseAfterMs: PAUSE_MS });
  const note = closingNote?.trim();
  visibleListings.forEach((listing, i) => {
    const isLast = i === visibleListings.length - 1;
    segments.push({ text: cardSpeech(listing), pauseAfterMs: isLast && !note ? 0 : PAUSE_MS });
  });
  if (note) segments.push({ text: note, pauseAfterMs: 0 });
  return segments;
}
