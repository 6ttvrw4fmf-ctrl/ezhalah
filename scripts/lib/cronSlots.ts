// Pure predicates over a cron schedule set — the same semantics as the production functions
// public.ops_cron_start_instants(), public.mon_cron_hog_windows(), public.mon_minute_in_window() and
// public.mon_cron_starved_schedules(), so a review-time verdict and the live detectors agree.
//
// Used by scripts/verify-cron-slot-discipline.ts against sql/mirrors/cron_schedule.json.

export type CronJobs = Record<string, string>; // jobname -> 5-field schedule

const SHAPE = /^(\*|\d+(,\d+)*|\*\/\d+|\d+-\d+(\/\d+)?)$/;

/** Values a cron field selects in [lo, hi]. A field in none of the parsed shapes selects EVERY
 *  value — fail open, like ops_cron_start_instants() (its absence was ops_incident #389). */
export function fieldValues(f: string, lo: number, hi: number): number[] {
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  if (!SHAPE.test(f) || f === '*') return all;
  if (/^\d+(,\d+)*$/.test(f)) return [...new Set(f.split(',').map(Number))].filter((v) => v >= lo && v <= hi);
  if (/^\*\/\d+$/.test(f)) { const s = Number(f.slice(2)); return all.filter((v) => v % s === 0); }
  const [range, stepS] = f.split('/');
  const [a, b] = range.split('-').map(Number);
  const step = Number(stepS ?? '1');
  return all.filter((v) => v >= a && v <= b && (v - a) % step === 0);
}

/** Every (hour, minute) a job starts in a day. Day-of-month / month / weekday are ignored, as in
 *  production: a weekly job is counted in every day it COULD run, never discarded. */
export function startInstants(schedule: string): Array<[number, number]> {
  const [mf = '', hf = ''] = schedule.trim().split(/\s+/);
  const mins = fieldValues(mf, 0, 59);
  const hrs = fieldValues(hf, 0, 23);
  return hrs.flatMap((h) => mins.map((m) => [h, m] as [number, number]));
}

/** Jobs per (hour, minute). */
export function occupancy(jobs: CronJobs): Map<string, string[]> {
  const occ = new Map<string, string[]>();
  for (const [name, s] of Object.entries(jobs)) {
    for (const [h, m] of startInstants(s)) {
      const k = `${h}:${m}`;
      occ.set(k, [...(occ.get(k) ?? []), name]);
    }
  }
  return occ;
}

/** Instants where anything starts on minute 0 (reserved for the matview refresh alone). */
export function minuteZeroStarts(jobs: CronJobs): string[] {
  return [...occupancy(jobs)].filter(([k]) => k.endsWith(':0'))
    .map(([k, js]) => `${k.split(':')[0].padStart(2, '0')}:00 → ${js.join(', ')}`);
}

export function maxPerInstant(jobs: CronJobs): { max: number; where: string[] } {
  let max = 0; let where: string[] = [];
  for (const [k, js] of occupancy(jobs)) {
    if (js.length > max) { max = js.length; where = []; }
    if (js.length === max) where.push(`${k} → ${js.join(', ')}`);
  }
  return { max, where };
}

const PLAIN_HOURLY = /^\d+(,\d+)* \* \* \* \*$/;

/** p95 seconds for every job measured at or above the 120 s hog bar (mon_cron_hog_windows). */
export type HogP95 = Record<string, number>;

/** (victim, minute, hog) triples: an hourly plain-list job starting inside another hourly job's
 *  p95 window — exactly mon_cron_starved_schedules(). Window = start + 0..ceil(p95/60), mod 60. */
export function starvedPairs(jobs: CronJobs, hogs: HogP95, bar = 120): string[] {
  const windows: Array<{ hog: string; start: number; k: number }> = [];
  for (const [name, p95] of Object.entries(hogs)) {
    const s = jobs[name];
    if (s === undefined || !PLAIN_HOURLY.test(s) || !(p95 >= bar)) continue;
    for (const m of s.split(' ')[0].split(',').map(Number)) {
      windows.push({ hog: name, start: m, k: Math.ceil(Math.round(p95) / 60) });
    }
  }
  const out: string[] = [];
  for (const [name, s] of Object.entries(jobs)) {
    if (!PLAIN_HOURLY.test(s)) continue;
    for (const m of s.split(' ')[0].split(',').map(Number)) {
      for (const w of windows) {
        if (w.hog === name) continue;
        for (let i = 0; i <= w.k; i++) {
          if ((w.start + i) % 60 === m) { out.push(`${name}:${m} < ${w.hog}`); break; }
        }
      }
    }
  }
  return [...new Set(out)].sort();
}

/** Two jobs that take the search_listings_ar single-writer lock starting in the same instant —
 *  limb 2 of mon_detect_cron_minute_collision(): the loser writes nothing and reports success. */
export function writerCollisions(jobs: CronJobs, writers: string[]): string[] {
  const w = new Set(writers);
  return [...occupancy(jobs)]
    .map(([k, js]) => [k, js.filter((j) => w.has(j))] as const)
    .filter(([, js]) => js.length >= 2)
    .map(([k, js]) => `${k} → ${js.join(', ')}`);
}

/** A single-writer job EVERY one of whose daily starts falls inside another single-writer job's p95 run
 *  window: it takes pg_try_advisory_xact_lock('search_listings_ar:single_writer'), is refused at every
 *  start, writes nothing and still reports `succeeded` — mon_detect_search_writer_starved()'s condition,
 *  judged at review time. Hour-aware over startInstants(), so it covers EVERY schedule shape: starvedPairs()
 *  only judges plain-hourly victims and writerCollisions() only same-instant starts, which is how
 *  sync-rich-attrs-wasalt was re-slotted to minute 30 of every third hour inside sync-search-listings-ar's :22 + 890 s window
 *  (2026-11-04, alert 12926) with every check green. A writer that is refused at SOME starts (an every-10-minutes job
 *  that also starts outside the window) still gets passes, so it is not reported. */
export function starvedWriters(jobs: CronJobs, writers: string[], hogs: HogP95): string[] {
  const out: string[] = [];
  for (const victim of writers) {
    const vs = jobs[victim];
    if (vs === undefined) continue;
    const starts = startInstants(vs);
    if (starts.length === 0) continue;
    const coveredBy = new Set<string>();
    const allCovered = starts.every(([h, m]) => {
      const t = h * 60 + m;
      for (const hog of writers) {
        if (hog === victim || !(hogs[hog] > 0) || jobs[hog] === undefined) continue;
        const k = Math.ceil(Math.round(hogs[hog]) / 60);
        for (const [hh, hm] of startInstants(jobs[hog])) {
          const d = (t - (hh * 60 + hm) + 1440) % 1440; // minutes since that hog start, wrapping midnight
          if (d >= 0 && d <= k) { coveredBy.add(hog); return true; }
        }
      }
      return false;
    });
    if (allCovered) out.push(`${victim} '${vs}' < ${[...coveredBy].sort().join(', ')}`);
  }
  return out.sort();
}

/** Newest migration version (14-digit prefix) whose non-comment SQL changes a cron schedule. */
export function newestScheduleMigration(files: Array<{ name: string; sql: string }>): string | null {
  const re = /cron\s*\.\s*(schedule|alter_job|unschedule)\s*\(/i;
  const hits = files
    .filter((f) => re.test(f.sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')))
    .map((f) => f.name.slice(0, 14))
    .filter((v) => /^\d{14}$/.test(v))
    .sort();
  return hits.length ? hits[hits.length - 1] : null;
}
