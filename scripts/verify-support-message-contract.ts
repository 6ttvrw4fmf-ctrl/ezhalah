#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-support-message-contract — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * Owner request (2026-09-02): an in-app support form that reaches support@ezhalah.com, with
 * "no SMTP/API secrets in the browser" and real spam protection.
 *
 * What this pins, and why each one is a way the feature could quietly rot:
 *   1. the VALIDATOR IS EXECUTED (not read) — a form that accepts an empty message or a non-email
 *      reply address produces support tickets nobody can answer.
 *   2. NO CREDENTIAL IN CLIENT CODE — a mail-provider key or a service-role key shipped in the app
 *      bundle is a public key. The browser may hold the publishable key and nothing else.
 *   3. the INBOX ADDRESS is the one the owner named. A typo'd inbox loses every message silently.
 *   4. the STORE IS LOCKED — RLS on, and no policy. A support inbox is other people's email
 *      addresses and problems; an anon-readable one is a data breach, an anon-writable one is a
 *      spam sink.
 *   5. RAW IP IS NEVER STORED — PDPL minimisation. Rate limiting needs "same source?", which a
 *      salted hash answers.
 *   6. HONEYPOT + RATE LIMIT exist in the edge function.
 *   7. the FORM'S FOUR STATES exist in the UI, and a failure keeps the draft (a form that clears
 *      the user's typed problem report on a network blip is worse than no form).
 *   8. the SUCCESS COPY NEVER CLAIMS AN EMAIL WAS SENT. No provider is configured; the message is
 *      stored. Saying "we emailed support" would be a lie the code cannot back.
 *   9. the function is DEPLOYABLE THROUGH THE GATED PATH (present in the workflow's choice list) —
 *      otherwise the only route to production is a laptop CLI, which is the thing that workflow
 *      exists to replace.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { validateSupportMessage, SUBJECT_MIN, MESSAGE_MIN } from '../src/lib/supportDraft.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// ── 1. the real validator, executed (the module the app itself imports) ──
const ok = { subject: 'مشكلة في البحث', message: 'ما تظهر لي النتائج في حي الملقا أبد', email: 'a@b.co' };
check('a complete draft validates', validateSupportMessage(ok) === null);
check('empty subject is rejected', validateSupportMessage({ ...ok, subject: '' }) === 'subject');
check('whitespace-only subject is rejected (trim, not length)', validateSupportMessage({ ...ok, subject: '     ' }) === 'subject');
check(`subject under ${SUBJECT_MIN} chars is rejected`, validateSupportMessage({ ...ok, subject: 'ا' }) === 'subject');
check('empty message is rejected', validateSupportMessage({ ...ok, message: '' }) === 'message');
check(`message under ${MESSAGE_MIN} chars is rejected`, validateSupportMessage({ ...ok, message: 'قصيرة' }) === 'message');
check('a non-email reply address is rejected', validateSupportMessage({ ...ok, email: 'not-an-email' }) === 'email');
check('an address with no TLD is rejected', validateSupportMessage({ ...ok, email: 'a@b' }) === 'email');
check('an address with a space is rejected', validateSupportMessage({ ...ok, email: 'a b@c.co' }) === 'email');
check('subject is reported before message (first missing field wins)',
  validateSupportMessage({ subject: '', message: '', email: '' }) === 'subject');

// ── 2. no credential may live in client code ──
const CLIENT_DIRS = ['src'];
const SECRET_RE = /RESEND_API_KEY|SENDGRID|SMTP_(HOST|PASS|USER)|SERVICE_ROLE|POSTMARK|MAILGUN/;
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const leaks = CLIENT_DIRS.flatMap(walk).filter((f) => SECRET_RE.test(readFileSync(f, 'utf8')));
check('no mail-provider or service-role credential is referenced anywhere in src/', leaks.length === 0, leaks.join(', '));

// ── 3-6. the edge function ──
const fn = readFileSync('supabase/functions/support-message/index.ts', 'utf8');
// The destination became configurable on 2026-09-03 (no mailbox exists at support@ezhalah.com yet,
// so delivery has to be pointed at an inbox the owner actually reads). What must NOT change is the
// FALLBACK: an unset or misspelled secret has to land on the address the product promises, never on
// an empty string — which would send a real user's support request to nobody at all.
check('the support inbox is configurable, and DEFAULTS to support@ezhalah.com',
  /const SUPPORT_INBOX = Deno\.env\.get\("SUPPORT_INBOX"\) \|\| "support@ezhalah\.com";/.test(fn));
check('the inbox default is a real address, never an empty fallback',
  !/SUPPORT_INBOX"\)\s*(\?\?|\|\|)\s*""/.test(fn));
check('the email is addressed to that inbox', /to: \[SUPPORT_INBOX\]/.test(fn));
// Reply-to is the whole point of the feature: the owner opens the mail, presses Reply, and it goes
// to the person who wrote in. Without it every support message is a dead end that has to be answered
// by hand-copying an address out of the body — and nothing else in this file noticed it was missing.
check("the reply-to carries the USER's address, so Reply answers the person who wrote in",
  /reply_to: row\.reply_email,/.test(fn));
check('the honeypot short-circuits BEFORE anything is stored',
  fn.indexOf('payload.website') > -1 && fn.indexOf('payload.website') < fn.indexOf('.insert('));
check('a honeypot hit answers 200 (a bot learns nothing from the response)',
  /if \(str\(payload\.website, \d+\)\) return json\(\{ ok: true, dropped: true \}\)/.test(fn));
check('a per-source hourly rate limit exists and returns 429',
  /MAX_PER_HOUR\s*=\s*\d+/.test(fn) && fn.includes("json({ error: \"rate_limited\" }, 429)"));
check('the rate limit counts on the HASH, never the address', fn.includes('.eq("ip_hash", ipHash)'));
check('the IP is hashed with SHA-256 and never stored raw',
  fn.includes('crypto.subtle.digest("SHA-256"') && !/insert\([^)]*raw/s.test(fn) && !fn.includes('ip: raw'));
check('email is attempted ONLY when a provider key exists', fn.includes('if (RESEND_API_KEY) {'));
check('a failed email does not fail the request (the message is already durable)',
  fn.indexOf('delivery_status: err ?') > fn.indexOf('if (error || !data) return json'));
check('the service-role key is read from the environment, never hardcoded',
  fn.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")') && !/eyJ[A-Za-z0-9_-]{20,}/.test(fn));

// ── the migration ──
const migFile = readdirSync('supabase/migrations').find((f) => f.endsWith('_support_messages.sql'));
check('the support_messages migration exists in git', !!migFile);
const mig = migFile ? readFileSync(`supabase/migrations/${migFile}`, 'utf8') : '';
// Anchored at line start with no `--`: a commented-out ALTER is not a code path, and the first
// version of this check passed on exactly that mutation.
check('RLS is enabled on support_messages',
  /^\s*alter table public\.support_messages enable row level security\s*;/m.test(mig));
check('NO policy is granted — service-role is the only way in',
  !/create\s+policy/i.test(mig));
check('the table stores a hash column, not an ip column',
  /ip_hash\s+text/.test(mig) && !/\bip\s+(text|inet)/.test(mig));
check('deleting an account does not orphan the ticket to a stranger',
  /user_id\s+uuid references auth\.users\(id\) on delete set null/.test(mig));

// ── 7-8. the form ──
const modal = readFileSync('src/components/InfoModal.tsx', 'utf8');
check('the form has all four states and no fifth',
  /useState<'idle' \| 'sending' \| 'sent' \| 'error'>\('idle'\)/.test(modal));
check('a failed send keeps the draft on screen (only the SENT path clears it)',
  modal.includes("setState('error');") && !/setState\('error'\);\s*\n\s*set(Subject|Message)\(''\)/.test(modal));
check('the Send control shows a busy state and cannot be double-fired',
  modal.includes('disabled={sending}') && modal.includes('ActivityIndicator'));
check('the retry affordance appears on failure', modal.includes("state === 'error' ? t('Try again')"));
check('support@ is no longer a dead address card — the form replaced it',
  modal.includes('<SupportForm t={t} />') && !modal.includes('email="support@ezhalah.com"'));
check('partnerships still show partners@ezhalah.com', modal.includes('email="partners@ezhalah.com"'));
check('the form is theme-token only (no hardcoded hex in the new styles)',
  !/(sendBtn|sentCard|fieldBox|errTx)[^\n]*#[0-9a-fA-F]{3,8}/.test(modal));

// ── 10. THE DRAFT SURVIVES THE DIALOG (routine #6, 2026-09-03) ──
//
// §7 pinned "a failed send keeps the draft on screen" and stopped there, so the likelier accident
// stayed open: this form lives inside InfoModal's dialog, whose backdrop is a full-viewport
// Pressable that closes on tap, and closing UNMOUNTS SupportForm along with all its useState.
// Measured against production 2/2 in fresh desktop contexts: 126 characters typed, one click at
// x=12, reopen → every field empty. The design note this feature shipped with says losing a typed
// problem report is "the one outcome this form must never produce"; a network blip was guarded and
// a stray click was not.
//
// The cache is EXECUTED here, not read, for the same reason the validator is.
const cache = await import('../src/lib/supportDraft.ts');
const DRAFT = { subject: 'مشكلة', message: 'ما تظهر لي النتائج في حي الملقا أبد', email: 'a@b.co' };
cache.forgetSupportDraft();
check('nothing is recalled before anything is remembered', cache.recallSupportDraft() === null);
cache.rememberSupportDraft(DRAFT);
check('a draft interrupted mid-typing comes back intact',
  JSON.stringify(cache.recallSupportDraft()) === JSON.stringify(DRAFT));
check('the recalled draft is a COPY — mutating it cannot corrupt the cache',
  (() => { const d = cache.recallSupportDraft()!; d.message = 'tampered'; return cache.recallSupportDraft()!.message === DRAFT.message; })());
cache.rememberSupportDraft({ subject: '', message: '', email: 'a@b.co' });
check('an email-only draft is not worth keeping (empty subject AND message ⇒ nothing held)',
  cache.recallSupportDraft() === null);
cache.rememberSupportDraft({ subject: '', message: 'نص طويل نصف مكتوب', email: '' });
check('a HALF-written draft is kept — that is the state a stray tap catches',
  cache.recallSupportDraft()?.message === 'نص طويل نصف مكتوب');
cache.forgetSupportDraft();
check('forgetting clears it', cache.recallSupportDraft() === null);

check('the form restores the held draft on mount, lazily (not on every render)',
  /useState\(\s*\(\)\s*=>\s*recallSupportDraft\(\)\?\.subject/.test(modal)
  && /useState\(\s*\(\)\s*=>\s*recallSupportDraft\(\)\?\.message/.test(modal));
check('the form holds the draft on every keystroke, not only on failure',
  /useEffect\(\(\) => \{ rememberSupportDraft\(\{ subject, message, email \}\); \}, \[subject, message, email\]\)/.test(modal));
check('a DELIVERED message is forgotten, so it cannot return as a draft',
  /forgetSupportDraft\(\);\s*\n\s*setState\('sent'\)/.test(modal));
// The draft is one person's problem report and their email address. It is memory-only by design —
// writing it to disk would be new at-rest retention on a PDPL surface (store.tsx: "guests:
// session-only, nothing on disk") — and it must not outlive the session that typed it.
// Anchored to real CODE lines — this barrier already learned once that a commented-out
// `alter table … enable row level security` passed a naive substring check.
const draftCode = readFileSync('src/lib/supportDraft.ts', 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
check('the draft cache never touches disk (no localStorage / AsyncStorage in code)',
  !/localStorage|AsyncStorage|sessionStorage/.test(draftCode));
const store = readFileSync('src/store.tsx', 'utf8');
check('sign-out and account deletion both drop the held draft',
  (store.match(/forgetSupportDraft\(\)/g) || []).length >= 2);

// ── 11. A RATE LIMIT IS NOT A CONNECTION PROBLEM (routine #6, 2026-09-03) ──
//
// The edge function answers 429 `rate_limited` after MAX_PER_HOUR, and `sendSupportMessage` has
// always returned that reason distinctly — the form threw it away and rendered "check your
// connection and try again" for both. Measured against production (route fulfilled with a real 429,
// desktop): the connection copy rendered. That sends someone to fix a network that works and offers
// a retry that cannot succeed until the hour rolls over — PART 5 shape 12.
// The dialog's × needs a UNIQUE handle: AuthModal raises itself for signed-out visitors carrying
// the same `accessibilityLabel={t('Close')}`, so a label-based locator picks ITS × sitting behind
// this dialog — pointer-blocked, the click times out, and the ×-half of the journey quietly SKIPS
// while reading as coverage. Losing the handle would restore that silence.
check('the dialog\'s close control is addressable by testID, not only by an ambiguous label',
  modal.includes('testID="info-modal-close"'));

check('the form keeps WHY the send failed, not just that it did',
  /setFailure\(r\.reason === 'rate_limited' \? 'rate_limited' : 'failed'\)/.test(modal));
check('a rate limit gets its own copy, and the connection copy stays for real failures',
  /failure === 'rate_limited'\s*\n?\s*\?\s*t\('You have sent several messages already/.test(modal)
  && modal.includes("t(\"Couldn't send your message. Check your connection and try again.\")"));

const i18n = readFileSync('src/i18n.tsx', 'utf8');
check('the rate-limit copy is translated and says WAIT, never "check your connection"',
  /'You have sent several messages already\. Please wait about an hour before sending another\.':\s*\n?\s*'[^']*انتظر[^']*'/.test(i18n));
check('the success copy promises a REPLY, never a sent email',
  i18n.includes('"We\'ll reply to {email}.": \'بنرد عليك على {email}.\'')
  && !/(أرسلنا|تم الإرسال إلى support)/.test(i18n));
check('every new form string is translated', ['Subject', 'Message', 'Your email', 'Sending…', 'Try again',
  'Your message reached us', 'Send another message'].every((k) => i18n.includes(`'${k}':`)));

// ── 9. the gated deploy path ──
const wf = readFileSync('.github/workflows/deploy-edge-function.yml', 'utf8');
check('support-message is deployable through the gated workflow', /^\s+- support-message$/m.test(wf));

if (failed) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nOK — support form: validated, credential-free client, locked store, honest copy.');
