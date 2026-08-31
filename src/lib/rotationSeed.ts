// CONTROLLED ROTATION, tier 4 of the MATCH -> DIVERSITY -> PHOTO PREFERENCE -> ROTATION ranking
// hierarchy (owner PERMANENT rule, 2026-08-29). This module owns the ONE thing the client controls:
// what seed string reaches the RPC's p_rotation_seed param. The ordering itself is entirely
// server-side (hashtext() in location_search_candidates_ar) - this module never sorts or shuffles
// anything, it only produces a stable, per-device, slowly-time-drifting token.
//
// REPLACES the old localStorage `ezh_rot:*` revisit-counter mechanism (store.tsx/search.ts,
// 2026-06-27), which rotated a client-side window over an already-fetched, browse-cap-bounded array
// - workable under the old lifetime BROWSE_CAP=100, but broken under the current unbounded
// 100->200->300->... pagination contract (PR #1267, 2026-08-29): windowing an in-memory array can't
// stay correct once "next 100" means a genuinely new server page, and it was degenerate for the
// owner's actual complaint anyway - its counter starts at 0 for every brand-new device, so two
// different first-time visitors searching the same district saw the IDENTICAL top 10. This module's
// seed is generated once per device (not per visit), so it varies from a device's very FIRST search.
//
// deviceToken: a random token minted ONCE per browser and persisted in localStorage - NOT crypto,
// NOT a security value, just needs to differ across devices. No localStorage (SSR/native/private
// mode/storage blocked) -> falls back to a per-load in-memory token, which still makes THAT page
// load's ordering deterministic and stable across its own pagination walk; it just won't persist to
// the next visit, which is a fine, honest degrade (same "no localStorage -> reduced feature, never a
// crash" posture the old ezh_rot mechanism already used).
//
// epoch: a coarse ISO year-week bucket, so a long-lived device's exposure still drifts over calendar
// time instead of freezing on one permutation forever, while staying fixed for the entire duration
// of any one browsing session (a session never straddles a week boundary in a way a user would
// notice mid-scroll).
//
// The seed does NOT fold in the search's own filters. This is deliberate, not an oversight: the
// RPC's hash already mixes in source_table+listing_id, so two different searches naturally get
// uncorrelated relative orderings from the SAME seed string - there is no need to duplicate query
// shape into the seed just to get independent-looking rotations per search.

const STORAGE_KEY = 'ezh_rotation_seed_v1';

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function randomToken(): string {
  // crypto.randomUUID() where available (every modern browser + RN's polyfill); a Math.random()
  // fallback is fine here - this seed is never a security value, only needs to differ across
  // devices, which a few dozen bits of entropy already guarantees for this purpose.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

let inMemoryToken: string | null = null;

function deviceToken(): string {
  let ls: StorageLike | undefined;
  try {
    ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  } catch {
    ls = undefined; // some environments throw just reading the property (private-mode Safari, etc.)
  }
  if (ls) {
    try {
      const existing = ls.getItem(STORAGE_KEY);
      if (existing) return existing;
      const fresh = randomToken();
      ls.setItem(STORAGE_KEY, fresh);
      return fresh;
    } catch {
      // storage present but read/write throws (quota, disabled) - fall through to in-memory
    }
  }
  if (!inMemoryToken) inMemoryToken = randomToken();
  return inMemoryToken;
}

// ISO 8601 week bucket, e.g. "2026-W35". Pure date math, no external deps.
function isoWeekBucket(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// The value to pass as the RPC's p_rotation_seed param. Accepts `now` only so it stays testable
// without faking global Date - production call sites simply omit it.
export function rotationSeed(now: Date = new Date()): string {
  return `${deviceToken()}|${isoWeekBucket(now)}`;
}
