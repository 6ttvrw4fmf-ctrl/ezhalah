// city_resolution_ignores_region JUDGES RESOLVERS, NOT MENTIONS (alert 9920, 2026-11-04).
//
// The detector's structural limb used to flag any SQL body that mentions loc_catalog_city and «city_norm» without
// loc_catalog_region. Three objects that resolve nothing held a P1 open for 17 days: trg_city_list_guard (ASSIGNS
// new.city_norm), unknown_named_districts (selects every city_norm into an exclusion set) and build_welcome_insights
// (strips «حي»/«ال» off c.city_norm inside a «not in» filter). The limb now requires a city-name COMPARISON — the
// only thing that turns a listing's city name into a city_id.
//
// WHAT THIS PINS. The newest migration that writes the limb must carry the four comparison shapes, and must not fall
// back to the bare «o.body ~* 'city_norm'» mention test. The shapes are then EXECUTED (as JS regexes, the same
// literals the SQL runs with ~*) against the three real non-resolver lines (must stay clear) and against name-only
// resolvers (must stay caught) — so a later edit that loosens or blinds the limb is RED here at review.
//
//   node --experimental-strip-types scripts/verify-city-resolution-detector-judges-resolvers.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname, '..', 'supabase', 'migrations');
let fail = 0;
const check = (name: string, ok: boolean) => { if (!ok) { console.log(`FAIL  ${name}`); fail++; } };
const mustCatch = check; // a mutation proof: the predicate applied to a deliberately broken input must reject it

export const SHAPES = [
  String.raw`city_norm\s*(=|\s+in\s*\()`,
  String.raw`=\s*\(?\s*[a-z0-9_.]*city_norm`,
  String.raw`normalize_ar\s*\(\s*[a-z0-9_.]*city[a-z0-9_]*\s*\)\s*\)?\s*(=|\s+in\s*\()`,
  String.raw`=\s*\(?\s*normalize_ar\s*\(\s*[a-z0-9_.]*city`,
];
const BARE = `o.body ~* 'city_norm' or`;

// the newest migration touching the structural limb of this detector
export function latestLimb(files: { n: string; s: string }[]): { n: string; s: string } | undefined {
  return [...files].sort((a, b) => a.n.localeCompare(b.n))
    .filter((f) => /mon_detect_city_resolution_ignores_region/.test(f.s) && /o\.body ~\* /.test(f.s)).at(-1);
}
export function problems(sql: string | undefined): string[] {
  if (!sql) return ['no migration writes the structural limb of mon_detect_city_resolution_ignores_region'];
  const out: string[] = [];
  for (const s of SHAPES) if (!sql.includes(`o.body ~* '${s}'`)) out.push(`resolver shape missing: ${s}`);
  // the bare mention test may appear only inside the replaced (old) anchor text, never as the live predicate
  const live = sql.split('a_new constant text')[1] ?? sql;
  if (live.includes(BARE)) out.push('the bare «city_norm» mention test is back in the live predicate');
  return out;
}
const isResolver = (body: string, shapes = SHAPES) => shapes.some((s) => new RegExp(s, 'i').test(body));

// EXECUTE the shapes: the three real non-resolver lines stay clear, name-only resolvers stay caught.
const NOT_RESOLVERS = [
  `  new.city_norm := coalesce(new.city_norm, public.normalize_ar(new.city_ar));`,
  `    cn as materialized (select cc.city_norm as v from public.loc_catalog_city cc`,
  `     where regexp_replace(regexp_replace(c.city_norm, '^حي\\s+', ''), '^ال', '') not in (select nm from w_dname where nm is not null)`,
];
const RESOLVERS = [
  `select c.city_id from public.loc_catalog_city c where c.city_norm = normalize_ar(x.city_ar) limit 1`,
  `join public.loc_catalog_city cc on normalize_ar(cc.city_ar) = normalize_ar(l.city_ar)`,
  `where cc.city_norm in (select normalize_ar(city_ar) from t)`,
  `JOIN loc_catalog_city cc2 ON ((cc2.city_norm = normalize_ar(lal2.city_ar)))`,
];
NOT_RESOLVERS.forEach((b, i) => check(`non-resolver #${i + 1} reads as a resolver`, !isResolver(b)));
RESOLVERS.forEach((b, i) => check(`resolver #${i + 1} is no longer caught`, isResolver(b)));

// mutation proof: the OLD mention test flags the non-resolvers (the false alarm), and dropping any one comparison
// shape blinds the limb to at least one real resolver form — so each shape is load-bearing.
const oldTest = (b: string) => /city_norm/i.test(b) || /normalize_ar\s*\(\s*[a-z0-9_.]*city/i.test(b);
mustCatch('mutation: the old mention test must flag the three non-resolvers', NOT_RESOLVERS.every(oldTest));
mustCatch('mutation: an empty shape list must miss every resolver', RESOLVERS.every((b) => !isResolver(b, [])));
mustCatch('mutation: problems() must reject a limb that lost a shape',
  problems(`a_new constant text o.body ~* '${SHAPES[0]}' o.body ~* '${SHAPES[1]}'`).length > 0);
mustCatch('mutation: problems() must reject the bare mention test',
  problems(`a_new constant text ${SHAPES.map((s) => `o.body ~* '${s}'`).join(' ')} ${BARE}`).length > 0);

const tree = readdirSync(MIG).filter((f) => f.endsWith('.sql')).map((n) => ({ n, s: readFileSync(join(MIG, n), 'utf8') }));
const latest = latestLimb(tree);
for (const p of problems(latest?.s)) check(`${latest?.n ?? '(none)'}: ${p}`, false);
if (fail) process.exit(1);
console.log(`✅ verify-city-resolution-detector-judges-resolvers: limb = ${latest?.n}; 3 non-resolvers clear, 4 resolvers caught, 4 mutations caught`);
