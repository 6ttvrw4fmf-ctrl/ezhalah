// The big sky clouds drift gently (owner 2026-10-24: «make those clouds gently move»), and stay still
// for anyone who asked their device to reduce motion. Offline: reads the component and the scene tokens.
//   node --experimental-strip-types scripts/verify-hero-clouds-drift.ts
import { readFileSync } from 'node:fs';

const HERO = readFileSync('src/components/HeroBackground.tsx', 'utf8');
const SCENE = readFileSync('src/theme/skyScene.ts', 'utf8');

export function driftProblems(hero: string, scene: string): string[] {
  const out: string[] = [];
  const clouds = hero.split('\n').filter((l) => l.includes('<CloudWisp variant='));
  if (clouds.length < 1) out.push('no hero clouds found (guard cannot read the component)');
  for (const l of clouds) {
    if (!/!reduced && cloudDrift\(\d\)/.test(l)) out.push(`a hero cloud does not drift, or drifts under «reduce motion»: ${l.trim().slice(0, 90)}`);
  }
  if (!/animationDirection: 'alternate'/.test(hero) || !/animationIterationCount: 'infinite'/.test(hero)) out.push('the drift is not a gentle back-and-forth loop');
  const ms = (scene.match(/heroDriftMs:\s*\[([^\]]+)\]/)?.[1] ?? '').split(',').map((x) => Number(x.trim())).filter(Boolean);
  const px = (scene.match(/heroDriftPx:\s*\[([^\]]+)\]/)?.[1] ?? '').split(',').map((x) => Number(x.trim())).filter(Boolean);
  if (ms.length < clouds.length || px.length < clouds.length) out.push('each cloud needs its own drift duration and distance');
  if (ms.some((m) => m < 30000)) out.push(`a cloud drifts faster than gently (under 30 s per pass): ${ms.join(', ')}`);
  if (px.some((p) => p > 40)) out.push(`a cloud travels too far (over 40 px): ${px.join(', ')}`);
  if (new Set(ms).size !== ms.length) out.push('two clouds share one clock, so they move in step');
  return out;
}

const problems = driftProblems(HERO, SCENE);
for (const p of problems) console.error(`✗ ${p}`);
if (!problems.length) console.log('✓ hero clouds drift gently, each on its own clock, and stay still under «reduce motion»');

let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${caught ? 'catches' : 'BLIND to'} ${label}`);
  if (!caught) mutFail++;
};
mustCatch('a cloud that ignores «reduce motion»', driftProblems(HERO.replace('!reduced && cloudDrift(0)', 'cloudDrift(0)'), SCENE).length > 0);
mustCatch('a cloud that stopped drifting', driftProblems(HERO.replace('!reduced && cloudDrift(1)', 'false'), SCENE).length > 0);
mustCatch('a hurried drift (5 s)', driftProblems(HERO, SCENE.replace(/heroDriftMs:\s*\[(\d+)/, 'heroDriftMs: [5000')).length > 0);
mustCatch('a cloud flying across the screen (300 px)', driftProblems(HERO, SCENE.replace(/heroDriftPx:\s*\[(\d+)/, 'heroDriftPx: [300')).length > 0);
mustCatch('two clouds in lock-step', driftProblems(HERO, SCENE.replace(/heroDriftMs:\s*\[(\d+), (\d+)/, 'heroDriftMs: [$1, $1')).length > 0);
mustCatch('the shipped files are clean (not vacuously red)', problems.length === 0);
if (problems.length || mutFail) process.exit(1);
