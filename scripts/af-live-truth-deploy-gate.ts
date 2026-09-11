// The gate step for af-live-truth-check.yml: decide whether the deploy that triggered this run
// actually SHIPPED a bundle, and emit `shipped=yes|no` for the jobs downstream.
//
// The decision itself lives in scripts/lib/deployShipped.ts and is proven by
// scripts/verify-af-live-truth-gate-reads-shipped-not-conclusion.ts against both real runs.
// This file is only transport: fetch the log, hand it to the predicate, write the output.
//
// Reads job logs (plain text) rather than the run-level logs endpoint, which returns a ZIP.

import { appendFileSync } from 'node:fs';
import { shouldRunLiveCheck } from './lib/deployShipped.ts';

const EVENT = process.env.GATE_EVENT_NAME ?? '';
const RUN_ID = process.env.GATE_DEPLOY_RUN_ID ?? '';
const REPO = process.env.GITHUB_REPOSITORY ?? '';
const TOKEN = process.env.GITHUB_TOKEN ?? '';
// `||`, NOT `??`: an unset/empty Actions variable is '' rather than undefined, and `??` would honour
// it as the API base — every request would then fail against a meaningless URL.
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${TOKEN}`,
  'x-github-api-version': '2022-11-28',
};

/** null on ANY failure — the predicate treats that as "verify anyway", never as "nothing shipped". */
async function readDeployLog(): Promise<string | null> {
  if (!RUN_ID || !REPO || !TOKEN) return null;
  try {
    const jobsRes = await fetch(`${API}/repos/${REPO}/actions/runs/${RUN_ID}/jobs?per_page=100`, { headers });
    if (!jobsRes.ok) return null;
    const jobs = (await jobsRes.json())?.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) return null;

    let combined = '';
    for (const job of jobs) {
      const logRes = await fetch(`${API}/repos/${REPO}/actions/jobs/${job.id}/logs`, { headers, redirect: 'follow' });
      if (!logRes.ok) continue;
      combined += await logRes.text();
    }
    return combined === '' ? null : combined;
  } catch {
    return null;
  }
}

const log = await readDeployLog();
const { run, why } = shouldRunLiveCheck({ eventName: EVENT, log });

console.log(`af-live-truth gate: shipped=${run ? 'yes' : 'no'} — ${why}`);
console.log(`  event=${EVENT} deploy_run=${RUN_ID || '(none)'} log=${log === null ? 'UNREADABLE' : `${log.length} bytes`}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `shipped=${run ? 'yes' : 'no'}\n`);
}
