// THE AGENT'S `type` IS ALWAYS A CANONICAL ENGLISH TYPE WHEN THE MODEL NAMED IT IN ARABIC (2026-11-03, backlog 1263).
// audit-invariants.yml measured the live model answering «شقة» / «فيلا» where the contract says one canonical English
// type. canonType() in supabase/functions/agent/index.ts maps the Arabic word to the SAME canonical type the app maps it
// to (src/data/agent.ts typeFromAgent). EXECUTED here against the real functions — and the two maps must agree.
// Run: node --experimental-strip-types scripts/verify-agent-type-is-canonical.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (m: string, c: boolean) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ❌ ${m}`); failed++; } };
const mustCatch = (m: string, caught: boolean) => check(`(mutation) catches ${m}`, caught);

const edgeSrc = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
type Edge = { canonType: (t: unknown) => string | null; AR_TYPE_CANON: Record<string, string> };
const toFile = (src: string, name: string) => { const f = join(mkdtempSync(join(tmpdir(), 'agent-type-')), name); writeFileSync(f, src); return f; };
const lift = async (src: string): Promise<Edge> => await liftSymbols(toFile(src, 'index.ts'), [
  { header: 'const RESIDENTIAL_TYPES = [', endsWith: /^\];$/ },
  { header: 'const COMMERCIAL_TYPES = [', endsWith: /^\];$/ },
  { header: 'const TYPES = ', endsWith: /;$/ },
  { header: 'const AR_TYPE_CANON: Record<string, string> = {' },
  { header: 'export function canonType(' },
], ['canonType', 'AR_TYPE_CANON']) as unknown as Edge;
const edge = await lift(edgeSrc);

check('«شقة» → Apartment (the measured case)', edge.canonType('شقة') === 'Apartment');
check('«فيلا» → Villa (the measured case)', edge.canonType('فيلا') === 'Villa');
check('«الشقة» (with ال) → Apartment', edge.canonType('الشقة') === 'Apartment');
check('a canonical English type passes unchanged', edge.canonType('Commercial Land') === 'Commercial Land');
check('an unknown word passes through untouched (the app still sees it)', edge.canonType('شيء') === 'شيء');
check('empty / non-string → null', edge.canonType('') === null && edge.canonType(undefined) === null);
check('both response builders use canonType', (edgeSrc.match(/type: canonType\(out\.type\),/g) ?? []).length === 2);

// The edge map must agree with the app's map on every word it carries.
const appSrc = readFileSync(join(ROOT, 'src/data/agent.ts'), 'utf8');
const appMap = ((await liftSymbols(toFile(appSrc, 'agent.ts'), [{ header: 'const AR_TYPE: Record<string, string> = {' }], ['AR_TYPE'])) as { AR_TYPE: Record<string, string> }).AR_TYPE;
const disagree = Object.entries(edge.AR_TYPE_CANON).filter(([ar, en]) => appMap[ar] !== en).map(([ar]) => ar);
check(`every Arabic word maps to the same type as the app (${disagree.join(', ') || 'all agree'})`, disagree.length === 0);

mustCatch('the map dropped (Arabic passes through raw again)',
  (await lift(edgeSrc.replace('return AR_TYPE_CANON[s] ?? AR_TYPE_CANON[s.replace(/^ال/, "")] ?? s;', 'return s;'))).canonType('شقة') !== 'Apartment');
mustCatch('a builder reverting to the raw model value',
  ((edgeSrc.replace('type: canonType(out.type),', 'type: typeof out.type === "string" && out.type ? out.type : null,')).match(/type: canonType\(out\.type\),/g) ?? []).length !== 2);

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the agent names every type in canonical English, as the app does');
