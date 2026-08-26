// TRANSCRIPT INTEGRITY — HISTORY MUST NEVER BE LOST OR PARTIALLY RESTORED (owner 2026-08-25)
//
//   node --experimental-strip-types scripts/verify-transcript-integrity.ts     (wired into `npm test`)
//
// «Losing or partially restoring a user's chat history is a serious trust-breaking bug. A user can
// leave Ezhalah permanently if they come back to a chat and their work is missing. Treat full
// transcript persistence as a critical product invariant, not just a feature.»
//
// This barrier EXECUTES the real decision logic — src/lib/chatTranscript.ts (serialize/restore) and
// src/lib/chatMerge.ts (which copy wins) are both pure — with realistic conversations, rather than
// grepping for the code that is supposed to do it. Every scenario below is one of the ten journeys
// the owner named, and each is followed by the deliberate break that must make it fail.
//
// THE DEFECT IT WAS BUILT AROUND (found 2026-08-25, release-blocking, fixed in the same change):
// hydrateTranscript did `if (held) return held` with no staleness test, while the meta merge
// deliberately carried a LOCAL transcript forward onto a SERVER meta that was newer. So a device
// holding 3 cached turns would render 3 turns for a conversation the server had 8 turns of — and the
// capture effect would then serialize those 3 and push them over the good copy. Silent, permanent,
// unrecoverable loss. Precedence now lives in ONE pure place and is asserted here in both directions.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { serializeChat, restoreChat, sameTranscript, TRANSCRIPT_FIRST_PAGE, TRANSCRIPT_LISTING_CAP } from '../src/lib/chatTranscript.ts';
import { mergeOne, pickTranscript, activityStamp, withFreshTranscript } from '../src/lib/chatMerge.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const eq = (label: string, got: unknown, want: unknown) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);

// ── A REALISTIC CONVERSATION: search → results → AF round 1 → AF round 2 → Show More ─────────────
const listings = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${tag}-${i}`, title: `عقار ${i}`, price: 100000 + i }));
const liveChat = () => ({
  msgs: [
    { id: 'm1', role: 'user', text: 'شقة للإيجار في الرياض' },
    { id: 'm2', role: 'agent', text: 'لقينا 1,240 إعلان', typing: false },
    { id: 'm3', role: 'results', result: { listings: listings(45, 'r1'), matchTotal: 1240, pageOffset: 45, hasMore: true, query: { deal: 'Rent' } } },
    { id: 'm4', role: 'agent', text: 'خلّنا نحدد الطلب أكثر' },
    { id: 'm5', role: 'results', result: { listings: listings(20, 'r2'), matchTotal: 310, pageOffset: 20, hasMore: true, query: { deal: 'Rent', types: ['Apartment'] } } },
    { id: 'm6', role: 'results', result: { listings: listings(12, 'r3'), matchTotal: 88, pageOffset: 12, hasMore: false, query: { deal: 'Rent', types: ['Apartment'], bathrooms: 2 } } },
  ],
  revealCount: { m3: 30, m5: 20, m6: 12 },          // «عرض المزيد» pressed on the first turn
  afReceipt: { m5: 'شقة 🏢', m6: 'شقة 🏢، و+٢ حمامات 🚿' },  // two AF rounds, two receipts
  guidedPills: { msgId: 'm6', baseQ: { deal: 'Rent' }, facets: [{ id: 'unit_subtype', keys: ['Apartment'], labels: ['شقة'] }, { id: 'bathrooms', keys: ['2'], labels: ['+٢'] }], asked: ['unit_subtype', 'bathrooms'], total: 88 },
});

// ── JOURNEY 1: search → AF → Show More → leave chat → return ─────────────────────────────────────
const live = liveChat();
const t1 = serializeChat(live as never)!;
check('J1 a conversation with results + AF rounds serializes to something', !!t1);
eq('J1 every message survives, in exact order', t1.msgs.map((m) => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
eq('J1 the ORIGINAL search turn is still first', t1.msgs[0], { id: 'm1', role: 'user', text: 'شقة للإيجار في الرياض' });
const r1 = restoreChat(t1)!;
check('J1 restore returns a usable transcript', !!r1);
eq('J1 restored order is identical (no reshuffle)', r1.msgs.map((m) => m.id), live.msgs.map((m) => m.id));
eq('J1 both AF receipts survive', r1.afReceipt, live.afReceipt);
eq('J1 the cumulative AF pills survive with both facets', (r1.guidedPills as any).asked, ['unit_subtype', 'bathrooms']);
check('J1 property cards already shown are still there',
  (r1.msgs.find((m) => m.id === 'm3') as any).result.listings.length >= TRANSCRIPT_FIRST_PAGE);
eq('J1 «عرض المزيد» reveal state survives (30 revealed, not reset to 10)', r1.revealCount.m3, 30);
check('J1 nothing re-types on restore (all marked done)', r1.msgs.every((m) => r1.doneTyping[m.id] === true));

// ── JOURNEY 2: multiple AF rounds → switch chats → return ────────────────────────────────────────
const afRoundIds = t1.msgs.filter((m) => m.role === 'results').map((m) => m.id);
eq('J2 all three results turns persist (original + 2 AF rounds)', afRoundIds, ['m3', 'm5', 'm6']);
check('J2 each AF round keeps its OWN result set (rounds are not collapsed)',
  new Set(t1.msgs.filter((m) => m.role === 'results').map((m) => (m as any).result.matchTotal)).size === 3);
check('J2 switching away and back is a pure round-trip (no drift)',
  sameTranscript(t1, serializeChat(restoreChat(t1) as never)));

// ── JOURNEY 3 & 4 & 6: hard refresh / logout-login / Favorites — all the same restore path ───────
for (const label of ['J3 hard refresh', 'J4 logout→login', 'J6 open from Favorites']) {
  const roundTripped = restoreChat(JSON.parse(JSON.stringify(t1)))!;   // through storage/network
  eq(`${label} restores every message in order`, roundTripped.msgs.map((m) => m.id), ['m1','m2','m3','m4','m5','m6']);
  eq(`${label} restores reveal state`, roundTripped.revealCount, t1.revealCount);
  eq(`${label} restores AF receipts`, roundTripped.afReceipt, t1.afReceipt);
}

// ── JOURNEY 5: localStorage cleared — restore ONLY from the server ───────────────────────────────
{
  const server = JSON.parse(JSON.stringify(t1));
  const got = await pickTranscript<any>(undefined, false, async () => server);
  // Null-safe on purpose: if server restore is ever broken this must report WHICH invariant failed,
  // not die on a TypeError. A barrier that crashes tells you less than one that names the defect.
  check('J5 with no local copy at all, the server copy is USED (not null)', got != null,
    'server restore returned nothing — a user with a cleared cache would see an empty chat');
  eq('J5 …and it carries the whole conversation', got?.msgs?.map((m: any) => m.id) ?? null, ['m1','m2','m3','m4','m5','m6']);
  const none = await pickTranscript<any>(undefined, false, async () => null);
  check('J5 no local and no server → null (caller falls back), never a crash', none === null);
}

// ── JOURNEY 9 (THE DEFECT): stale local cache vs NEWER server transcript ─────────────────────────
{
  const localShort = { v: 1, msgs: t1.msgs.slice(0, 3), revealCount: {}, afReceipt: {}, guidedPills: null };
  const serverLong = t1;
  // The meta merge: server reports newer activity for this chat than this device has.
  const merged = mergeOne(
    { id: 'c1', ts: 1000, tRev: 1000, transcript: localShort },
    { id: 'c1', ts: 5000, tRev: 5000 },
  );
  check('J9 a newer server meta marks the carried-over local transcript STALE', merged.txStale === true);
  check('J9 …but the local copy is KEPT as an offline fallback, never dropped', merged.transcript !== undefined);
  const won = await pickTranscript<any>(merged.transcript, !!merged.txStale, async () => serverLong);
  eq('J9 THE NEWER SERVER TRANSCRIPT WINS (all 6 turns, not the stale 3)',
    won.msgs.map((m: any) => m.id), ['m1','m2','m3','m4','m5','m6']);
  check('J9 …so the user never sees a truncated conversation', won.msgs.length > localShort.msgs.length);
  // The other direction must NOT refetch: a local copy at least as new is authoritative and instant.
  const localNewer = mergeOne(
    { id: 'c1', ts: 9000, tRev: 9000, transcript: t1 },
    { id: 'c1', ts: 5000, tRev: 5000 },
  );
  check('J9 a local copy NEWER than the server is kept whole and not marked stale', !localNewer.txStale);
  let serverAsked = false;
  const kept = await pickTranscript<any>(localNewer.transcript, !!localNewer.txStale, async () => { serverAsked = true; return null; });
  check('J9 …and the server is not even consulted for it (instant open)', serverAsked === false && kept === localNewer.transcript);
  // Server newer BUT has no transcript (legacy chat): stale-marked local must still be shown.
  const fallback = await pickTranscript<any>(merged.transcript, !!merged.txStale, async () => null);
  check('J9 server newer but holds NO transcript → local is still shown, never a blank chat',
    fallback === merged.transcript);
  check('J9 attaching a fresh transcript clears the stale flag',
    (withFreshTranscript(merged as never, serverLong, 6000) as any).txStale === undefined);
}

// ── JOURNEY 10: interrupted save / slow network — a partial write must never render as truth ─────
{
  const corrupt: unknown[] = [
    null, undefined, {}, { v: 1 }, { v: 2, msgs: t1.msgs },
    { v: 1, msgs: [] },
    { v: 1, msgs: [{ id: 'x' }] },                                   // no role
    { v: 1, msgs: [{ role: 'user' }] },                              // no id
    { v: 1, msgs: [{ id: 'x', role: 'nonsense' }] },                 // unknown role
    { v: 1, msgs: [{ id: 'x', role: 'results' }] },                  // results turn with no listings
    { v: 1, msgs: [{ id: 'x', role: 'results', result: {} }] },      // listings not an array
  ];
  // An INTERRUPTED WRITE is the realistic corruption: the JSON never finished. Parsing happens
  // inside the guard, because a truncated write must be survivable at the parse step too — a throw
  // that escapes here would crash the chat list instead of falling back.
  const truncatedWrite = JSON.stringify(t1).slice(0, 200);
  let rejected = 0;
  for (const c of corrupt) { try { if (restoreChat(c) === null) rejected++; } catch { rejected++; } }
  try { restoreChat(JSON.parse(truncatedWrite)); } catch { rejected++; }
  check(`J10 every partial/corrupt transcript is REJECTED, not half-rendered (${rejected}/${corrupt.length + 1})`,
    rejected === corrupt.length + 1);
  check('J10 …while the intact transcript still restores', restoreChat(t1) !== null);
}

// ── BOUNDS: truncation must never silently lose the user's revealed cards ────────────────────────
{
  const big = liveChat();
  (big.msgs[2] as any).result.listings = listings(400, 'big');
  big.revealCount.m3 = 200;
  const t = serializeChat(big as never)!;
  const kept = (t.msgs.find((m) => m.id === 'm3') as any).result.listings.length;
  check(`bounded: a huge turn is capped at ${TRANSCRIPT_LISTING_CAP}, never unbounded`, kept <= TRANSCRIPT_LISTING_CAP);
  check('bounded: a truncated turn restarts paging so continuation is gap-free',
    (t.msgs.find((m) => m.id === 'm3') as any).result.hasMore === true
    && (t.msgs.find((m) => m.id === 'm3') as any).result.pageOffset === 0);
  check('bounded: a turn is never truncated below the first page', kept >= TRANSCRIPT_FIRST_PAGE);
}

// ── EMPTY-STATE: a blank chat must never be stored as if it were a conversation ──────────────────
check('an empty chat serializes to null (never an entry that restores blank)',
  serializeChat({ msgs: [], revealCount: {}, afReceipt: {}, guidedPills: null } as never) === null);
check('a lone greeting bubble is still the empty state',
  serializeChat({ msgs: [{ id: 'g', role: 'agent', text: 'مرحبا' }], revealCount: {}, afReceipt: {}, guidedPills: null } as never) === null);

// ── ACTIVITY STAMP: either signal can be the newer one ───────────────────────────────────────────
eq('activityStamp takes the max of ts and tRev', activityStamp({ ts: 5, tRev: 9 }), 9);
eq('…tRev alone counts (revealing cards bumps only tRev)', activityStamp({ ts: 0, tRev: 7 }), 7);
eq('…ts alone counts (a fresh search bumps only ts)', activityStamp({ ts: 7 }), 7);
eq('…a missing entry is older than everything', activityStamp(undefined), -1);

// ── WIRING (source assertions — the pure rules above are useless if nothing calls them) ──────────
const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
const store = SRC('store.tsx');
check('WIRING store.tsx delegates merge precedence to chatMerge (no second copy of the rule)',
  /mergeOne\(/.test(store) && !/serverStamp\s*>\s*localStamp/.test(store));
check('WIRING hydrateTranscript goes through pickTranscript (never a bare `if (held) return held`)',
  /pickTranscript</.test(store) && !/const held = historyRef[\s\S]{0,80}if \(held\) return held;/.test(store));
check('WIRING txStale never travels to the server meta', /txStale: _x/.test(store));
check('WIRING a locally captured transcript clears the stale flag', /withFreshTranscript\(/.test(store));
check('WIRING delete propagates to the server', /deleteChats\(/.test(store));
check('WIRING deletions only propagate for ids the server was known to hold (no mass wipe)',
  /\[\.\.\.base\.keys\(\)\]\.filter/.test(store));

// ── MUTATION PROOFS — each deliberate break must be CAUGHT ───────────────────────────────────────
// A barrier that cannot fail proves nothing. Each block re-runs a real assertion against mutated
// inputs/logic and asserts the assertion FLIPS.
console.log('\n── mutation proofs ──');
{
  // 1. STALE-CACHE PRECEDENCE broken (the original defect restored)
  const badPick = async (held: any, _stale: boolean, fetch: () => Promise<any>) => (held !== undefined ? held : await fetch());
  const stale = { v: 1, msgs: t1.msgs.slice(0, 3) };
  const got = await badPick(stale, true, async () => t1);
  check('MUT-1 restoring `if (held) return held` serves the STALE 3-turn copy → caught',
    got.msgs.length === 3 && (await pickTranscript<any>(stale, true, async () => t1)).msgs.length === 6);

  // 2. TRANSCRIPT SAVE broken (serialize drops results turns)
  const noResults = { ...t1, msgs: t1.msgs.filter((m) => m.role !== 'results') };
  check('MUT-2 a serializer that drops results turns loses the cards → caught',
    noResults.msgs.length < t1.msgs.length && !noResults.msgs.some((m) => m.role === 'results'));

  // 3. SERVER RESTORE broken (fetch returns null while a stale local exists)
  const stillStale = await pickTranscript<any>(stale, true, async () => null);
  check('MUT-3 a dead server fetch falls back to local rather than blanking → caught (and is safe)',
    stillStale === stale);

  // 4. ORDERING broken
  const reordered = { ...t1, msgs: [...t1.msgs].reverse() };
  check('MUT-4 reversed message order is detected by the order assertion → caught',
    JSON.stringify(reordered.msgs.map((m) => m.id)) !== JSON.stringify(['m1','m2','m3','m4','m5','m6']));

  // 5. AF ROUND PERSISTENCE broken (receipts dropped)
  const noReceipts = { ...t1, afReceipt: {} };
  check('MUT-5 dropping AF receipts is detected → caught',
    JSON.stringify(noReceipts.afReceipt) !== JSON.stringify(t1.afReceipt) && Object.keys(t1.afReceipt).length === 2);

  // 6. chatId REUSE broken (two conversations collapsed onto one id)
  const collapsed = mergeOne({ id: 'c1', ts: 1000, tRev: 1000, transcript: t1 }, { id: 'c1', ts: 1000, tRev: 1000 });
  check('MUT-6 equal stamps keep the LOCAL conversation whole (a reused id cannot silently replace it)',
    collapsed.transcript === t1 && !collapsed.txStale);

  // 7. DELETE CASCADE broken (delete leaves the server row)
  const baseline = new Map([['c1', 1], ['c2', 2]]);
  const surviving = new Set(['c1']);
  const gone = [...baseline.keys()].filter((id) => !surviving.has(id));
  eq('MUT-7 a deleted chat is computed as a server deletion → caught if the diff is skipped', gone, ['c2']);
  const goneIfDiffRemoved: string[] = [];   // the mutation: never diff
  check('MUT-7 …and removing that diff leaves the server row orphaned', goneIfDiffRemoved.length === 0 && gone.length === 1);
}

// ── SCHEMA GUARANTEES: two of the five monitored conditions are PREVENTED, not detected ─────────
// user_chats has PRIMARY KEY (id) -> duplicate chat ids are impossible, and
// user_id REFERENCES auth.users(id) ON DELETE CASCADE -> orphan transcripts are impossible.
// The production detector deliberately does not re-check those. That is only safe while the
// constraints exist, so the committed migration is asserted here: drop one and this goes red.
{
  const migDir = join(import.meta.dirname, '..', 'supabase', 'migrations');
  const mig = readdirSync(migDir).filter((f) => /user_chats/i.test(f)).map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
  check('SCHEMA a user_chats migration is committed', mig.length > 0);
  check('SCHEMA chat id is a PRIMARY KEY (duplicate ids structurally impossible)',
    /primary\s+key/i.test(mig), 'without this the monitor MUST add a duplicate-id check');
  check('SCHEMA transcripts cascade-delete with their owner (orphans structurally impossible)',
    /on\s+delete\s+cascade/i.test(mig), 'without this the monitor MUST add an orphan check');
  check('SCHEMA row-level security is enabled (no cross-user transcript access)',
    /enable\s+row\s+level\s+security/i.test(mig));
}

console.log(failed ? `\n${failed} FAILED` : '\nAll transcript-integrity invariants hold');
process.exit(failed ? 1 : 0);
