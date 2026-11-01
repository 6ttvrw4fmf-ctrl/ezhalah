import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

// Backlog 643 (2026-10-17/18). DeepSeek's json_object mode answers a run of blank lines on some
// conversations (its docs list this as a known issue). #7310 re-asked once with an output rule, in the
// SAME mode, and the deployed code answered the identical 39 blank characters 2/2 on 2026-10-18 — the
// customer still got HTTP 502 «empty model output». The repair: the re-ask leaves json_object mode (text
// mode answers), and the reply's JSON object is cut out of whatever wrapper text mode adds. This barrier
// EXECUTES the extractor and pins the re-ask payload shape, with a mutation proof for each.

const ROOT = join(import.meta.dirname, '..');
const FILE = join(ROOT, 'supabase/functions/agent/index.ts');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nThe empty-reply re-ask leaves json_object mode, and the object is cut out of the reply\n');

const lifted = await liftSymbols(FILE, [
  { header: 'function jsonObjectFromReply(', endsWith: /^\}$/ },
], ['jsonObjectFromReply']);
const extract = lifted.jsonObjectFromReply as (c: unknown) => string;

type Fn = (c: unknown) => string;
const CASES: Array<[unknown, string]> = [
  ['{"kind":"listings","reply":"x"}', '{"kind":"listings","reply":"x"}'],          // json mode: untouched
  ['  {"a":1}\n', '{"a":1}'],                                                        // whitespace around it
  ['```json\n{"kind":"message","af":{"x":1}}\n```', '{"kind":"message","af":{"x":1}}'],   // fenced (text mode)
  ['Here is the object:\n{"a":{"b":2}}\nDone.', '{"a":{"b":2}}'],                   // a sentence around it
  ['\n\n\n\n\n\n\n', ''],                                                            // the blank-line defect → still empty
  ['', ''], [null, ''], [undefined, ''],
  ['no object here', 'no object here'],                                              // prose → handed through, so the 502 says «unparseable» with the raw text
  ['}{', '}{'],                                                                      // braces in the wrong order → not an object, handed through
];
const extractsRight = (fn: Fn) => CASES.every(([i, o]) => fn(i) === o);
check('the JSON object is cut out of fences and sentences; a bare object, blank lines and prose keep their meaning', extractsRight(extract),
  CASES.filter(([i, o]) => extract(i) !== o).map(([i, o]) => `${JSON.stringify(i)} → ${JSON.stringify(extract(i))} (want ${JSON.stringify(o)})`).join(' | '));
mustCatch('the old String(content).trim() (fenced text-mode replies 502 as unparseable)', !extractsRight((c) => String(c ?? '').trim()));
mustCatch('an extractor that swallows prose into "" (a 502 that lies about what arrived)', !extractsRight((c) => { const s = String(c ?? '').trim(); const a = s.indexOf('{'), b = s.lastIndexOf('}'); return a >= 0 && b > a ? s.slice(a, b + 1) : ''; }));

const src = readFileSync(FILE, 'utf8');
const rawUsesExtractor = (s: string) => /const raw = jsonObjectFromReply\(choice\?\.message\?\.content\);/.test(s);
check('runModel() reads the reply through jsonObjectFromReply() before JSON.parse', rawUsesExtractor(src));
mustCatch('raw going back to String(content).trim()', !rawUsesExtractor(src.replace('const raw = jsonObjectFromReply(choice?.message?.content);', 'const raw = String(choice?.message?.content ?? "").trim();')));

const reaskLeavesJsonMode = (s: string) =>
  /const \{ response_format: _jsonMode, \.\.\.textModePayload \} = JSON\.parse\(payload\);\s*const nudgedPayload = JSON\.stringify\(\{\s*\.\.\.textModePayload,/.test(s);
check('the nudged re-ask payload is the first payload WITHOUT response_format (text mode)', reaskLeavesJsonMode(src));
mustCatch('the re-ask spreading JSON.parse(payload) again (json_object mode, the shape that answered blank 2/2)',
  !reaskLeavesJsonMode(src.replace(/const \{ response_format: _jsonMode, \.\.\.textModePayload \} = JSON\.parse\(payload\);\s*/, '').replace('...textModePayload,', '...JSON.parse(payload),')));

const firstAttemptKeepsJsonMode = (s: string) => /max_tokens: 1500,[\s\S]{0,400}?response_format: \{ type: "json_object" \},\s*\}\);/.test(s);
check('the FIRST attempt still asks in json_object mode (the cheap, usually-right path is unchanged)', firstAttemptKeepsJsonMode(src));
mustCatch('json_object mode removed from the first attempt too', !firstAttemptKeepsJsonMode(src.replace('response_format: { type: "json_object" },\n      });', '});')));

const sendsNudgedOnRetry = (s: string) => /body: emptyRetried \? nudgedPayload : payload/.test(s);
check('the fetch site sends the text-mode payload only on the empty re-ask', sendsNudgedOnRetry(src));
mustCatch('the fetch site sending the first payload on both attempts', !sendsNudgedOnRetry(src.replace('body: emptyRetried ? nudgedPayload : payload', 'body: payload')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the empty-reply re-ask leaves json_object mode and the object is cut out of the reply');
