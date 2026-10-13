// A TOWN HOUSE (تاون هاوس) IS FILED UNDER DUPLEX, NEVER UNDER VILLA, AND KEEPS ITS OWN NAME (owner 2026-10-12: «town house are under duplex … dont change its name»).
// It used to ride the Villa search (2026-07-06 fold). EXECUTED here against the real type functions, then every layer that writes or
// reads the word is pinned: the search type labels, the clean-type map, the python normalizer, the agent's word list and the edge prompt.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

// python (what the scrapers write on the next daily scrape): the town house KEEPS ITS OWN NAME «تاون هاوس» (owner 2026-10-12: «dont change its
// name»), it is never written as Duplex or Villa — the search files it under Duplex by the map above.
const py = read('scrapers/common/normalize.py');
const pyOk = (s: string) => /'Townhouse': 'تاون هاوس'/.test(s) && /'townhouse': 'تاون هاوس'/.test(s) && /"تاون هاوس":\s+"تاون هاوس"/.test(s)
  && /"Residential Land", "تاون هاوس",/.test(s) && !/'[Tt]ownhouse': '(?:Villa|Duplex)'/.test(s);
check('normalize.py: Townhouse / townhouse → «تاون هاوس», shared Arabic word kept, routed residential', pyOk(py));
mustCatch('Townhouse folding back into Villa in python', !pyOk(py.replace("'Townhouse': 'تاون هاوس'", "'Townhouse': 'Villa'")));
mustCatch('Townhouse being renamed Duplex in python', !pyOk(py.replace("'Townhouse': 'تاون هاوس'", "'Townhouse': 'Duplex'")));
mustCatch('the town house losing its residential routing', !pyOk(py.replace('"Residential Land", "تاون هاوس",', '"Residential Land",')));

// EVERY scraper: no local fold of a town house into Villa / Duplex / فيلا / دوبلكس (the stale-local-map class of 2026-08-19, again).
const FOLD = /(?<!:\s*)["'](?:تاون ?هاوس|تاونهاوس|تاون هاووس|town ?houses?|townhouse)["']\s*[:,]\s*["'](?:Villa|Duplex|فيلا|دوبلكس)["']/i;   // the KEY (not a value that precedes the next key)
const scrapers = readdirSync(join(ROOT, 'scrapers'), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(ROOT, 'scrapers', d.name, 'run.py'))).map((d) => d.name);
const folding = scrapers.filter((n) => FOLD.test(read(`scrapers/${n}/run.py`).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')));
check(`no scraper folds a town house into Villa/Duplex (${scrapers.length} scrapers scanned)`, folding.length === 0, folding.join(', '));
mustCatch('a scraper that folds «تاون هاوس» into Villa', FOLD.test('"تاون هاوس": "Villa",') && FOLD.test('("townhouse", "فيلا")') && FOLD.test('"TOWNHOUSE": "Duplex"'));
check('alhoshan: the townhouse slug keeps the name', /"townhouse": "تاون هاوس"/.test(read('scrapers/alhoshan/run.py')));

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
