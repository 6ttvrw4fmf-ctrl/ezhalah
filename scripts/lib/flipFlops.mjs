// A CHECK THAT GOES RED AND GREEN ON THE SAME CODE WITHIN A SHORT WINDOW IS CRYING WOLF (2026-11-06, owner «test
// every alarm»). Its verdict is not about the code it ran on. Measured over 7 days on 2026-11-06: lifecycle-spot-check
// flipped 11 times on unchanged main (41 of 62 runs red). Pure: callers pass the runs.
/** Count adjacent runs of ONE workflow on the SAME head_sha whose verdicts differ within `windowMs`. */
export function flipFlops(runs, windowMs = 2 * 3600e3) {
  const bySha = new Map();
  for (const r of runs) {
    if (r.conclusion !== 'success' && r.conclusion !== 'failure') continue;
    const a = bySha.get(r.head_sha) ?? [];
    a.push(r);
    bySha.set(r.head_sha, a);
  }
  let flips = 0;
  for (const rs of bySha.values()) {
    rs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 1; i < rs.length; i++) {
      if (rs[i].conclusion !== rs[i - 1].conclusion && new Date(rs[i].created_at) - new Date(rs[i - 1].created_at) < windowMs) flips++;
    }
  }
  return flips;
}

/** A workflow whose manual dispatch takes inputs (a platform, a sample size…) runs a DIFFERENT check each time, so two of
 *  its dispatches on one commit may legitimately disagree — lifecycle-spot-check run for sakani, then for another site,
 *  read as 11 «flips» on 2026-11-06. For such a workflow only its scheduled runs are comparable. */
export function dispatchTakesInputs(yaml) {
  // the indented lines right under `workflow_dispatch:` — its own block, nothing after it
  const block = /^[ \t]*workflow_dispatch:[^\n]*\n((?:[ \t]{4,}[^\n]*\n?)*)/m.exec(yaml);
  return !!block && /^[ \t]+inputs:\s*$/m.test(block[1]);
}
/** The runs whose verdicts are comparable for flip counting. */
export function comparableRuns(runs, takesInputs) {
  return runs.filter((r) => r.event === 'schedule' || (r.event === 'workflow_dispatch' && !takesInputs));
}
