import type { Category, Deal } from './taxonomy';
import { POOLS, LISTED_SEQ, type Listing, type Pools } from './listings';
import { supports } from './platforms';

// A parsed search. Every field optional — empty fields broaden, never dead-end. (PRD §6.1)
export type SearchQuery = {
  deal: Deal;
  location: string;
  category: Category | null;
  type: string | null;
  detail: string | null; // bedrooms value or size band
  priceInput: string; // raw digits
};

export const emptyQuery = (): SearchQuery => ({
  deal: 'Rent',
  location: '',
  category: null,
  type: null,
  detail: null,
  priceInput: '',
});

export const locationPhrase = (q: SearchQuery) => q.location.trim() || 'Saudi Arabia';

export const grouped = (n: number) => n.toLocaleString('en-US');

// Magnitude-based price interpretation. (PRD §6.2) Returns null when no price entered.
export type Price =
  | { kind: 'monthlyRent'; echo: string }
  | { kind: 'annualRent'; echo: string }
  | { kind: 'perMeterBuy'; echo: string }
  | { kind: 'totalBuy'; echo: string }
  | { kind: 'unrealistic'; echo: string };

export function interpretPrice(rawDigits: string, deal: Deal, sizeM2?: number): Price | null {
  const digits = (rawDigits.match(/\d/g) ?? []).join('');
  if (!digits) return null;
  const amount = parseInt(digits, 10);
  if (!amount || amount < 100) {
    return { kind: 'unrealistic', echo: "I couldn't find anything at that price — but here are some similar." };
  }
  if (deal === 'Rent') {
    if (amount <= 25_000) {
      const annual = amount * 12;
      return { kind: 'monthlyRent', echo: `SAR ${grouped(amount)}/mo → SAR ${grouped(annual)}/yr` };
    }
    return { kind: 'annualRent', echo: `SAR ${grouped(amount)}/yr` };
  }
  // Buy
  if (amount <= 50_000) {
    const size = sizeM2 ?? 0;
    if (size > 0) {
      return { kind: 'perMeterBuy', echo: `SAR ${grouped(amount)}/m² × ${size} m² → SAR ${grouped(amount * size)}` };
    }
    return { kind: 'perMeterBuy', echo: `SAR ${grouped(amount)}/m²` };
  }
  return { kind: 'totalBuy', echo: `SAR ${grouped(amount)}` };
}

export type SearchResult = { heading: string; notes: string[]; listings: Listing[] };

function pickPool(q: SearchQuery, pools: Pools): Listing[] {
  const t = q.type?.toLowerCase();
  if (t) {
    if (t.includes('villa')) return pools.villa;
    if (t.includes('apartment') || t === 'floor' || t === 'room') return pools.apartment;
    if (t.includes('land') || t === 'warehouse' || t === 'factory') return pools.land;
  }
  if (q.deal === 'Buy') {
    const amount = parseInt((q.priceInput.match(/\d/g) ?? []).join(''), 10);
    if (amount > 50_000 && amount <= 700_000) return pools.budget;
    return pools.mixBuy;
  }
  return pools.mixRent;
}

const RECENCY = Object.fromEntries(LISTED_SEQ.map((s, i) => [s, i])) as Record<string, number>;

// "Ezhalah!" is reserved for when listings are shown. (PRD §7.3)
function heading(q: SearchQuery): string {
  const what = q.type ?? q.category ?? 'property';
  const verb = q.deal === 'Rent' ? 'to rent' : 'to buy';
  return `Ezhalah! Here are ${what.toLowerCase()}s ${verb} in ${locationPhrase(q)}.`;
}

function notes(q: SearchQuery): string[] {
  const out: string[] = [];
  if (!q.location.trim()) out.push('Searching all of Saudi Arabia — add a city to narrow it down.');
  if (!q.type && !q.category) out.push('Showing a mix of property types.');
  const size = q.detail ? parseInt((q.detail.match(/\d/g) ?? []).join(''), 10) || undefined : undefined;
  const p = interpretPrice(q.priceInput, q.deal, size);
  if (p) out.push(p.kind === 'unrealistic' ? p.echo : `Price: ${p.echo}`);
  return out;
}

// Runs the search and enforces the hard rules: source eligibility per deal (Gathern never in Buy),
// recency ranking, top 5. (PRD §5.5, §8.1, §11 guardrails)
export function runSearch(q: SearchQuery, pools: Pools = POOLS): SearchResult {
  const listings = pickPool(q, pools)
    .filter((l) => l.deal === q.deal)
    .filter((l) => supports(l.source, q.deal))
    .sort((a, b) => (RECENCY[a.listed] ?? 99) - (RECENCY[b.listed] ?? 99))
    .slice(0, 5);
  return { heading: heading(q), notes: notes(q), listings };
}
