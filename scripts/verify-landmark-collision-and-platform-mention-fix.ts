// Regression guard for two bugs found live 2026-07-27 (round-8 filter/backend audit):
//
// 1. src/data/landmarks/index.ts buildIndex() kept first-match-wins per normalized alias key over an
//    UNORDERED Supabase fetch. When 2+ different cities share a normalized alias (e.g. "Salam Park"
//    exists in both Riyadh and Abha — 132 such collisions found live), the loser was silently
//    discarded and the AI Agent's landmark hint confidently committed to the wrong city (its own
//    prompt explicitly says "NEVER ask which city when a landmark is recognized"). Fixed: an alias
//    that maps to 2+ DIFFERENT cities is now dropped entirely from the index rather than guessed.
//
// 2. src/data/agent.ts applySourceFilter() unioned the edge model's own platforms decision with an
//    unconditional regex re-scan of the raw user text — so even when the model correctly decided
//    platforms:[] for an incidental mention ("Gathern's location is nice, I want a villa in Jeddah"),
//    the bare-word regex re-added "gathern" anyway, defeating the exact "NOT A FILTER REQUEST" prompt
//    fix meant to stop this (and silently forcing Rent+monthly, since Gathern is monthly-only). Fixed:
//    when an edge decision exists (edgePlatforms !== undefined, even []), trust it verbatim; the raw-
//    text regex scan is only used for the pure offline parseQuery() fallback path.
//
//   node --experimental-strip-types scripts/verify-landmark-collision-and-platform-mention-fix.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. Landmark alias-collision fix
// ══════════════════════════════════════════════════════════════════════════════════════════════
const landmarksSrc = readFileSync(new URL('../src/data/landmarks/index.ts', import.meta.url), 'utf8');
check('buildIndex() groups by normalized key before deciding a winner', /const groups = new Map<string, Landmark\[\]>\(\)/.test(landmarksSrc));
check('buildIndex() drops a key when its group spans 2+ distinct cities', /new Set\(group\.map\(\(lm\) => lm\.city\)\)\.size > 1\) continue/.test(landmarksSrc));
check('the old bare first-match-wins line is gone', !/if \(k && !m\.has\(k\)\) m\.set\(k, lm\);/.test(landmarksSrc));

// Verbatim copy of the fixed buildIndex() logic, run against synthetic collision data.
type Landmark = { landmark_name: string; aliases: string[]; category: string; region: string; city: string };
const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(al|el|the)\s+/g, '').trim();
function buildIndex(ALL_LANDMARKS: Landmark[]): Map<string, Landmark> {
  const groups = new Map<string, Landmark[]>();
  for (const lm of ALL_LANDMARKS) {
    for (const raw of [lm.landmark_name, ...(lm.aliases ?? [])]) {
      const k = norm(raw);
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(lm); else groups.set(k, [lm]);
    }
  }
  const m = new Map<string, Landmark>();
  for (const [k, group] of groups) {
    if (new Set(group.map((lm) => lm.city)).size > 1) continue;
    m.set(k, group[0]);
  }
  return m;
}

const mk = (name: string, city: string): Landmark => ({ landmark_name: name, aliases: [], category: 'x', region: 'x', city });
const idx1 = buildIndex([mk('Salam Park', 'Riyadh'), mk('Salam Park', 'Abha')]);
check('real repro: "Salam Park" (Riyadh + Abha) is DROPPED, never silently resolved to one', !idx1.has('salam park'));

const idx2 = buildIndex([mk('King Fahd Park', 'Jeddah'), mk('King Fahd Park', 'Jeddah')]);
check('same-city duplicate rows for the same alias are still kept (not ambiguous)', idx2.has('king fahd park') && idx2.get('king fahd park')!.city === 'Jeddah');

const idx3 = buildIndex([mk('PNU', 'Riyadh'), mk('Corniche', 'Jeddah')]);
check('distinct aliases with no collision are both kept', idx3.has('pnu') && idx3.has('corniche'));

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. Client-side platform-mention double-application fix
// ══════════════════════════════════════════════════════════════════════════════════════════════
const agentSrc = readFileSync(new URL('../src/data/agent.ts', import.meta.url), 'utf8');
check('applySourceFilter branches on edgePlatforms !== undefined', /if \(edgePlatforms !== undefined\) \{/.test(agentSrc));
check('the online branch does NOT also regex-scan userText', (() => {
  const start = agentSrc.indexOf('function applySourceFilter(');
  const end = agentSrc.indexOf('\n}', start);
  const body = agentSrc.slice(start, end);
  const ifBlockEnd = body.indexOf('} else {');
  const ifBlock = body.slice(0, ifBlockEnd);
  return !/resolveSourcesFromText\(userText\)/.test(ifBlock);
})());
check('the offline-fallback branch (no edge decision) still regex-scans userText', /\} else \{\s*\n\s*for \(const s of resolveSourcesFromText\(userText\)\) set\.add\(s\);/.test(agentSrc));

// Verbatim copy of the fixed applySourceFilter() logic (stubbed resolveSourcesFromText mirrors the
// real bare-word Gathern pattern, which is all this fix's logic depends on).
type SearchQuery = { sources?: string[]; deal?: string; bothDeals?: boolean; rentPeriod?: string };
function resolveSourcesFromText(text: string): string[] {
  return /\bgathern\b|جاذرين/i.test(text) ? ['gathern'] : [];
}
function applySourceFilter(q: SearchQuery, userText: string, edgePlatforms?: string[]): void {
  const set = new Set<string>();
  if (edgePlatforms !== undefined) {
    for (const p of edgePlatforms) for (const s of resolveSourcesFromText(p)) set.add(s);
  } else {
    for (const s of resolveSourcesFromText(userText)) set.add(s);
  }
  const sources = Array.from(set);
  if (!sources.length) return;
  q.sources = sources;
  if (sources.includes('gathern')) {
    q.deal = 'Rent';
    q.bothDeals = false;
    q.rentPeriod = 'monthly';
  }
}

const q1: SearchQuery = {};
applySourceFilter(q1, 'جاذرين موقع حلو، ابغى فيلا في جدة', []);
check('real repro: incidental "جاذرين" mention + edge already decided platforms:[] -> sources stays empty', !q1.sources);

const q2: SearchQuery = {};
applySourceFilter(q2, 'show me gathern only', ['Gathern']);
check('edge correctly restricting to Gathern still works, and forces Rent+monthly', JSON.stringify(q2) === JSON.stringify({ sources: ['gathern'], deal: 'Rent', bothDeals: false, rentPeriod: 'monthly' }));

const q3: SearchQuery = {};
applySourceFilter(q3, 'جاذرين موقع حلو، ابغى فيلا في جدة', undefined);
check('offline fallback path (no edge decision at all) still regex-detects the bare mention (unchanged behavior)', JSON.stringify(q3.sources) === JSON.stringify(['gathern']));

console.log(
  failed === 0
    ? '\n✓ landmark alias-collision fix + platform-mention double-application fix verified'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
