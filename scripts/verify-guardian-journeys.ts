// THE GUARDIAN SUITE MUST STAY OWNED, COMPLETE, AND INCAPABLE OF LYING (2026-09-04).
//
// e2e/guardian/ drives production every day over the surfaces that had ZERO live browser coverage
// and files an owned ops_incident when one breaks. Three properties make that worth having, and all
// three are easy to lose in a one-line edit that looks harmless:
//
//   1. EVERY JOURNEY HAS AN OWNER. `surface` is what public.incident_route_owner() turns into a
//      routine slug. A journey with no surface, or a surface outside that mapping, files a P1 that
//      lands on the #2 fallback with no context — the "unowned finding" hole the incident spine was
//      built to close. So the surfaces are checked against the REAL mapping in the migration, and
//      the slugs it produces are checked against the REAL ROUTINES table by executing it.
//
//   2. BOTH VIEWPORTS RUN. Half the owner's reported bugs are phone-shaped. A dropped viewport is a
//      halved suite that still reports green.
//
//   3. NOTHING IT DOES CAN BE A LIE. A harness failure must never file a product incident; a pass
//      must never close one; and the suite must never write to production through the UI — above
//      all it must never SEND the support form, which inserts a row into support_messages.
//
// MUTATION-PROVEN. Every predicate below is a pure function over its inputs, and the barrier feeds
// each one a deliberately broken input and fails if the predicate stays silent. A barrier that
// cannot fail is decoration — this repo has been burned by that exact shape before.
//
// Offline and deterministic: it reads tracked files and runs pure functions, so it runs in
// `npm test` by existing (AGENTS.md §"How `npm test` finds its checks"). The RUNNER is deliberately
// NOT named scripts/verify-* — it needs the network and a browser, and lives under e2e/.
//
// Run: node --experimental-strip-types scripts/verify-guardian-journeys.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTINES } from './lib/alertRouting.ts';
import { JOURNEYS, ALLOWED_SURFACES } from '../e2e/guardian/journeys.mjs';
import { VIEWPORTS, FORBIDDEN_LABELS, tap } from '../e2e/guardian/harness.mjs';
import { incidentAction, statusForThrow, fingerprintFor, SEVERITY, SOURCE } from '../e2e/guardian/run.mjs';

const ROOT = join(import.meta.dirname, '..');
const GUARDIAN_DIR = join(ROOT, 'e2e/guardian');
const WORKFLOW = join(ROOT, '.github/workflows/guardian-journeys.yml');

/** The surfaces this suite is required to cover. Each maps to an owning routine in the migration. */
const REQUIRED_SURFACES = [
  'theme', 'chat_persistence', 'auth', 'navigation', 'result_card', 'loading_states', 'modal', 'search',
];
/** The two viewports, as the owner's bug reports arrive: a desktop and a phone. */
const REQUIRED_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
/** The one control that WRITES: «إرسال» sends the support form into support_messages. */
const SUPPORT_SUBMIT = 'إرسال';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) => (cond ? ok.push(pass) : problems.push(fail));

// ══ PURE PREDICATES — each is fed a broken input further down ═════════════════════════════════════

type Journey = { id?: string; title?: string; surface?: string; steps?: string[]; run?: unknown };

/** Every structural fault in a journey list: no id, no title, no surface, an unowned surface. */
export function journeyProblems(journeys: Journey[], allowed: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [i, j] of journeys.entries()) {
    const where = j?.id ?? `journey #${i}`;
    if (!j?.id || typeof j.id !== 'string') out.push(`${where}: no id`);
    else if (seen.has(j.id)) out.push(`${j.id}: duplicate id — the incident fingerprint would collide`);
    else seen.add(j.id);
    if (!j?.title || typeof j.title !== 'string' || j.title.length < 10) out.push(`${where}: no human title`);
    if (!j?.surface || typeof j.surface !== 'string') out.push(`${where}: declares NO surface — a finding with no surface has no owner`);
    else if (!allowed.includes(j.surface)) out.push(`${where}: surface "${j.surface}" is not one incident_route_owner() knows`);
    if (!Array.isArray(j?.steps) || !j.steps.length) out.push(`${where}: no reproduction steps — an incident nobody can reproduce is a rumour`);
    if (typeof j?.run !== 'function') out.push(`${where}: has no run()`);
  }
  return out;
}

/** Every required viewport that the suite does not actually drive. */
export function viewportProblems(
  viewports: { name: string; width: number; height: number }[],
  required = REQUIRED_VIEWPORTS,
): string[] {
  return required
    .filter((r) => !viewports.some((v) => v.name === r.name && v.width === r.width && v.height === r.height))
    .map((r) => `the suite does not drive ${r.name} ${r.width}x${r.height} — half the journeys would silently stop running`);
}

/**
 * Anything in the guardian sources that could CLOSE an incident, or move it toward closed.
 * A journey passing is evidence, not a fix: resolution needs a barrier AND a production
 * verification, which ops_incident_resolution_is_earned enforces in the database.
 */
// Deliberately PRECISE, not eager. A bare `resolved_at` or `state: '` also matches Playwright's own
// `waitFor({ state: 'attached' })` and this file's own prose — and a barrier that fires on its own
// documentation is a barrier people delete. These match a WRITE to the incident lifecycle.
export const CLOSING_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/incident_resolve|incident_wont_fix|incident_block|incident_advance/, 'calls an incident lifecycle RPC'],
  [/resolved_at\s*:/, 'writes resolved_at'],
  [/\bstate\s*:\s*['"](open|investigating|reproduced|fixed|verifying|resolved|handed_off|blocked|wont_fix)['"]/, 'writes an incident state'],
];
export function resolveProblems(sources: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, src] of Object.entries(sources)) {
    for (const [re, what] of CLOSING_PATTERNS) {
      if (re.test(src)) out.push(`${file} ${what} — the guardian suite must never resolve or re-state an incident; a pass may only append evidence to its detail`);
    }
  }
  return out;
}

/**
 * The support-form submit guard: the sending control must be refused by the shared click path, and
 * no journey may click it by any other route.
 */
export function submitGuardProblems(forbidden: string[], sources: Record<string, string>): string[] {
  const out: string[] = [];
  if (!forbidden.includes(SUPPORT_SUBMIT)) {
    out.push(`FORBIDDEN_LABELS does not carry «${SUPPORT_SUBMIT}» — the suite could send the support form, which INSERTS into support_messages from a monitoring run`);
  }
  for (const [file, src] of Object.entries(sources)) {
    for (const line of src.split('\n')) {
      if (!line.includes(SUPPORT_SUBMIT)) continue;
      if (/\.click\(|\btap\(|press\(/.test(line)) {
        out.push(`${file}: «${SUPPORT_SUBMIT}» is clicked — the support form must be asserted to RENDER and never sent`);
      }
    }
  }
  return out;
}

/** The parameter names incident_open() actually takes, read out of the migration. */
export function parseIncidentOpenParams(sql: string): string[] {
  const at = sql.indexOf('function public.incident_open(');
  if (at < 0) return [];
  const sig = sql.slice(at, sql.indexOf(') returns', at));
  return [...sig.matchAll(/\b(p_[a-z_]+)\s+\w/g)].map((m) => m[1]!);
}

/** Parameters the runner does not pass. A renamed argument is a PostgREST 404 at 3am, in CI only. */
export function payloadProblems(params: string[], runnerSrc: string): string[] {
  return params.filter((p) => !new RegExp(`\\b${p}\\s*:`).test(runnerSrc))
    .map((p) => `the runner never passes ${p} to incident_open() — every finding would fail to file`);
}

/** surface → owning routine slug, read out of the migration that defines incident_route_owner(). */
export function parseRouteOwner(sql: string): Record<string, string> {
  const fn = sql.slice(sql.indexOf('function public.incident_route_owner'));
  const body = fn.slice(0, fn.indexOf('$fn$;') + 1);
  const map: Record<string, string> = {};
  for (const m of body.matchAll(/when\s+'([a-z_]+)'\s+then\s+'([a-z0-9-]+)'/g)) map[m[1]!] = m[2]!;
  return map;
}

/** Surfaces that do not route to a routine that actually exists. */
export function routingProblems(surfaces: string[], map: Record<string, string>, slugs: string[]): string[] {
  const out: string[] = [];
  for (const s of surfaces) {
    const slug = map[s];
    if (!slug) out.push(`surface "${s}" is not in incident_route_owner() — its findings would fall to the #2 triage fallback with no context`);
    else if (!slugs.includes(slug)) out.push(`surface "${s}" routes to "${slug}", which is not one of the seven routines in scripts/lib/alertRouting.ts`);
  }
  return out;
}

// ══ THE CHECKS ════════════════════════════════════════════════════════════════════════════════════

const sources: Record<string, string> = Object.fromEntries(
  readdirSync(GUARDIAN_DIR).filter((f) => f.endsWith('.mjs')).sort()
    .map((f) => [`e2e/guardian/${f}`, readFileSync(join(GUARDIAN_DIR, f), 'utf8')]),
);
check(Object.keys(sources).length >= 3, `${Object.keys(sources).length} guardian source files read`,
  `only ${Object.keys(sources).length} files under e2e/guardian — the suite is missing`);

// ── 1. Journeys are well-formed and owned ─────────────────────────────────────────────────────────
const jp = journeyProblems(JOURNEYS as Journey[], ALLOWED_SURFACES);
check(jp.length === 0, `all ${JOURNEYS.length} journeys declare id + title + surface + steps + run()`,
  `journey declarations are broken: ${jp.join('; ')}`);

const covered = new Set(JOURNEYS.map((j) => j.surface));
const uncovered = REQUIRED_SURFACES.filter((s) => !covered.has(s));
check(uncovered.length === 0, `every required surface has a journey (${REQUIRED_SURFACES.join(', ')})`,
  `these surfaces lost their journey: ${uncovered.join(', ')} — the coverage this suite exists for is gone`);
check(ALLOWED_SURFACES.length === REQUIRED_SURFACES.length && REQUIRED_SURFACES.every((s) => ALLOWED_SURFACES.includes(s)),
  'ALLOWED_SURFACES matches the required set',
  `ALLOWED_SURFACES drifted from the required set: ${ALLOWED_SURFACES.join(',')} vs ${REQUIRED_SURFACES.join(',')}`);

// ── 2. Routing, against the REAL mapping and the REAL routines ────────────────────────────────────
const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql') && readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8').includes('function public.incident_route_owner'));
check(migrations.length > 0, `incident_route_owner() found in ${migrations[0]}`,
  'no migration defines incident_route_owner() — the surface→owner mapping this suite depends on is missing');
const routeMap = migrations.length
  ? parseRouteOwner(readFileSync(join(ROOT, 'supabase/migrations', migrations[migrations.length - 1]!), 'utf8'))
  : {};
const slugs = Object.values(ROUTINES).map((r) => r.label);
check(Object.keys(routeMap).length >= 20, `${Object.keys(routeMap).length} surfaces parsed out of incident_route_owner()`,
  `only ${Object.keys(routeMap).length} surfaces parsed — the parser is broken, and a routing check over an empty map passes trivially`);
const rp = routingProblems([...covered] as string[], routeMap, slugs);
check(rp.length === 0, `all ${covered.size} journey surfaces route to a real routine`, rp.join('; '));
for (const s of [...covered].sort()) if (routeMap[s as string]) ok.push(`  ${s} → ${routeMap[s as string]}`);

// ── 2b. The filing call matches the RPC it calls ──────────────────────────────────────────────────
// Not testable against the live database from here (no service-role credentials outside CI), so the
// signature is checked against the migration that defines it: a renamed parameter would otherwise
// surface only as a 404 inside a nightly CI run, on the one path whose whole job is to report.
const spineSql = migrations.length
  ? readFileSync(join(ROOT, 'supabase/migrations', migrations[migrations.length - 1]!), 'utf8') : '';
const openParams = parseIncidentOpenParams(spineSql);
check(openParams.length === 7, `incident_open() takes ${openParams.length} parameters (${openParams.join(', ')})`,
  `incident_open()'s signature could not be parsed (${openParams.length} params) — the payload check below would pass trivially`);
const pp = payloadProblems(openParams, sources['e2e/guardian/run.mjs'] ?? '');
check(pp.length === 0, 'the runner passes every incident_open() parameter', pp.join('; '));

// ── 3. Both viewports ─────────────────────────────────────────────────────────────────────────────
const vp = viewportProblems(VIEWPORTS);
check(vp.length === 0, `both viewports are driven (${VIEWPORTS.map((v) => `${v.name} ${v.width}x${v.height}`).join(', ')})`,
  vp.join('; '));

// ── 4. The suite can never close an incident ──────────────────────────────────────────────────────
const rzp = resolveProblems(sources);
check(rzp.length === 0, 'no guardian source can resolve, close or re-state an incident', rzp.join('; '));

// ── 5. The support form is never submitted, and no OAuth button is ever pressed ───────────────────
const sgp = submitGuardProblems(FORBIDDEN_LABELS, sources);
check(sgp.length === 0, `the shared click path refuses «${SUPPORT_SUBMIT}» and nothing clicks it`, sgp.join('; '));
// EXECUTED, not described: tap() must refuse before it ever touches a page.
const refused = await tap(null, SUPPORT_SUBMIT).then(() => null).catch((e: Error) => e.message);
check(!!refused && /refuses/.test(refused), 'tap() throws rather than clicking the support-form send control',
  'tap() no longer refuses the support-form send control — a monitoring run could write to support_messages');
for (const label of ['المتابعة باستخدام Google', 'المتابعة باستخدام Apple']) {
  check(FORBIDDEN_LABELS.includes(label), `the suite refuses to press «${label}» (it never signs in)`,
    `FORBIDDEN_LABELS lost «${label}» — the suite could start a real sign-in against production`);
}

// ── 6. A HARNESS failure cannot file a product incident. EXECUTED. ────────────────────────────────
check(incidentAction({ status: statusForThrow(new Error('boom')) }) === 'none',
  'a thrown error → UNDETERMINED → NO incident is filed',
  'a harness failure now files a product incident — the cry-wolf failure this suite exists to avoid');
check(incidentAction({ status: 'UNDETERMINED' }) === 'none',
  'UNDETERMINED files nothing', 'UNDETERMINED now files an incident');
check(incidentAction({ status: 'FAIL' }) === 'open',
  'FAIL opens an incident', 'a product FAIL no longer opens an incident — findings would go nowhere');
check(incidentAction({ status: 'PASS' }) === 'note-pass',
  'PASS only notes evidence on an already-open incident', 'PASS no longer records its evidence');
check(SEVERITY === 'P1' && SOURCE === 'journey',
  "findings are filed P1 with source 'journey'",
  `findings are filed ${SEVERITY}/${SOURCE} — the spine routes and prioritises on these`);
check(fingerprintFor('a', 'desktop') === 'journey:a:desktop'
  && fingerprintFor('a', 'desktop') !== fingerprintFor('a', 'mobile'),
  'the fingerprint is journey:<id>:<viewport> — one incident per journey per viewport, never per run',
  'the fingerprint is no longer per journey+viewport: re-observations would open new incidents every night');

// ── 7. The workflow is wired ──────────────────────────────────────────────────────────────────────
check(existsSync(WORKFLOW), 'guardian-journeys.yml exists', 'guardian-journeys.yml is missing — nothing runs this suite');
if (existsSync(WORKFLOW)) {
  const wf = readFileSync(WORKFLOW, 'utf8');
  check(/^\s*schedule:\s*$/m.test(wf), 'the workflow is scheduled', 'the workflow has no schedule: — the suite would only ever run by hand');
  check(/workflow_run:/.test(wf), 'the workflow also runs after a production deploy',
    'the workflow no longer runs after a deploy — the moment a surface is most likely to break');
  check(wf.includes('node e2e/guardian/run.mjs'), 'the workflow runs the guardian runner', 'the workflow no longer invokes e2e/guardian/run.mjs');
  check(wf.includes('--workflow guardian-journeys.yml') && wf.includes('--kind journey_live_check_failed'),
    'the workflow bridges its own failure to alert_event under its own dedup key',
    'the workflow does not bridge its failure to alert_event with its own file name — a red run would alert nobody (or resolve someone else\'s alert)');
}

// ══ MUTATION PROOFS — each predicate must FAIL on a deliberately broken input ══════════════════════
const mutation = (label: string, found: string[]) =>
  check(found.length > 0, `MUTANT CAUGHT — ${label}`,
    `MUTANT SURVIVED — ${label}: this barrier stayed silent, so it does not actually protect that property`);

mutation('a journey loses its surface',
  journeyProblems((JOURNEYS as Journey[]).map((j, i) => (i === 0 ? { ...j, surface: undefined } : j)), ALLOWED_SURFACES));
mutation('a journey declares a surface no routine owns',
  journeyProblems((JOURNEYS as Journey[]).map((j, i) => (i === 0 ? { ...j, surface: 'vibes' } : j)), ALLOWED_SURFACES));
mutation('an unowned surface is routed', routingProblems(['vibes'], routeMap, slugs));
mutation('a surface routes to a routine that does not exist', routingProblems(['theme'], { theme: 'routine-9-imaginary' }, slugs));
mutation('the mobile viewport is dropped', viewportProblems(VIEWPORTS.filter((v) => v.name !== 'mobile')));
mutation('the desktop viewport is dropped', viewportProblems(VIEWPORTS.filter((v) => v.name !== 'desktop')));
mutation('the runner gains an incident_resolve call',
  resolveProblems({ 'e2e/guardian/run.mjs': "await rpc(c, 'incident_resolve', { p_id: id });" }));
mutation('the runner starts writing incident state',
  resolveProblems({ 'e2e/guardian/run.mjs': "body: JSON.stringify({ state: 'resolved' })" }));
mutation('the runner drops an incident_open() parameter',
  payloadProblems(openParams, (sources['e2e/guardian/run.mjs'] ?? '').replace(/p_surface\s*:/, 'p_area:')));
mutation('the support-form submit guard is removed from FORBIDDEN_LABELS',
  submitGuardProblems(FORBIDDEN_LABELS.filter((l) => l !== SUPPORT_SUBMIT), {}));
mutation('a journey clicks the support-form send control',
  submitGuardProblems(FORBIDDEN_LABELS, { 'e2e/guardian/journeys.mjs': "await page.getByText('إرسال').click();" }));

// ══ report ════════════════════════════════════════════════════════════════════════════════════════
console.log(`\nGUARDIAN JOURNEY SUITE — ${ok.length} checks passed`);
for (const line of ok) console.log(`  ✓ ${line}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✓ guardian journeys: owned, complete on both viewports, and incapable of closing an incident or writing to production.\n');
