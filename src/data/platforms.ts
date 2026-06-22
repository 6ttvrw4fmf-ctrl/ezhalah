import type { Deal } from './taxonomy';

// Source listing platforms. (PRD §8.1) allowsRent/allowsBuy gate which deals a source can appear in.
// PRODUCT RULE: Ezhalah aggregates SAUDI-OWNED platforms only — we don't carry foreign companies
// operating in the Saudi market (Bayut/EMPG, Property Finder/UAE were removed for this reason).
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
  { name: 'Wasalt', domain: 'wasalt.sa', brand: 'Wasalt', phone: '+966 5X XXX 3360', allowsRent: true, allowsBuy: true },
  { name: 'Aldarim', domain: 'aldarim.sa', brand: 'Aldarim Real Estate', phone: '+966 5X XXX 4471', allowsRent: true, allowsBuy: true },
  { name: 'Aqargate', domain: 'aqargate.com', brand: 'Aqar Gate', phone: '+966 5X XXX 6620', allowsRent: true, allowsBuy: true },
  { name: 'Alhoshan', domain: 'alhoshan.sa', brand: 'Al Hoshan', phone: '+966 5X XXX 8840', allowsRent: true, allowsBuy: true },
  { name: 'Hajer', domain: 'hajerhouses.com', brand: 'Hajer Houses Real Estate', phone: '+966 5X XXX 9910', allowsRent: true, allowsBuy: true },
  { name: 'Sanadak', domain: 'sanadak.sa', brand: 'Sanadak', phone: '+966 5X XXX 1200', allowsRent: true, allowsBuy: true },
  { name: 'Eastabha', domain: 'eastabha.sa', brand: 'East Abha Real Estate', phone: '+966 5X XXX 6662', allowsRent: true, allowsBuy: true },
  { name: 'Aqarcity', domain: 'aqarcity.net', brand: 'Aqar City', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Deal', domain: 'dealapp.sa', brand: 'Deal', phone: '+966 5X XXX 7700', allowsRent: true, allowsBuy: true },
];

const BY_NAME: Record<string, Platform> = Object.fromEntries(PLATFORMS.map((p) => [p.name, p]));

export function platform(name: string): Platform {
  return BY_NAME[name] ?? { name, domain: 'ezhalah.app', brand: name, phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true };
}

// A source only appears for the deals it supports (allowsRent / allowsBuy).
export function supports(name: string, deal: Deal): boolean {
  const p = platform(name);
  return deal === 'Rent' ? p.allowsRent : p.allowsBuy;
}
