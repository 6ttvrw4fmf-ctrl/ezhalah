// THE DEPLOY'S CANARY BROWSER: retried, with a no-apt fallback, and PROVEN to start before anything deploys.
// 2026-11-11 12:24–15:00 UTC every «Deploy frontend (production)» run stopped at «Install the browser the canary gate
// drives»: the runner's apt mirrors did not resolve, `playwright install --with-deps` exited 100, nothing shipped. The
// step now retries, falls back to Chromium alone, and then LAUNCHES it — a browser that cannot start must stop the run
// before safe-deploy.sh, never leave the canary UNDETERMINED (CodeRabbit #11887).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (what: string, brokenPasses: boolean) => check(`MUTATION caught: ${what}`, !brokenPasses);

const wf = readFileSync(join(root, '.github/workflows/deploy-frontend.yml'), 'utf8');
const stepOf = (src: string) => { const a = src.indexOf('- name: Install the browser the canary gate drives'); const b = src.indexOf('- name: Deploy via the sanctioned guarded entrypoint'); return a >= 0 && b > a ? src.slice(a, b) : ''; };
const proves = (src: string) => {
  const step = stepOf(src);
  const retry = step.indexOf('for i in 1 2 3; do'); const fallback = step.indexOf('npx playwright install chromium'); const launch = step.indexOf("require('@playwright/test').chromium.launch()");
  return retry >= 0 && fallback > retry && launch > fallback && /process\.exit\(1\)/.test(step.slice(launch));
};
check('the install step sits before the deploy step, retries, falls back, then launches Chromium (exit 1 if it cannot)', proves(wf));
mustCatch('a step without the launch proof', proves(wf.replace("require('@playwright/test').chromium.launch()", 'true')));
mustCatch('a launch that cannot fail the run', proves(wf.replace('process.exit(1)', 'process.exit(0)')));
mustCatch('a step with no retry (the outage shape)', proves(wf.replace('for i in 1 2 3; do', 'for i in 1; do').replace('for i in 1; do', 'for x in 1; do')));

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nthe deploy cannot run with a canary browser that does not start');
