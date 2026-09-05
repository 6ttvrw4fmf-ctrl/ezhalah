// WHEN DO THE SCHEDULED PRODUCTION CHECKS ACTUALLY FIRE, AND DO THEY PILE UP?
//
// Pure and offline so the barrier that uses it can be mutation-proven without GitHub, a clock, or a
// database. `scripts/verify-live-check-schedule-stagger.ts` is the caller.
//
// The unit of harm is CONCURRENT STARTS, not the number of workflows: every one of these fires real
// searches against the one 2-vCPU production instance, so two starting together cost roughly twice
// the contention of two spread apart, while proving exactly the same things either way. Spreading
// them is free; it changes when a check runs, never what it checks.

/** A scheduled workflow: its file, its cron lines, and whether it drives production. */
export type Scheduled = { file: string; crons: string[]; hitsProduction: boolean };

/** Minute-of-day (0..1439) firing times for one 5-field cron, over a single UTC day. */
export function firingMinutes(cron: string): number[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`not a 5-field cron: "${cron}"`);
  const [min, hour] = parts;
  const expand = (field: string, max: number): number[] => {
    const out = new Set<number>();
    for (const term of field.split(',')) {
      // `*`, `*/n`, `a-b`, `a-b/n`, or a bare number. Anything else is refused rather than guessed:
      // a schedule this cannot read must not silently contribute zero firings and read as staggered.
      const m = term.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
      if (!m) throw new Error(`unsupported cron field term: "${term}"`);
      const step = m[4] ? Number(m[4]) : 1;
      const lo = m[1] === '*' ? 0 : Number(m[2]);
      const hi = m[1] === '*' ? max : (m[3] !== undefined ? Number(m[3]) : (m[4] ? max : Number(m[2])));
      for (let v = lo; v <= hi; v += step) out.add(v);
    }
    return [...out].sort((a, b) => a - b);
  };
  const mins = expand(min, 59);
  const hours = expand(hour, 23);
  const out: number[] = [];
  for (const h of hours) for (const m of mins) out.push(h * 60 + m);
  return out.sort((a, b) => a - b);
}

export type Collision = { a: string; b: string; atMinute: number; gapMinutes: number };

/**
 * Every pair of production-driving workflows whose starts fall within `windowMinutes` of each other.
 * Wrap-around is deliberate: 23:58 and 00:03 are four minutes apart in the real world, and a
 * comparison that ignored midnight would certify the worst pile-up in the day as clean.
 */
export function collisions(items: Scheduled[], windowMinutes: number): Collision[] {
  const points: { file: string; at: number }[] = [];
  for (const it of items) {
    if (!it.hitsProduction) continue;
    for (const c of it.crons) for (const at of firingMinutes(c)) points.push({ file: it.file, at });
  }
  points.sort((a, b) => a.at - b.at);
  const found: Collision[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const raw = points[j].at - points[i].at;
      if (raw > windowMinutes) break;
      if (points[i].file === points[j].file) continue;   // a workflow does not collide with itself
      found.push({ a: points[i].file, b: points[j].file, atMinute: points[i].at, gapMinutes: raw });
    }
  }
  // Midnight wrap: compare the tail of the day against the head, shifted by 24h.
  for (const p of points) {
    if (p.at < 1440 - windowMinutes) continue;
    for (const q of points) {
      if (q.at > windowMinutes) break;
      if (p.file === q.file) continue;
      const gap = q.at + 1440 - p.at;
      if (gap <= windowMinutes) found.push({ a: p.file, b: q.file, atMinute: p.at, gapMinutes: gap });
    }
  }
  return found;
}

/** Peak concurrent starts inside any rolling `windowMinutes`, and when it happens. */
export function peakBurst(items: Scheduled[], windowMinutes: number): { peak: number; atMinute: number; files: string[] } {
  const points: { file: string; at: number }[] = [];
  for (const it of items) {
    if (!it.hitsProduction) continue;
    for (const c of it.crons) for (const at of firingMinutes(c)) points.push({ file: it.file, at });
  }
  let best = { peak: 0, atMinute: 0, files: [] as string[] };
  for (let start = 0; start < 1440; start++) {
    const inWin = points.filter((p) => {
      const d = (p.at - start + 1440) % 1440;
      return d < windowMinutes;
    });
    const files = [...new Set(inWin.map((p) => p.file))];
    if (files.length > best.peak) best = { peak: files.length, atMinute: start, files: files.sort() };
  }
  return best;
}

/** Minute-of-day range [from,to) that the daily engineering routines occupy, in UTC. */
export const ROUTINE_WINDOW_UTC = { from: 10 * 60, to: 12 * 60 + 45 };

/** Production-driving firings that land inside the routine window, where contention is worst. */
export function insideRoutineWindow(items: Scheduled[]): { file: string; atMinute: number }[] {
  const out: { file: string; atMinute: number }[] = [];
  for (const it of items) {
    if (!it.hitsProduction) continue;
    for (const c of it.crons) {
      for (const at of firingMinutes(c)) {
        if (at >= ROUTINE_WINDOW_UTC.from && at < ROUTINE_WINDOW_UTC.to) out.push({ file: it.file, atMinute: at });
      }
    }
  }
  return out;
}

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
