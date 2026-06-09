import type { Deal } from './taxonomy';

// Source listing platforms. (PRD §8.1) Gathern is rent-only and must never appear in Buy.
export type Platform = {
  name: string;
  domain: string;
  brand: string;
  phone: string;
  allowsRent: boolean;
  allowsBuy: boolean;
};

export const PLATFORMS: Platform[] = [
  { name: 'Aqar', domain: 'sa.aqar.fm', brand: 'عقار · Aqar', phone: '+966 5X XXX 1180', allowsRent: true, allowsBuy: true },
  { name: 'Bayut', domain: 'www.bayut.sa', brand: 'bayut', phone: '+966 5X XXX 2204', allowsRent: true, allowsBuy: true },
  { name: 'Gathern', domain: 'gathern.co', brand: 'Gathern', phone: '+966 5X XXX 7781', allowsRent: true, allowsBuy: false },
  { name: 'Property Finder', domain: 'www.propertyfinder.sa', brand: 'Property Finder', phone: '+966 5X XXX 5540', allowsRent: true, allowsBuy: true },
  { name: 'Wasalt', domain: 'wasalt.sa', brand: 'Wasalt', phone: '+966 5X XXX 3360', allowsRent: true, allowsBuy: true },
  { name: 'Aldarim', domain: 'aldarim.sa', brand: 'Aldarim', phone: '+966 5X XXX 4471', allowsRent: true, allowsBuy: true },
];

const BY_NAME: Record<string, Platform> = Object.fromEntries(PLATFORMS.map((p) => [p.name, p]));

export function platform(name: string): Platform {
  return BY_NAME[name] ?? { name, domain: 'ezhalah.app', brand: name, phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true };
}

// Hard rule: a source only appears for deals it supports — keeps Gathern out of every Buy result.
export function supports(name: string, deal: Deal): boolean {
  const p = platform(name);
  return deal === 'Rent' ? p.allowsRent : p.allowsBuy;
}
