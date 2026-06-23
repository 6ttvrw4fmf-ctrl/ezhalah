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
  { name: 'Raghdan', domain: 'raghdan.sa', brand: 'Raghdan Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Eaqartabuk', domain: 'eaqartabuk.com', brand: 'Candles', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Satel', domain: 'satel.sa', brand: 'Satel', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Sadin', domain: 'sadin.com.sa', brand: 'Sadin for Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Toor', domain: 'toor.ooo', brand: 'TOOR', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Mustqr', domain: 'mustqr.sa', brand: 'Mustaqarr Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Ramzalqasim', domain: 'ramzalqasim.com', brand: 'Ramz Al Qassim Real Estate Investment', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Fursaghyr', domain: 'fursaghyr.com', brand: 'Fursa Ghyr Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Jazwtn', domain: 'jazwtn.sa', brand: 'Jazan Watan', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Mizlaj', domain: 'mizlaj.com.sa', brand: 'Mizlaj Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Muktamel', domain: 'muktamel.com', brand: 'Muktamel', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Aqaratikom', domain: 'aqaratikom.com', brand: 'Aqaratikom', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Awal', domain: 'awaalun.com', brand: 'Awal Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Khaas', domain: 'alkhaas.net', brand: 'Al Khaas', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Abeea', domain: 'abeea.com.sa', brand: 'Abeea Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Jurash', domain: 'jurash.sa', brand: 'Jurash Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Nokhba', domain: 'alnokhba-services.com', brand: 'Al Nokhba', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Deal App', domain: 'dealapp.sa', brand: 'Deal App', phone: '+966 5X XXX 7700', allowsRent: true, allowsBuy: true },
  { name: '24 Souq', domain: '24.com.sa', brand: '24 Souq', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Era Pulse', domain: 'erapulse.sa', brand: 'Era Pulse', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Nowaisiry', domain: 'alnowaisiry.com', brand: 'Al Nowaisiry Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: '1 October', domain: '1october.com.sa', brand: '1 October Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
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
