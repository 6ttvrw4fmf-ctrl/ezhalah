// THE HEADLINE SHINE NEVER HIDES THE WORDS (owner 2026-11-01: after sign-in the headline was blank on iPhone, dark mode —
// «I don't get the fact … it says like a sentence»: only the sentence under it showed). The sign-in confetti turns the
// headline's shine on (NAME_PARTY_EVENT), and the shine painted a dark-green gradient through see-through letters
// (background-clip:text + transparent fill). On the dark theme that is invisible, and iPhone Safari can leave such text
// unpainted. The shine must glow ON visible letters. EXECUTED against the real CSS string: every rule and keyframe that the
// shine selector reaches is parsed, and none may make the text transparent, clip it, or fade it out.
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const SRC = readFileSync(new URL('../src/lib/nameParty.ts', import.meta.url), 'utf8');
const HOME = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');

/** Problems with the shine in a nameParty.ts source: the CSS template is pulled out and its shine rules + keyframes read. */
function shineProblems(src: string): string[] {
  const css = (src.match(/const CSS = `([\s\S]*?)`;/) ?? [])[1];
  if (!css) return ['no CSS template found'];
  const out: string[] = [];
  const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const shine = rules.filter((r) => /\[data-ezh-shine="on"\](?!\s*\[)/.test(r.sel));
  if (!shine.length) out.push('no [data-ezh-shine="on"] rule');
  const anim = shine.map((r) => (r.body.match(/animation:\s*([\w-]+)/) ?? [])[1]).find(Boolean);
  if (!anim) out.push('the shine has no animation');
  const kf = anim ? (css.match(new RegExp(`@keyframes ${anim}\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`)) ?? [])[1] : undefined;
  if (anim && !kf) out.push(`keyframes ${anim} missing`);
  const bodies = [...shine.map((r) => r.body), kf ?? ''].join(';');
  if (/transparent/i.test(bodies.replace(/rgba\([^)]*\)/g, ''))) out.push('text made transparent');
  if (/background-clip\s*:\s*text/i.test(bodies)) out.push('text clipped to a background');
  if (/opacity\s*:\s*0(?![.\d])/.test(bodies)) out.push('text faded to opacity 0');
  if (kf && !/color\s*:/.test(kf)) out.push('the shine never changes the letters\' colour (nothing visible shines)');
  return out;
}

const now = shineProblems(SRC);
check(`the shine glows on visible letters — no transparent fill, no clip, no fade${now.length ? ` (${now.join('; ')})` : ''}`, now.length === 0);
check('the headline still carries the shine switch', HOME.includes("dataSet: { ezhShine: heroShine ? 'on' : 'off' }"));

const OLD = '[data-ezh-shine="on"]{background-image:linear-gradient(100deg,#2f7247 30%,#5fae7c 45%,#d8b14a 50%,#5fae7c 55%,#2f7247 70%)!important;background-size:250% 100%!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent;color:transparent!important;animation:ezhShine 2.4s ease-in-out 2}';
const ruleNow = (SRC.match(/\[data-ezh-shine="on"\]\{[^}]*\}/) ?? [''])[0];
const mut = (a: string, b: string) => { if (!SRC.includes(a)) throw new Error(`mutation anchor missing: ${a}`); return SRC.replace(a, b); };
mustCatch('the old see-through gradient back', shineProblems(mut(ruleNow, OLD)).length > 0);
mustCatch('just the fill made transparent', shineProblems(mut(ruleNow, ruleNow.replace('{', '{-webkit-text-fill-color:transparent;'))).length > 0);
mustCatch('background-clip:text alone', shineProblems(mut(ruleNow, ruleNow.replace('{', '{background-clip:text;'))).length > 0);
mustCatch('a keyframe that fades the words out', shineProblems(mut('50%{color:#d8b14a;', '50%{opacity:0;color:#d8b14a;')).length > 0);
mustCatch('a shine that changes nothing visible', shineProblems(mut('50%{color:#d8b14a;', '50%{')).length > 0);

if (failed) { console.error(`\n❌ verify-headline-shine-never-hides-text: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-headline-shine-never-hides-text: the headline stays readable while it shines.');
