// Builds the spoken script for a property-search response (owner structure requirement, 2026-08-19):
//   "إزهله" -> short pause -> the AI summary -> short pause -> visible property cards, in order,
//   each separated by a short pause. Never reads raw JSON, ids, URLs, source-table names, or any
//   other internal field — every card fact comes from the SAME Arabic display helpers ResultCard.tsx
//   itself uses (src/lib/listingDisplay.ts), so what's spoken can never disagree with what's shown.
import type { Listing } from '@/data/listings';
import { translate } from '@/i18n';
import { listingTypeAr, listingLocationAr, listingPriceAr } from './listingDisplay';
import type { ReadAloudSegment } from './readAloud';

const INTRO_WORD = 'إزهله';
const PAUSE_MS = 450; // short, natural — long enough to read as a beat, not a stall

// How many property cards Read Aloud speaks, even when more are visible on screen (the visual
// first page shows FIRST_PAGE=10 — src/app/agent.tsx). An audio list is harder to track than a
// visual grid: there's no glancing back at card #2 while card #5 is playing, so the spoken cap is
// deliberately LOWER than the visual one. MEASURED (real playback, this session, at the tuned 1.3
// rate): intro + summary + 5 real cards = ~60 seconds total — Arabic prices spoken as full number
// words ("خمسة وثلاثون ألفاً ومئتان وثمانون") run longer than the digits on screen suggest, so this
// is NOT the ~30-45s a naive estimate would give. 60s is still far short of "monologue" territory
// (well under a minute, nowhere near the owner's 10-minute concern), so 5 stays the recommendation —
// but it's the real number the owner should see before confirming this cap, not a guess. Lower to 3
// (~40s) for a snappier feel if 60s reads as long; it's the one constant below.
export const READ_ALOUD_CARD_CAP = 5;

// One card's spoken facts — deliberately just the headline ones already shown at a glance: type,
// district/city, price, bedrooms, bathrooms, area. NOT spoken: id, source_url, source/platform name,
// description/title free text, amenity badges, discount/RNPL panels, "recently added" — matches the
// owner's "don't read every tiny field, keep it concise" instruction, and keeps every field this
// function touches to the ones listingDisplay.ts/the Listing type already expose for display.
function cardSpeech(listing: Listing): string {
  const headline = `${listingTypeAr(listing)} في ${listingLocationAr(listing)}`;
  const price = listingPriceAr(listing);
  const stats: string[] = [];
  if (listing.beds > 0) stats.push(`${listing.beds} ${translate('ar', listing.beds === 1 ? 'Bed' : 'Beds')}`);
  if ((listing.bathrooms ?? 0) > 0) stats.push(`${listing.bathrooms} ${translate('ar', listing.bathrooms === 1 ? 'Bath' : 'Baths')}`);
  if (listing.area > 0) stats.push(`${translate('ar', 'Area')} ${listing.area} ${translate('ar', 'm²')}`);
  const sentences = [headline, price];
  if (stats.length) sentences.push(stats.join('، '));
  return sentences.join('. ');
}

// `visibleListings` must be exactly what's ON SCREEN right now (the caller's own reveal-count
// slice) — never the full fetched set. This function caps further to READ_ALOUD_CARD_CAP but never
// widens past what the caller already decided is visible, so a card still mid-reveal-animation or
// behind an un-tapped «عرض المزيد» is never spoken (owner requirement: "no hidden listing should be
// spoken").
export function buildResultsReadAloudSegments(summaryText: string, visibleListings: Listing[]): ReadAloudSegment[] {
  const segments: ReadAloudSegment[] = [{ text: INTRO_WORD, pauseAfterMs: PAUSE_MS }];
  const summary = summaryText.trim();
  if (summary) segments.push({ text: summary, pauseAfterMs: PAUSE_MS });
  const capped = visibleListings.slice(0, READ_ALOUD_CARD_CAP);
  capped.forEach((listing, i) => {
    segments.push({ text: cardSpeech(listing), pauseAfterMs: i < capped.length - 1 ? PAUSE_MS : 0 });
  });
  return segments;
}
