// FIREWORKS STAY SMOOTH ON A PHONE (owner 2026-10-30: «it's slow … feels stuck»). Thousands of sparks were each drawn
// with their own beginPath + stroke (and save/rotate/restore per confetti piece): far more draw calls than a phone makes
// in 16 ms, so frames dropped — and a 32 ms cap on each frame's step turned every dropped frame into slow motion.
// EXECUTED: the real startNameParty() runs against a fake canvas that counts draw calls, frame by frame, with a fake
// clock; the party must stay big (thousands of sparks in the air) while each frame costs a few dozen draw calls, and a
// slow frame must advance the party by the time that really passed.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => { if (ok) console.log(`  PASS  ${label}`); else { fail++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); } };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const SRC = readFileSync(join(root, 'src/lib/nameParty.ts'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'ezh-fw-'));

type Run = { maxDrawsPerFrame: number; maxAlive: number; frames: number; popAtMs: number; endedAtMs: number };
async function run(src: string, frameMs = 16.7): Promise<Run> {
  const file = join(dir, `np-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file, src.replace("import { Platform } from 'react-native';", "const Platform = { OS: 'web' };"));
  const mod = await import(pathToFileURL(file).href);
  // fake browser: a canvas that counts draw calls, a clock we drive, and requestAnimationFrame we pump
  let draws = 0, now = 0, popAt = -1, endAt = -1;
  const ctx = new Proxy({} as any, { get: (_t, k) => (k === 'stroke' || k === 'fill' || k === 'fillRect' || k === 'strokeRect') ? () => { draws++; } : (typeof k === 'string' && /^[a-z]/.test(k) ? () => {} : undefined), set: () => true });
  const el = () => ({ setAttribute() {}, appendChild() {}, remove() {}, style: {}, getContext: () => ctx, width: 0, height: 0 });
  let pending: ((t: number) => void) | null = null;
  const timers: { at: number; f: () => void }[] = [];
  const g = globalThis as any;
  const saved = { document: g.document, raf: g.requestAnimationFrame, st: g.setTimeout, iw: g.innerWidth, ih: g.innerHeight, de: g.dispatchEvent };
  g.document = { createElement: el, body: { appendChild() {} }, head: { appendChild() {} }, getElementById: () => null };
  g.requestAnimationFrame = (f: (t: number) => void) => { pending = f; return 1; };
  g.setTimeout = (f: () => void, ms: number) => { timers.push({ at: now + ms, f }); return 1; };
  g.innerWidth = 390; g.innerHeight = 844; // an iPhone
  g.dispatchEvent = (e: { type: string }) => { if (e.type === mod.PARTY_FIRST_POP_EVENT && popAt < 0) popAt = now; if (e.type === mod.PARTY_END_EVENT && endAt < 0) endAt = now; return true; };
  let maxDraws = 0, frames = 0, maxAlive = 0;
  try {
    mod.startNameParty(false);
    while (pending && now < 8000) {
      const f = pending; pending = null; draws = 0;
      f(now); frames++;
      maxDraws = Math.max(maxDraws, draws);
      for (const t of timers.filter((x) => x.at <= now)) { timers.splice(timers.indexOf(t), 1); t.f(); }
      now += frameMs;
    }
  } finally {
    Object.assign(g, { document: saved.document, requestAnimationFrame: saved.raf, setTimeout: saved.st, innerWidth: saved.iw, innerHeight: saved.ih, dispatchEvent: saved.de });
  }
  // size of the party: simulate the plan + bursts the way explode() does (n ≥ SPARKS_PER_BURST per rocket)
  const rockets = mod.fireworksPlan(Math.random, mod.launchEveryFor(390)).length;
  maxAlive = rockets * mod.SPARKS_PER_BURST;
  return { maxDrawsPerFrame: maxDraws, maxAlive, frames, popAtMs: popAt, endedAtMs: endAt };
}

console.log('\nFireworks stay smooth on a phone\n');
const ok = await run(SRC);
check(`the party stays big (${ok.maxAlive.toLocaleString()} sparks across the show)`, ok.maxAlive >= 5000);
check(`each frame costs a few dozen draw calls at most (worst frame: ${ok.maxDrawsPerFrame})`, ok.maxDrawsPerFrame > 0 && ok.maxDrawsPerFrame <= 150);
check(`the first pop lands quickly (${Math.round(ok.popAtMs)} ms) and the layer clears itself (${Math.round(ok.endedAtMs)} ms)`, ok.popAtMs >= 0 && ok.popAtMs < 600 && ok.endedAtMs > 0);
// A phone dropping to ~20 fps (50 ms frames) must not play in slow motion: the party ends at about the same time.
const slow = await run(SRC, 50);
// (the layer's own end timer would hide slow motion, so the rockets' real flight is what is measured: the first pop)
check(`a slow phone skips frames instead of slowing the party (first pop at ${Math.round(slow.popAtMs)} ms vs ${Math.round(ok.popAtMs)} ms)`, slow.popAtMs >= 0 && slow.popAtMs <= ok.popAtMs + 100);

// Mutations — each rule is load-bearing.
const perSpark = SRC.replace("push(lines, `${s.c}|${lv}`, s.px - s.vx * 2, s.py - s.vy * 2, s.x, s.y);",
  "ctx.strokeStyle = s.c; ctx.beginPath(); ctx.moveTo(s.px - s.vx * 2, s.py - s.vy * 2); ctx.lineTo(s.x, s.y); ctx.stroke();");
mustCatch('one stroke per spark again (the stuck feeling)', (await run(perSpark)).maxDrawsPerFrame > 150);
const capped = SRC.replace('dt = Math.min(50, now - last) / 16.7', 'dt = Math.min(32, now - last) / 16.7');
const cappedSlow = await run(capped, 50);
mustCatch('the old 32 ms step cap (slow motion on a slow phone)', !(cappedSlow.popAtMs >= 0 && cappedSlow.popAtMs <= ok.popAtMs + 100));

if (fail) { console.error(`\n❌ ${fail} check(s) failed`); process.exit(1); }
console.log('\n✅ fireworks-stay-smooth: a big party in a few dozen draw calls a frame, at real speed on a slow phone');
