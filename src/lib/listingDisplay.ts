// Arabic-locked listing display facts — the SAME derivation ResultCard.tsx uses for its own
// headline (type / location / price), extracted so a second consumer (Read Aloud, owner 2026-08-19)
// can never say something that disagrees with what the card actually shows. Always resolves to
// Arabic regardless of the app's current UI locale — Read Aloud is Arabic-only by product decision,
// independent of whichever locale the visible screen happens to be in.
import type { Listing } from '@/data/listings';
import { translate, tPrice, LOCATION_UNRESOLVED_AR, TYPE_UNRESOLVED_AR } from '@/i18n';
import { arabicOrPlaceholder } from './arabicText';

// #1 (source-accurate, mirrors ResultCard.tsx): the RAW scraped type when it's already Arabic, else
// the clean-type mapping translated to Arabic — never leaks a raw English type string.
export function listingTypeAr(listing: Listing): string {
  return arabicOrPlaceholder(
    /[ء-ي]/.test(listing.type || '') ? listing.type : translate('ar', listing.cleanType ?? listing.type),
    'ar',
    TYPE_UNRESOLVED_AR,
  );
}

// District + city, Arabic-canonical (mirrors ResultCard's `place(...)/{cityAr}` headline).
export function listingCityAr(listing: Listing): string {
  return arabicOrPlaceholder(translate('ar', listing.city), 'ar', LOCATION_UNRESOLVED_AR);
}
export function listingLocationAr(listing: Listing): string {
  const city = listingCityAr(listing);
  return listing.district ? `${listing.district}، ${city}` : city;
}

// Pre-formatted price string, Arabic currency/period suffixes (mirrors ResultCard's `tPrice(listing.price)`).
export function listingPriceAr(listing: Listing): string {
  return tPrice(listing.price, 'ar');
}

// Platform display name from the raw scraped `source` slug — MOVED here from ResultCard.tsx
// (owner request, 2026-08-22: speak the platform after each card) so Read Aloud and the visible
// "مستضاف على X" badge share this ONE mapping instead of two copies drifting apart. ResultCard.tsx
// imports this back for its own badge/host-name text. Exhaustive per-platform matching preserved
// verbatim, including the Al Khaas space/no-space fix (found live 2026-07-25).
export function sourceName(source: string): string {
  // SPACING IS NOT IDENTITY (production defect, 2026-09-04). Every branch below tests a closed-up
  // slug, but the DB `source` value is a human brand string that often carries SPACES: production
  // stores 'Abr Alosol', 'THE RC' and 'Rawasi Dark', so `includes('abralosol' | 'therc' |
  // 'rawasidark')` all missed and 3,165 live listings fell through to the Aqar fallback below —
  // Aqar's name, Aqar's logo, and a click-through to sa.aqar.fm on another company's listing. Same
  // trap that hit 'Al Khaas' and 'Al Nokhba', which were each patched one-off with an extra alias.
  // Searching BOTH the raw string and a space-stripped copy retires the whole class instead of the
  // next instance of it: a spaced brand and its slug now match the same branch, and the existing
  // spaced tokens ('al khaas') keep working because the raw form is still in the haystack. The '|'
  // separator cannot appear in any token, so nothing can match across the join.
  const raw = source.toLowerCase();
  const s = raw + '|' + raw.replace(/\s+/g, '');
  if (s.includes('wasalt')) return 'Wasalt';
  if (s.includes('aldarim')) return 'Aldarim Real Estate';
  if (s.includes('aqargate')) return 'Aqar Gate';
  if (s.includes('alhoshan')) return 'Al Hoshan';
  if (s.includes('hajer')) return 'Hajer Houses Real Estate';
  if (s.includes('sanadak')) return 'Sanadak';
  if (s.includes('eastabha')) return 'East Abha Real Estate';
  if (s.includes('aqarcity')) return 'Aqar City';
  if (s.includes('raghdan')) return 'Raghdan Real Estate';
  if (s.includes('eaqartabuk')) return 'Eqar Tabuk';
  if (s.includes('satel')) return 'Satel';
  if (s.includes('sadin')) return 'Sadin for Real Estate';
  if (s.includes('toor')) return 'TOOR';
  if (s.includes('mustqr')) return 'Mustaqarr Real Estate';
  if (s.includes('ramzalqasim')) return 'Ramz Al Qassim Real Estate Investment';
  if (s.includes('fursaghyr')) return 'Fursa Ghyr Real Estate';
  if (s.includes('jazwtn')) return 'Jazan Watan';
  if (s.includes('mizlaj')) return 'Mizlaj Real Estate';
  if (s.includes('muktamel')) return 'Muktamel';
  if (s.includes('aqaratikom')) return 'Nawait';
  // 'Shmou Al Shmal' is stored WITH spaces, so this branch matches only through the space-stripped
  // half of `s` above — the exact mechanism the 2026-09-04 fix added. Verified by
  // verify-platform-identity-matches-live-source.ts, which feeds it the real stored string.
  if (s.includes('shmoualshmal')) return 'Shmou Al Shmal Real Estate';
  if (s.includes('alta')) return 'Alta Real Estate Services';
  if (s.includes('awal')) return 'Awal United for Real Estate';
  // DB source value is 'Al Khaas' (with a space, confirmed live, 0 exceptions) — 'alkhaas' alone never
  // matched it, so every Al Khaas listing silently fell through to the AQAR default (wrong name/host/
  // logo, found live 2026-07-25). Also match the no-space form in case that ever appears.
  if (s.includes('al khaas') || s.includes('alkhaas')) return 'Al Khaas';
  if (s.includes('abeea')) return 'Abeea Real Estate';
  if (s.includes('jurash')) return 'Jurash Real Estate';
  if (s.includes('al nokhba') || s.includes('alnokhba')) return 'Al Nokhba';
  if (s.includes('gathern')) return 'Gathern';
  if (s.includes('deal')) return 'Deal App';
  if (s.includes('souq')) return '24 Souq';
  if (s.includes('pulse')) return 'Era Pulse';
  if (s.includes('nowaisiry')) return 'Al Nowaisiry Real Estate';
  if (s.includes('october')) return '1 October Real Estate';
  if (s.includes('therc')) return 'The Right Choice Real Estate';
  if (s.includes('aouj')) return 'Aouj Estates';
  if (s.includes('abralosol')) return 'Abr Al Osol Real Estate';
  if (s.includes('arkaan')) return 'Arkaan Al Aqar';
  if (s.includes('rawasidark')) return 'Rawasi Dark Real Estate';
  return 'AQAR';
}

// The exact "مستضاف على X" phrase Read Aloud speaks after each card (owner 2026-08-22) — reuses the
// SAME 'Hosted on {name}' i18n key the visible card badge renders (ResultCard.tsx), so the spoken
// platform name can never drift from what's shown.
export function listingPlatformAr(listing: Listing): string {
  return translate('ar', 'Hosted on {name}', { name: translate('ar', sourceName(listing.source)) });
}
