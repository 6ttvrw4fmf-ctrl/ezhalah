// THE AI READER CAN ONLY PICK CHEAP, NON-THINKING MODELS (owner 2026-10-28: «we don't want thinking model for
// description, always use the cheapest model … let's try mistral small»).
//
// A run may name a model on the OpenRouter reader key (scrapers/facts/extract.py --model, facts-extract.yml `model`).
// The proxy (supabase/functions/facts-extract/index.ts) must refuse any model outside its closed OPENROUTER_MODELS
// list, the list must hold no reasoning / premium model, and the workflow may only offer models from that list.
// Each guard is proven by a mutation it must catch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const PREMIUM_OR_THINKING = /(^|[\/-])(r1|o1|o3|o4|gpt-4o(?!-mini)|gpt-5|opus|sonnet|claude|gemini-2\.5-pro|thinking|reason|grok)/i;

export const allowedModels = (ts: string): string[] | null => {
  const m = /const OPENROUTER_MODELS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/.exec(ts);
  if (!m) return null;
  return [...m[1].matchAll(/^\s*"([^"]+)":/gm)].map((x) => x[1]);
};

export const proxyRefusesUnlisted = (ts: string): boolean =>
  /if \(provider !== "openrouter" \|\| !\(body\.model in OPENROUTER_MODELS\)\) return json\(\{ error: `model not allowed/.test(ts) &&
  /const model = provider === "openrouter" \? \(requestedModel \|\| OPENROUTER_MODEL\) : MODEL;/.test(ts);

export const listIsCheap = (models: string[] | null): boolean =>
  !!models && models.length > 0 && models.every((m) => !PREMIUM_OR_THINKING.test(m));

export const workflowOffersOnlyListed = (yml: string, models: string[] | null): boolean => {
  const m = /\n      model:\n[\s\S]*?options: \[([^\]]*)\]/.exec(yml);
  if (!m || !models) return false;
  const opts = m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  return opts.length > 0 && opts.every((o) => models.includes(o));
};

const TS = readFileSync(join(root, 'supabase', 'functions', 'facts-extract', 'index.ts'), 'utf8');
const WF = readFileSync(join(root, '.github', 'workflows', 'facts-extract.yml'), 'utf8');
const models = allowedModels(TS);

console.log('The AI reader can only pick cheap, non-thinking models');
check('the proxy refuses a model outside OPENROUTER_MODELS', proxyRefusesUnlisted(TS));
check(`the allowed list holds no reasoning or premium model (${(models ?? []).join(', ')})`, listIsCheap(models));
check('facts-extract.yml offers only models from that list', workflowOffersOnlyListed(WF, models));

mustCatch('the refusal removed', !proxyRefusesUnlisted(TS.replace('|| !(body.model in OPENROUTER_MODELS)', '')));
mustCatch('a reasoning model added to the list', !listIsCheap([...(models ?? []), 'deepseek/deepseek-r1']));
mustCatch('a premium model added to the list', !listIsCheap([...(models ?? []), 'anthropic/claude-sonnet-4.5']));
mustCatch('the workflow offering an unlisted model',
  !workflowOffersOnlyListed(WF.replace('qwen/qwen3-235b-a22b-2507]', 'qwen/qwen3-235b-a22b-2507, openai/gpt-5]'), models));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the AI reader can only pick cheap, non-thinking models');
