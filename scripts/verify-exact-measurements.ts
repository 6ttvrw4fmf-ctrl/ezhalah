// PERMANENT BARRIER — a source measurement keeps every digit it was published with.
//
// Owner, 2026-09-21: «we should never ever get this ever ever again». area_m2, price_per_meter,
// street_width_m, interior_space_m2 and outdoor_area_m2 were integer columns, and every scraper
// path cut the fraction off on the way in: a 407.56 m² plot was served as 407 or 408 m², ~3,700
// live cards showed the wrong size, and the labelled ≈ ppm × area total was off by up to 4,834 SAR.
// The columns are numeric now (migration *_exact_measurements.sql). This file makes the old shape
// impossible to reintroduce:
//
//   1. SCRAPERS — no measurement may pass through a converter that throws the fraction away:
//      int(), round(), math.floor/trunc/ceil, `//`, or any helper NAMED like an int maker
//      (_int, _int_of, to_int, to_int_numeric, _leading_int, safe_int, …). Checked on the value
//      written, on the variable it came from (same function), and inside any same-file helper
//      it is passed through. The sanctioned converters are normalize.to_measure (display text) and
//      normalize.measure_num (machine values) — neither ever rounds.
//   2. SCHEMA — no migration after the exact-measurements one may declare these columns as an
//      integer type again, or feed them through safe_int(). A new platform table cloned from old DDL
//      is the likeliest way back; this is the tripwire for it. (Production is watched as well:
//      mon_detect_measurement_decimals_lost / mon_detect_integer_measurement_columns.)
//   3. PROOFS — every rule above is fed a real-shaped mutant and must go red, and the sanctioned
//      shapes must stay green.
//
//   node --experimental-strip-types scripts/verify-exact-measurements.ts   (discovered by `npm test`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

export const FIELDS = ['area_m2', 'interior_space_m2', 'outdoor_area_m2', 'price_per_meter', 'street_width_m'];
// A converter that throws the fraction away. `_int(?:_\w+)?\(` catches _int( _int_of( to_int(
// to_int_numeric( _leading_int( safe_int( parse_int( while leaving _interior( alone.
const TRUNCATOR = /(?<![\w.])(?:int|round)\(|_int(?:_\w+)?\(|math\.(?:floor|trunc|ceil)\(|\s\/\/\s/;
const KEYWORDS = new Set(['None', 'True', 'False', 'if', 'else', 'and', 'or', 'not', 'in', 'is', 'for', 'lambda', 'return']);

const codeOf = (line: string) => line.split('#')[0];
const noStrings = (s: string) => s.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
const indentOf = (line: string) => line.length - line.trimStart().length;

/** The expression starting at `lines[i]` after `start`, joined across lines until brackets balance. */
function exprFrom(lines: string[], i: number, start: string): string {
  let expr = start;
  for (let j = i + 1, depth = balance(expr); depth > 0 && j < lines.length && j < i + 8; j++) {
    expr += ' ' + codeOf(lines[j]).trim();
    depth = balance(expr);
  }
  return expr;
}
function balance(s: string): number {
  let d = 0;
  for (const ch of noStrings(s)) d += '([{'.includes(ch) ? 1 : ')]}'.includes(ch) ? -1 : 0;
  return d;
}

/** [first, last] line indexes of the function enclosing line i (whole file at module level). */
function scopeOf(lines: string[], i: number): [number, number] {
  let d = i;
  while (d >= 0 && !(/^\s*def\s/.test(lines[d]) && indentOf(lines[d]) < indentOf(lines[i]))) d--;
  if (d < 0) return [0, lines.length - 1];
  const ind = indentOf(lines[d]);
  let e = d + 1;
  while (e < lines.length && (!lines[e].trim() || indentOf(lines[e]) > ind)) e++;
  return [d, e - 1];
}

/** Why `expr` (written at line i of `lines`) loses a fraction, or null. Follows variables and helpers. */
function whyLossy(lines: string[], i: number, expr: string, depth = 0): string | null {
  const code = noStrings(expr);
  const m = code.match(TRUNCATOR);
  if (m) return `\`${m[0].trim()}\` in: ${expr.trim().slice(0, 90)}`;
  if (depth >= 3) return null;
  const [s, e] = scopeOf(lines, i);
  // Same-file helpers the value passes through: a helper that truncates on return truncates the field.
  for (const call of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)\(/g)) {
    const def = lines.findIndex((l) => new RegExp(`^\\s*def\\s+${call[1]}\\(`).test(l));
    if (def < 0) continue;
    const [ds, de] = scopeOf(lines, def + 1);
    for (let k = ds; k <= de; k++) {
      const r = codeOf(lines[k]).match(/^\s*return\s+(.+)$/);
      if (!r) continue;
      const why = whyLossy(lines, k, exprFrom(lines, k, r[1]), depth + 1);
      if (why) return `${call[1]}() → ${why}`;
    }
  }
  // Plain variables: every assignment to them in the same function must be lossless too.
  for (const v of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)(?!\s*\(|\w)/g)) {
    const name = v[1];
    if (KEYWORDS.has(name)) continue;
    const assign = new RegExp(`^\\s*${name}\\s*(?::[^=]+)?=(?!=)\\s*(.+)$`);
    for (let k = s; k <= e; k++) {
      if (k === i) continue;
      const a = codeOf(lines[k]).match(assign);
      if (!a) continue;
      const why = whyLossy(lines, k, exprFrom(lines, k, a[1]), depth + 1);
      if (why) return `${name} ← ${why}`;
    }
  }
  return null;
}

/** Every place in one python source that writes a measurement field through a lossy converter. */
export function lossyMeasurementWrites(src: string): string[] {
  const lines = src.split('\n');
  const out: string[] = [];
  lines.forEach((raw, i) => {
    const code = codeOf(raw);
    for (const f of FIELDS) {
      const site =
        code.match(new RegExp(`["']${f}["']\\s*[:\\]]\\s*=?(?!=)\\s*(.+)$`)) ??   // "f": x   /   row["f"] = x
        code.match(new RegExp(`(?<![\\w"'.])${f}\\s*=(?!=)\\s*(.+)$`));          // f = x   /   f=x kwarg
      if (!site) continue;
      const expr = exprFrom(lines, i, site[1]);
      if (/^\s*(None|db\.AUTHORITATIVE_NULL|AUTHORITATIVE_NULL)\s*[,)]?\s*$/.test(expr)) continue;
      const why = whyLossy(lines, i, expr);
      if (why) out.push(`${i + 1}: ${f}: ${why}`);
    }
  });
  return out;
}

// ── 1. The fleet ───────────────────────────────────────────────────────────────────────────────
const root = new URL('../scrapers', import.meta.url).pathname;
const pyFiles: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'tests' && e !== '__pycache__') walk(p); }
    else if (e.endsWith('.py') && !e.startsWith('test_') && !e.startsWith('_')) pyFiles.push(p);
  }
})(root);
check(`scanned a real fleet (${pyFiles.length} python files)`, pyFiles.length >= 50);
const offenders: string[] = [];
for (const f of pyFiles) {
  for (const o of lossyMeasurementWrites(readFileSync(f, 'utf8'))) offenders.push(`${f.replace(root, 'scrapers')}:${o}`);
}
check('no scraper writes a measurement through a converter that drops the fraction', offenders.length === 0);
for (const o of offenders) console.error('  LOSSY  ' + o);

// ── 2. The schema ──────────────────────────────────────────────────────────────────────────────
const migDir = new URL('../supabase/migrations', import.meta.url).pathname;
const migs = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const exactIdx = migs.findIndex((f) => /_exact_measurements\.sql$/.test(f));
check('the exact-measurements migration exists', exactIdx >= 0);
const exactSql = exactIdx >= 0 ? readFileSync(join(migDir, migs[exactIdx]), 'utf8') : '';
for (const f of FIELDS) check(`it converts ${f} to numeric`, new RegExp(`'${f}'`).test(exactSql) && /type numeric/i.test(exactSql));
const INT_DECL = new RegExp(`\\b(${FIELDS.join('|')})\\b["']?\\s+(?:type\\s+)?(?:integer|int|int2|int4|int8|smallint|bigint)\\b`, 'i');
const SAFE_INT = new RegExp(`safe_int\\([^)]*(${FIELDS.join('|')})`, 'i');
export function reintroducesIntegerMeasurement(sql: string): boolean {
  return sql.split('\n').some((l) => { const c = l.split('--')[0]; return INT_DECL.test(c) || SAFE_INT.test(c); });
}
const regressions = exactIdx < 0 ? [] : migs.slice(exactIdx + 1).filter((f) => reintroducesIntegerMeasurement(readFileSync(join(migDir, f), 'utf8')));
check('no later migration declares a measurement column as an integer type (or safe_int()s it)', regressions.length === 0);
for (const r of regressions) console.error('  INTEGER-AGAIN  supabase/migrations/' + r);

// ── 3. Mutation proofs (real shapes from the fleet, before this fix) ────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++; console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const lossy = (src: string) => lossyMeasurementWrites(src).length > 0;
mustCatch('raghdan: `"area_m2": round(area) if area else None`',
  lossy('def m(x):\n    area = _float(x)\n    return {\n        "area_m2": round(area) if area else None,\n    }'));
mustCatch('fursaghyr: area from a helper that does int(float(v))',
  lossy('def _int(v):\n    try:\n        return int(float(v))\n    except Exception:\n        return None\n\ndef m(rea):\n    area = _int(rea.get("land_area"))\n    return {"area_m2": area}'));
mustCatch('abralosol: `"area_m2": N.to_int(ix["area_raw"])`', lossy('    row = {"area_m2": N.to_int(ix["area_raw"])}'));
mustCatch('a local parse_area() that returns int(...) of a regex group',
  lossy('def parse_area(t):\n    m = RX.search(t)\n    return int(m.group(1)) if m else None\n\nrow = {"area_m2": parse_area(text)}'));
mustCatch('a subscript write: out["street_width_m"] = to_int_numeric(v)', lossy('    out["street_width_m"] = N.to_int_numeric(v)'));
mustCatch('price_per_meter floor-divided', lossy('    row["price_per_meter"] = total // area'));
mustCatch('a value built across lines: "area_m2": (\\n  _leading_int(s)\\n)', lossy('row = {\n    "area_m2": (\n        _leading_int(specs.get("المساحة"))\n    ),\n}'));
mustCatch('a migration that re-declares area_m2 integer (a cloned platform table)',
  reintroducesIntegerMeasurement('create table public.newsite_residential_listings (\n  id bigserial,\n  area_m2 integer,\n  price_total bigint\n);'));
mustCatch('a trigger that safe_int()s the area again', reintroducesIntegerMeasurement("  NEW.area_m2 := coalesce(public.safe_int(p->>'area_m2'), NEW.area_m2);"));
// Negative controls: the sanctioned shapes must pass, or the barrier protects nothing.
mustCatch('…while N.to_measure / measure_num writes are clean',
  !lossy('def m(x):\n    area = N.to_measure(x.get("area"))\n    return {"area_m2": area, "price_per_meter": N.measure_num(x.get("ppm")) or None}'));
mustCatch('…and a raw JSON value passed straight through is clean (db._sanitize_measures keeps it exact)',
  !lossy('    row = {"area_m2": item.get("area"), "street_width_m": None}'));
mustCatch('…and an unrelated int() elsewhere in the function does not taint the field',
  !lossy('def m(x):\n    beds = int(x["beds"])\n    area = N.to_measure(x["area"])\n    return {"bedrooms": beds, "area_m2": area}'));
mustCatch('…and `_interior(` is not mistaken for an int maker', !lossy('    row = {"interior_space_m2": _interior(x)}'));
mustCatch('…and a migration mentioning numeric measurements is clean',
  !reintroducesIntegerMeasurement('alter table t alter column area_m2 type numeric using area_m2::numeric;'));

if (failed || mutFail) {
  if (failed) console.error(`\n✗ ${failed} exact-measurement assertion(s) FAILED`);
  if (mutFail) console.error(`✗ ${mutFail} mutation(s) went UNCAUGHT — this barrier cannot see the defect it exists for.`);
  process.exit(1);
}
console.log('\n✓ every source measurement keeps its decimals end to end, and the barrier is proven to fail on each lossy shape');
