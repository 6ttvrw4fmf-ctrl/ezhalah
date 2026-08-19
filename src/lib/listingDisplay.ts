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
