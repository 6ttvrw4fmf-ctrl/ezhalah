// A TOWN HOUSE (تاون هاوس) IS FILED UNDER DUPLEX, NEVER UNDER VILLA (owner 2026-10-12: «town house are under duplex»).
// It used to ride the Villa search (2026-07-06 fold). EXECUTED here against the real type functions, then every layer that writes or
// reads the word is pinned: the search type labels, the clean-type map, the python normalizer, the agent's word list and the edge prompt.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { typeArForTypes, normalizeType, CLEAN_TO_QUERY } from '../src/data/propertyTypes.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nA town house is under Duplex\n');

const TH = 'تاون هاوس';
const duplex = typeArForTypes(['Duplex']) ?? [], villa = typeArForTypes(['Villa']) ?? [];
check('the Duplex search carries دوبلكس AND تاون هاوس', duplex.includes('دوبلكس') && duplex.includes(TH), duplex.join('|'));
check('the Villa search no longer carries تاون هاوس (and still carries فيلا + بيت)', !villa.includes(TH) && villa.includes('فيلا') && villa.includes('بيت'), villa.join('|'));
check('a stored تاون هاوس row is a Duplex in both table kinds', normalizeType(TH, 'res').clean === 'Duplex' && normalizeType(TH, 'com').clean === 'Duplex');
check('Duplex still reaches both table kinds', CLEAN_TO_QUERY.Duplex.kinds.includes('res') && CLEAN_TO_QUERY.Duplex.kinds.includes('com'));

// the committed single source (the build gate regenerates every artifact from it)
const src = JSON.parse(read('src/data/taxonomy.source.json'));
const q = (c: string) => src.cleanTypes.find((t: any) => t.clean === c)?.query?.rawTypes ?? [];
check('taxonomy.source.json: Duplex lists تاون هاوس, Villa does not', q('Duplex').includes(TH) && !q('Villa').includes(TH));

// python (what the scrapers write on the next daily scrape)
const py = read('scrapers/common/normalize.py');
const pyOk = (s: string) => /'Townhouse': 'Duplex'/.test(s) && /'townhouse': 'Duplex'/.test(s) && !/'[Tt]ownhouse': 'Villa'/.test(s);
check('normalize.py: Townhouse / townhouse → Duplex', pyOk(py));
mustCatch('Townhouse folding back into Villa in python', !pyOk(py.replace("'Townhouse': 'Duplex'", "'Townhouse': 'Villa'")));
check('alhoshan: the townhouse slug → Duplex', /"townhouse": "Duplex"/.test(read('scrapers/alhoshan/run.py')));

// the AI agent
const ag = read('src/data/agent.ts');
const agOk = (s: string) => /townhouse: 'Duplex'/.test(s) && !/townhouse: 'Villa'/.test(s);
check('agent word list: townhouse → Duplex', agOk(ag));
mustCatch('the agent word list sending townhouse to Villa', !agOk(ag.replace("townhouse: 'Duplex'", "townhouse: 'Villa'")));
const edge = read('supabase/functions/agent/index.ts');
const edgeOk = (s: string) => /townhouse \/ town house \/ row house \/ تاون هاوس → Duplex/.test(s) && !/townhouse[^;]{0,80}→ Villa/.test(s);
check('the edge prompt teaches the model: town house → Duplex', edgeOk(edge));
mustCatch('the edge prompt sending town house to Villa', !edgeOk(edge.replace('townhouse / town house / row house / تاون هاوس → Duplex', 'townhouse / row house → Villa')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a town house is under Duplex');
