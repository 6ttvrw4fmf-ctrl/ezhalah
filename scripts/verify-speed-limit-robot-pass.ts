// OUR ROBOTS PASS THE SPEED LIMIT, NOBODY ELSE DOES (owner 2026-11-12: «speed limit: switch to blocking, with a pass for
// our robots»). The Vercel firewall rule (.github/workflows/vercel-rate-limit.yml) refuses more than 300 front-door calls
// a minute per address, EXCEPT a request whose x-ezhalah-ratepass equals a one-way hash of the gate secret; our robots
// send that header (scripts/lib/robotPassCore.mjs). If the two sides ever derived different values, switching the rule to
// rate_limit would 429 our own post-deploy robots — so this check EXECUTES robotPassHeaders() and re-derives the
// workflow's value from its own shell line, and proves each half can fail.
//   node --experimental-strip-types scripts/verify-speed-limit-robot-pass.ts   (discovered by `npm test`)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE_PASS_LABEL, ratePass, robotPassHeaders } from './lib/robotPassCore.mjs';

const root = join(import.meta.dirname, '..');
const wf = readFileSync(join(root, '.github/workflows/vercel-rate-limit.yml'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const SECRET = 'test-secret-not-real';
// The workflow's own derivation: printf '%s' "$EZ_GATE_SECRET:<label>" | sha256sum
const workflowLabel = (w: string) => (/printf '%s' "\$EZ_GATE_SECRET:([a-z-]+)" \| sha256sum \| cut -d' ' -f1/.exec(w) ?? [])[1];
const workflowPass = (w: string, secret: string) => {
  const label = workflowLabel(w);
  return label ? createHash('sha256').update(`${secret}:${label}`).digest('hex') : null;
};
const sides = (w: string, robotValue: string | undefined) => !!robotValue && robotValue === workflowPass(w, SECRET);

const headers = robotPassHeaders('https://ezhalah.com/sb/rest/v1/search_listings_ar?x=1', { a: '1' }, SECRET) ?? {};
check('a robot request to the front door carries x-ezhalah-ratepass', typeof headers['x-ezhalah-ratepass'] === 'string');
check('it is never the secret itself (one-way hash)', headers['x-ezhalah-ratepass'] !== SECRET && !String(headers['x-ezhalah-ratepass']).includes(SECRET));
check('the robots and the firewall rule derive the SAME pass', sides(wf, headers['x-ezhalah-ratepass']));
check('the workflow derives it with the robots\' label', workflowLabel(wf) === RATE_PASS_LABEL);
check('no pass is sent off our front door', robotPassHeaders('https://example.com/sb/rest/v1/x', {}, SECRET) === null);
mustCatch('a workflow label that drifts from the robots\'', !sides(wf.replace(`:${RATE_PASS_LABEL}"`, ':speed-pass"'), headers['x-ezhalah-ratepass']));
mustCatch('robots that stop sending the pass', !sides(wf, undefined));
mustCatch('a robot pass derived differently', !sides(wf, ratePass(SECRET + 'x')));

// The rule itself: both front-door paths skip ONLY a matching pass (neg header condition), and a missing secret refuses.
const exempt = (w: string) => (w.match(/\{type: "header", key: "x-ezhalah-ratepass", op: "eq", value: \$pass, neg: true\}/g) ?? []).length === 2
  && /--arg pass "\$PASS"/.test(w)
  && /\[ -n "\$EZ_GATE_SECRET" \] \|\| \{ echo "EZ_GATE_SECRET secret is missing[^"]*"; exit 1; \}/.test(w)
  && /select\(\.type == "header" and \.key == "x-ezhalah-ratepass" and \.neg == true\)\] \| length\) == 2/.test(w);
check('both front-door paths exempt only the robots\' pass, a missing secret refuses, and the read-back proves it', exempt(wf));
mustCatch('the exemption dropped from one path', !exempt(wf.replace(/,\n\s*\{type: "header", key: "x-ezhalah-ratepass", op: "eq", value: \$pass, neg: true\}\]\},/, ']},')));
mustCatch('an exemption that matches everyone (neg removed)', !exempt(wf.replace('neg: true}]},', 'neg: false}]},')));
mustCatch('a rule set without the secret', !exempt(wf.replace(/\[ -n "\$EZ_GATE_SECRET" \][^\n]*\n/, '')));

if (failed) { console.error(`\n❌ verify-speed-limit-robot-pass: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-speed-limit-robot-pass: our robots carry the same pass the speed-limit rule exempts, and only they do.');
