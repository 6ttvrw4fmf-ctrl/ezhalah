// Regression: logged-out users always see a sign-in action in the top bar (owner 2026-08-19).
// On mobile the sidebar is a drawer (hamburger), so the sign-in CTA would be invisible without
// this top-bar pill. On desktop the docked sidebar already shows it, so the top-bar version is
// gated on !docked. Both screens (Filter home + AI Agent) carry it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const agentSrc = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// Both screens must have a sign-in button in the top bar for logged-out, non-docked (mobile) users.
check('index.tsx: top-bar sign-in rendered when !user && !docked', /!user && !docked[\s\S]{0,100}?topSignIn/.test(indexSrc));
check('agent.tsx: top-bar sign-in rendered when !user && !docked', /!user && !docked[\s\S]{0,100}?topSignIn/.test(agentSrc));

// Both must call openAuth (the store's auth modal opener), not navigate to /auth.
check('index.tsx: top-bar sign-in calls openAuth', /topSignIn[\s\S]{0,80}?onPress=\{openAuth\}/.test(indexSrc));
check('agent.tsx: top-bar sign-in calls openAuth', /topSignIn[\s\S]{0,80}?onPress=\{openAuth\}/.test(agentSrc));

// openAuth must be destructured from useApp in both screens.
check('index.tsx: openAuth destructured from useApp', /openAuth/.test(indexSrc) && /useApp\(\)/.test(indexSrc));
check('agent.tsx: openAuth destructured from useApp', /openAuth/.test(agentSrc) && /useApp\(\)/.test(agentSrc));

// The sign-in text must use the translated 'Sign up / Log in' key (same as sidebar CTA).
check('index.tsx: uses translated Sign up / Log in', /Sign up \/ Log in/.test(indexSrc));
check('agent.tsx: uses translated Sign up / Log in', /Sign up \/ Log in/.test(agentSrc));

// Styles must exist.
check('index.tsx: topSignIn style defined', /topSignIn:/.test(indexSrc));
check('agent.tsx: topSignIn style defined', /topSignIn:/.test(agentSrc));

console.log(failed === 0 ? '\n✓ all top-bar sign-in assertions passed' : `\n✗ ${failed} top-bar sign-in assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
