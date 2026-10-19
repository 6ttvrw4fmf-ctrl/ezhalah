// CLI shim: which alert issues the routing sweep must walk this run.
// Called by .github/workflows/alert-dispatch.yml.
//
// Exists for the same reason as alert-routing-label.ts: the workflow EXECUTES the rule in
// scripts/lib/alertRouting.ts instead of restating it in bash/jq. The rule this one carries is
// routingWorklist() — see its doc comment for the defect it repairs (the routing sweep's
// `gh issue list` cannot see the issues the same run just filed, so every alert issue was unrouted
// for a full dispatch cycle).
//
//   gh issue list ... --json number,title,labels \
//     | node --experimental-strip-types scripts/alert-routing-worklist.ts <created.jsonl>
//
// stdin  : the `gh issue list` JSON array (what the sweep used to consume directly).
// argv[2]: OPTIONAL path to a JSONL file of {"number":N,"title":"..."} the filing step created
//          this run. A missing or empty file is normal — most runs file nothing — and yields the
//          listing unchanged.
// stdout : one compact JSON object per line, {number, title, routed}, which is exactly the shape
//          the sweep's `while read -r issue` loop already expects.
//
// Fails CLOSED and LOUD on malformed input rather than emitting a shorter worklist: an empty
// worklist and an unparseable one look identical downstream, and the quiet version of this failure
// is an issue that silently never gets an owner — the very thing being fixed.
import { readFileSync } from 'node:fs';
import { routingWorklist, type CreatedIssue, type ListedIssue } from './lib/alertRouting.ts';

function die(msg: string): never {
  console.error(`alert-routing-worklist: ${msg}`);
  process.exit(2);
}

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch (e) {
  die(`could not read the issue listing from stdin: ${(e as Error).message}`);
}

let listed: ListedIssue[];
try {
  const parsed: unknown = JSON.parse(raw.trim() === '' ? '[]' : raw);
  if (!Array.isArray(parsed)) die('the issue listing on stdin is not a JSON array');
  listed = parsed as ListedIssue[];
} catch (e) {
  die(`the issue listing on stdin is not valid JSON: ${(e as Error).message}`);
}

const created: CreatedIssue[] = [];
const createdPath = process.argv[2];
if (createdPath) {
  let text = '';
  try {
    text = readFileSync(createdPath, 'utf8');
  } catch {
    // No file means the filing step created nothing this run — the overwhelmingly common case.
    text = '';
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as { number?: unknown; title?: unknown };
      if (typeof row.number !== 'number' || typeof row.title !== 'string') {
        die(`created-issues line is missing a numeric "number" or string "title": ${line}`);
      }
      created.push({ number: row.number, title: row.title });
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('alert-routing-worklist')) throw e;
      die(`created-issues line is not valid JSON: ${line}`);
    }
  }
}

for (const item of routingWorklist(listed, created)) console.log(JSON.stringify(item));
