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
  { name: 'Eaqartabuk', domain: 'eaqartabuk.com', brand: 'Eqar Tabuk', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Satel', domain: 'satel.sa', brand: 'Satel', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Sadin', domain: 'sadin.com.sa', brand: 'Sadin for Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Toor', domain: 'toor.ooo', brand: 'TOOR', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Mustqr', domain: 'mustqr.sa', brand: 'Mustaqarr Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Ramzalqasim', domain: 'ramzalqasim.com', brand: 'Ramz Al Qassim Real Estate Investment', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Fursaghyr', domain: 'fursaghyr.com', brand: 'Fursa Ghyr Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Jazwtn', domain: 'jazwtn.sa', brand: 'Jazan Watan', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Mizlaj', domain: 'mizlaj.com.sa', brand: 'Mizlaj Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Muktamel', domain: 'muktamel.com', brand: 'Muktamel', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Aqaratikom', domain: 'nawait.sa', brand: 'Nawait', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Bahadhabab', domain: 'bahadhabab-res.com', brand: 'Bahadhabab Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Alobid', domain: 'alobidoffice.com', brand: 'Alobid Office Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Abwbna', domain: 'abwbna.com', brand: 'Abwbna Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Azdad', domain: 'azdadalaqaria.com', brand: 'Azdad Al Aqariah', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Remal', domain: 'remalre.com', brand: 'Remal Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Amaall', domain: 'amaall.com', brand: 'Amaall Real Estate Services', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Amlakalahsa', domain: 'amlakalahsa.com', brand: 'Amlak Al-Ahsa Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Aqaralsaudia', domain: 'aqaralsaudia.com', brand: 'Aqar Al Saudia Real Estate', phone: '+966 5X XXX 0000', allowsRent: false, allowsBuy: true },
  { name: 'Suwar', domain: 'suwar.sa', brand: 'Suwar Real Estate', phone: '+966 5X XXX 0000', allowsRent: false, allowsBuy: true },
  { name: 'Rakez', domain: 'rakez.sa', brand: 'Rakez Real Estate', phone: '+966 5X XXX 0000', allowsRent: false, allowsBuy: true },
  { name: 'Akariyoun', domain: 'akariyoun.sa', brand: 'Akariyoun', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'KSA Aqar', domain: 'ksaaqar.com', brand: 'KSA Aqar Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Sadiq Eltajer', domain: 'sadiq-eltajer.sa', brand: 'Sadiq Eltajer Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Alta', domain: 'alta.com.sa', brand: 'Alta Real Estate Services', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Shmou Al Shmal', domain: 'shmoua-alshmal.com', brand: 'Shmou Al Shmal Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Awal', domain: 'awaalun.com', brand: 'Awal United for Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Khaas', domain: 'alkhaas.net', brand: 'Al Khaas', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Abeea', domain: 'abeea.com.sa', brand: 'Abeea Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Jurash', domain: 'jurash.sa', brand: 'Jurash Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Nokhba', domain: 'alnokhba-services.com', brand: 'Al Nokhba', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Gathern', domain: 'gathern.co', brand: 'Gathern', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: false },
  // Aqar Monthly = Aqar's DailyRenting (short-stay/monthly) vertical, same site (sa.aqar.fm), own
  // source/table — architecturally identical to Gathern (monthly-only, no commercial table). Without
  // this entry, platform()'s permissive fallback (allowsBuy: true) would let it leak into Buy results
  // if remote.ts's table-fetch gate ever changed. See remote.ts MONTHLY_ONLY_TABLE / resTables.
  { name: 'Aqar Monthly', domain: 'sa.aqar.fm', brand: 'عقار · Aqar (شهري)', phone: '+966 5X XXX 1180', allowsRent: true, allowsBuy: false },
  { name: 'Deal App', domain: 'dealapp.sa', brand: 'Deal App', phone: '+966 5X XXX 7700', allowsRent: true, allowsBuy: true },
  { name: '24 Souq', domain: '24.com.sa', brand: '24 Souq', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Era Pulse', domain: 'erapulse.sa', brand: 'Era Pulse', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Nowaisiry', domain: 'alnowaisiry.com', brand: 'Al Nowaisiry Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'THERC', domain: 'therc.sa', brand: 'The Right Choice Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Aouj', domain: 'aoujestates.com', brand: 'Aouj Estates', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Abralosol', domain: 'abralosol.com', brand: 'Abr Al Osol Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Arkaan', domain: 'arkaanalaqar.com', brand: 'Arkaan Al Aqar', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  // onboarded 2026-09-21. `name` is the EXACT stored db `source` (the scraper's SOURCE constant), so
  // supports(l.source) resolves these rows by name and verify-platform-registration-complete.ts
  // runs the card matchers over the real stored strings, not a spelling this file chose.
  { name: 'Al Sidra', domain: 'alsidra.com.sa', brand: 'Al Sidra Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Moftah', domain: 'moftah-aleaqar.com', brand: 'Moftah Al Aqar', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'مسار المستقبل', domain: 'masaraqarat.com', brand: 'Masar Al Mustaqbal Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'منصات', domain: 'gomenassat.com', brand: 'Menassat Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Sakan Saudi', domain: 'sa.sakan.co', brand: 'Sakan', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'مكتب بوصبيح', domain: 'bossbihoffice.com.sa', brand: 'Bossbih Real Estate Office', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Shawaf', domain: 'alshawaf.com.sa', brand: 'Al Shawaf Real Estate Office', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Ibrahim Alqarawi', domain: 'ialqarawi.com', brand: 'Ibrahim Alqarawi Real Estate Investments', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Al Jassim', domain: 'aljassimaqar.com', brand: 'Al Jassim Real Estate Services', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Almotmkenah', domain: 'almotmkenah.com', brand: 'Almotmkenah Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'نفوذ', domain: 'nufouth.com', brand: 'Nufouth Development Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'RawasiDark', domain: 'rawasi-dark.com', brand: 'Rawasi Dark Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: '1 October', domain: '1october.com.sa', brand: '1 October Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  // Onboarded 2026-09-20 (#3320). Deals from production search_listings_ar, except Fahadalshahri:
  // 0 rent rows today, but its scraper maps «للإيجار» to Rent — absence is not incapability.
  // CompoundIn's scraper hardcodes Rent, so it can never produce a Buy row.
  { name: 'Gudai', domain: 'gudai.inblaj.net', brand: 'Gudai Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Safera', domain: 'safera.inblaj.net', brand: 'Safera Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Aqarnajran', domain: 'aqarnajran.com', brand: 'Aqar Najran', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'Fahadalshahri', domain: 'fahadalshahri.com', brand: 'Maqam Al Wisam Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
  { name: 'CompoundIn', domain: 'compoundin.com', brand: 'CompoundIn', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: false },
  { name: 'Waslna', domain: 'wslnaa.com', brand: 'Waslna Real Estate', phone: '+966 5X XXX 0000', allowsRent: true, allowsBuy: true },
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
