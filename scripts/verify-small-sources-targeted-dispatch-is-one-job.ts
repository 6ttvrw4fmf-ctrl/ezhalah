// A TARGETED small-sources-sync dispatch (`source=<slug>[,<slug>…]`) must create ONLY those jobs.
//
// 2026-10-25: the matrix was a literal list, so `source=<one site>` still created all ~143 jobs; every other
// site's job took a runner for checkout + Python + pip and then skipped its scrape. Five such runs held 41–143
// queued jobs each, nothing in the workflow started from 08:25 to 13:00 UTC, and another engineer cancelled
// their own runs to get past ~140 empty jobs. The fix: a `plan` job runs scripts/small_sources_matrix.py over
// the SMALL_SOURCES list and the `sync` job's matrix is `fromJSON(needs.plan.outputs.matrix)`.
//
// This check EXECUTES the real planner on the real list (blank input = the nightly's full matrix; one name =
// one job; unknown name = a failed plan, never an empty or a full run) and reads the workflow's wiring.
// Each mustCatch replays a way the full matrix could come back.
//   node --experimental-strip-types scripts/verify-small-sources-targeted-dispatch-is-one-job.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const WF = readFileSync(join(root, '.github', 'workflows', 'small-sources-sync.yml'), 'utf8');
const PLANNER = join(root, 'scripts', 'small_sources_matrix.py');
const SOURCE_PASS = 'SOURCE: ${{ github.event.inputs.source }}';
const PLAN_RUN = 'run: python scripts/small_sources_matrix.py "$SOURCE" >> "$GITHUB_OUTPUT"';
const SYNC_MATRIX = 'matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}';

const ENTRY = /^\s*-\s*\{(.+)\}\s*$/;   // the planner's and duplicateMatrixEntries' line shape
const entryLines = (t: string) =>
  t.split('\n').filter((l) => ENTRY.test(l) && !l.trimStart().startsWith('#') && /\bsource\s*:/.test(l));

// The SMALL_SOURCES literal block exactly as YAML bounds it: the lines after `SMALL_SOURCES: |` that are blank
// or indented deeper than the key.
export function block(wf: string): string | null {
  const lines = wf.split('\n');
  const i = lines.findIndex((l) => /^\s*SMALL_SOURCES:\s*\|\s*$/.test(l));
  if (i < 0) return null;
  const keyIndent = lines[i].search(/\S/);
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && l.search(/\S/) <= keyIndent) break;
    out.push(l);
  }
  return out.join('\n');
}

// A top-level job's text: from `  <name>:` to the next top-level job key (or the end of the file).
function job(wf: string, name: string): string {
  const m = new RegExp(`^  ${name}:\\s*$`, 'm').exec(wf);
  if (!m) return '';
  const rest = wf.slice(m.index + m[0].length);
  const next = /^  [A-Za-z_][\w-]*:\s*$/m.exec(rest);
  return m[0] + (next ? rest.slice(0, next.index) : rest);
}

function plan(planner: string, list: string, input: string): { ok: boolean; sources: string[]; err: string } {
  const r = spawnSync('python3', [planner, input], { encoding: 'utf8', env: { ...process.env, SMALL_SOURCES: list } });
  if (r.status !== 0) return { ok: false, sources: [], err: (r.stderr || r.error?.message || 'no output').trim() };
  const line = r.stdout.split('\n').find((l) => l.startsWith('matrix='));
  if (!line) return { ok: false, sources: [], err: 'no matrix= line' };
  return { ok: true, sources: JSON.parse(line.slice('matrix='.length)).include.map((e: { source: string }) => e.source), err: '' };
}

export function problems(wf: string, planner = PLANNER): string[] {
  const p: string[] = [];
  const sync = job(wf, 'sync');
  const planJob = job(wf, 'plan');
  const list = block(wf);
  if (!sync.includes('needs: plan') || !sync.includes(SYNC_MATRIX)) p.push(`sync job's matrix is not «${SYNC_MATRIX}» (needs: plan)`);
  if (/^\s*include:\s*$/m.test(sync) || entryLines(sync).length) p.push('sync job carries a literal matrix list — every dispatch would create every job');
  if (!planJob.includes(SOURCE_PASS) || !planJob.includes(PLAN_RUN)) p.push('plan job does not hand the dispatch input to scripts/small_sources_matrix.py');
  if (list === null) return [...p, 'no SMALL_SOURCES list in the plan job'];
  const listed = entryLines(list);
  if (entryLines(wf).length !== listed.length) p.push(`${entryLines(wf).length - listed.length} source line(s) sit outside SMALL_SOURCES — the planner never sees them`);
  if (list.includes('${{')) p.push('SMALL_SOURCES contains «${{» — GitHub would evaluate it inside the env value');
  if (listed.length < 100) p.push(`only ${listed.length} sources in SMALL_SOURCES — the list was cut`);

  const all = plan(planner, list, '');
  if (!all.ok || all.sources.length !== listed.length) p.push(`blank input (the nightly) planned ${all.sources.length}/${listed.length} jobs ${all.err}`);
  if (all.ok && all.sources.length) {
    const [first, last] = [all.sources[0], all.sources[all.sources.length - 1]];
    for (const [input, want] of [[first, [first]], [last, [last]], [`${last},${first}`, [first, last]], [` ${first} , ${last} `, [first, last]]] as const) {
      const got = plan(planner, list, input);
      if (!got.ok || got.sources.join(',') !== want.join(',')) p.push(`source=«${input}» planned [${got.sources.length > 5 ? got.sources.length + ' jobs' : got.sources}] (want [${want}]) ${got.err}`);
    }
  }
  if (plan(planner, list, 'no-such-small-source').ok) p.push('an unknown source name planned a run instead of failing the plan');
  return p;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const real = problems(WF);
const n = entryLines(block(WF) ?? '').length;
check(`nightly plans all ${n} sources; source=<one> plans 1 job; a comma list plans exactly those; unknown fails`, real.length === 0, real.join('; '));

const mutated = (from: string, to: string) => { if (!WF.includes(from)) throw new Error(`mutation anchor missing: ${from}`); return WF.replace(from, to); };
mustCatch('the pre-10-25 shape: a literal include list in the sync job (every dispatch = every job)',
  problems(mutated(`      ${SYNC_MATRIX}`, '      matrix:\n        include:\n          - { source: aldarim, cmd: "python -m scrapers.aldarim.run" }')).length > 0);
mustCatch('the plan job no longer receiving the dispatch input',
  problems(mutated(SOURCE_PASS, "SOURCE: ''")).length > 0);
mustCatch('a source line added outside SMALL_SOURCES (the planner would never schedule it)',
  problems(mutated('  sync:\n', '  sync:\n          - { source: zzstray, cmd: "python -m scrapers.zz.run" }\n')).length > 0);
mustCatch('an expression inside SMALL_SOURCES', problems(mutated('SMALL_SOURCES: |\n', 'SMALL_SOURCES: |\n            # ${{ github.actor }}\n')).length > 0);
const dir = mkdtempSync(join(tmpdir(), 'ss-plan-'));
const ignoresInput = join(dir, 'ignores_input.py');
writeFileSync(ignoresInput, readFileSync(PLANNER, 'utf8').replace('wanted = [s.strip()', 'wanted = [] and [s.strip()'));
mustCatch('a planner that ignores the input (a targeted dispatch expands to the full matrix again)', problems(WF, ignoresInput).length > 0);
const silentUnknown = join(dir, 'silent_unknown.py');
writeFileSync(silentUnknown, readFileSync(PLANNER, 'utf8').replace('if unknown:', 'if False:'));
mustCatch('an unknown name planning an empty run instead of failing', problems(WF, silentUnknown).length > 0);

if (failed) { console.error(`\n❌ verify-small-sources-targeted-dispatch-is-one-job: ${failed} check(s) failed.`); process.exit(1); }
console.log(`\n✅ verify-small-sources-targeted-dispatch-is-one-job: a targeted dispatch creates only the jobs it names; the nightly keeps all ${n}.`);
