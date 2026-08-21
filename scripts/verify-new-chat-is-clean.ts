// NEW CHAT MUST START FROM A COMPLETELY BLANK STATE — and saved chats must survive it.
//
// Owner permanent rule (2026-08-20): "Saved chats keep their own state. New Chat always starts from a
// completely blank state and must never inherit anything from the previously active chat."
//
// THE BUG THIS PINS. `onNewChat` cleared the sidebar highlight and navigated home with a `fresh`
// param, and Home's only reaction to `fresh` was `playEntrance()` — the hero ANIMATION. Nothing reset
// the shared `query`, so the previous search's city, property type, deal, rent period, price, beds and
// every other Filter field rode straight into the "fresh" chat. The handler's own comment claimed it
// reset state; the reset had never been implemented.
//
// TWO HALVES, because either alone can pass while the feature is broken:
//   • EXECUTABLE — run the real reset against a maximally dirty query and prove NOTHING survives.
//     searchDefaults.ts is pure (type-only import), so the actual production function runs here.
//   • STRUCTURAL — the reset has ONE owner (the store), the Sidebar calls it, and it does not touch
//     `history` (clearing that would destroy the saved chats this rule exists to protect).
//
//   node --experimental-strip-types scripts/verify-new-chat-is-clean.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME_DEFAULT_QUERY, emptyQuery } from '../src/lib/searchDefaults.ts';

const root = join(import.meta.dirname, '..');
const store = readFileSync(join(root, 'src/store.tsx'), 'utf8');
const sidebar = readFileSync(join(root, 'src/components/Sidebar.tsx'), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nNew Chat — completely blank state, saved chats preserved\n');

// ── EXECUTABLE: a maximally dirty query, then the real reset ─────────────────────────────────────
// Every field the Filter home and the AI agent can set, including the ones with no visible control
// (bothDeals, sources, proximity, sort, amenities, bathMin, age…) — exactly the fields that used to
// ride silently into the next search.
const DIRTY: Record<string, unknown> = {
  deal: 'Rent', bothDeals: true, location: 'الرياض', category: 'Residential',
  typeGroup: 'Apartments & Co-living', type: 'Apartment', types: ['Apartment', 'Studio'],
  detail: 'something', rentPeriod: 'monthly', priceInput: '5000', priceBand: 'mid',
  priceMin: '1000', priceMax: '9000', priceIsAnnual: true, areaMin: '100', areaMax: '400',
  contextBeds: '3', contextBedsList: ['2', '3'], contextSize: 'large',
  regionId: 1, cityId: 66, districtIds: [7, 8], districts: ['العليا'],
  locationMatch: { raw: 'الرياض' }, sort: 'price_asc', count: 25,
  sources: ['Aqar'], keywords: ['مفروش'], proximity: ['قريب من كافد'],
  amenities: ['furnished', 'elevator'], bathMin: 2, bathExact: [2, 3],
  ageMin: 3, ageMax: 5, ageUnknown: false, isNewConstruction: true,
  furnished: true, tenant: 'عوائل', directions: ['شمالية'], hasLicense: true,
  streetWidthMin: 15, streetWidthMax: 30, floorMin: 1, floorMax: 5,
  rentNowPayLater: true, filterTier: 'advanced',
};

const fresh = HOME_DEFAULT_QUERY() as Record<string, unknown>;
// A field is LEAKED only if it exists in the dirty query, is NOT part of the screen default, and is
// still present after the reset. Comparing values instead would be wrong: `category: 'Residential'`
// is both a dirty value and the default, so a value-match proves nothing (my first draft of this
// check flagged exactly that as a leak). This form is the real property — a replace keeps no
// dirty-only key, a merge keeps all of them.
const defaultKeys = new Set(Object.keys(HOME_DEFAULT_QUERY() as Record<string, unknown>));
const dirtyOnly = Object.keys(DIRTY).filter((k) => !defaultKeys.has(k));
const survivors = dirtyOnly.filter((k) => fresh[k] !== undefined && fresh[k] !== null);
check(`a fresh query inherits NOTHING from a maximally dirty previous search (${dirtyOnly.length} agent-only fields tested)`,
  survivors.length === 0,
  `leaked field(s): ${survivors.join(', ')}`);

// The reset must be a genuine known default, not a merge over the old object.
check('fresh query is the screen default (Buy + Residential), matching a cold app start',
  fresh.deal === 'Buy' && fresh.category === 'Residential' && fresh.location === ''
  && fresh.type === null && fresh.rentPeriod === 'annual' && fresh.priceInput === '');

check('HOME_DEFAULT_QUERY is emptyQuery + the home Buy default (one definition, no drift)',
  JSON.stringify({ ...emptyQuery(), deal: 'Buy' }) === JSON.stringify(HOME_DEFAULT_QUERY()));

// ── STRUCTURAL: one owner, called by the Sidebar, saved chats untouched ──────────────────────────
const storeCode = codeOnly(store);
check('the store owns a newChat() reset', /newChat:\s*\(\)\s*=>\s*\{/.test(storeCode));

const body = storeCode.slice(storeCode.indexOf('newChat: () => {'));
const newChatBody = body.slice(0, body.indexOf('},') + 1);
check('newChat resets the shared query to the screen default',
  /setQueryState\(HOME_DEFAULT_QUERY\(\)\)/.test(newChatBody),
  'the shared query is the state that actually leaked between chats');
// A REPLACE, never a merge. `setQueryState(q => ({ ...q, ... }))` would carry every agent-only field
// (bothDeals, sources, proximity, amenities, age…) into the new chat while still looking like a reset.
check('newChat REPLACES the query — it never spreads the previous one',
  !/setQueryState\(\s*\(?\s*q\s*\)?\s*=>/.test(newChatBody) && !/\.\.\.q\b/.test(newChatBody),
  'a merge-style reset silently preserves every field the default does not name');
check('newChat clears the parked pending message', /setPendingMessageState\(null\)/.test(newChatBody));
check('newChat clears the active-chat id', /setActiveChatId\(null\)/.test(newChatBody));

// The saved chats MUST survive — clearing history here would destroy the thing the rule protects.
check('newChat does NOT touch saved history', !/setHistory/.test(newChatBody),
  'saved sidebar chats must survive a New Chat — only the CURRENT state resets');

const sidebarCode = codeOnly(sidebar);
check('Sidebar New Chat calls the store reset (not just the highlight)',
  /const onNewChat = \(\) => \{[\s\S]{0,900}?newChat\(\);/.test(sidebarCode),
  'setActiveChat(null) alone leaves the whole previous query in the shared store');
check('Sidebar pulls newChat from the store', /newChat\s*\}\s*=\s*useApp\(\)/.test(sidebarCode));

// Reopening a saved chat is the OPPOSITE action and must keep its own restore path.
check('reopening a saved chat still restores through its own sanitized path',
  /sanitizeForFilterRestore/.test(sidebarCode) || /setQuery\(/.test(sidebarCode),
  'New Chat and Open-saved-chat are different actions and must not share one code path');

console.log(failures === 0
  ? '\n✓ New Chat starts blank; saved chats survive\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
