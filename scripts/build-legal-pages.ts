// Writes public/privacy.html and public/terms.html from src/data/legal*.ts (see scripts/lib/legalPages.ts).
//   node --experimental-strip-types scripts/build-legal-pages.ts
// Run it after editing the legal text; verify-legal-pages-match-source.ts goes red until you do.
import { writeFileSync } from 'node:fs';
import { loadLegalDocs, renderLegalPage, OUTPUT, type LegalKind } from './lib/legalPages.ts';

const docs = loadLegalDocs();
for (const kind of ['privacy', 'terms'] as LegalKind[]) {
  writeFileSync(OUTPUT[kind], renderLegalPage(kind, docs));
  console.log(`wrote ${OUTPUT[kind]}`);
}
