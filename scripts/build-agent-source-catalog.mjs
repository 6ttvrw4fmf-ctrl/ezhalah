import {readFileSync,writeFileSync} from 'node:fs';
export function buildAgentSourceCatalog() {
  const coverage=JSON.parse(readFileSync('src/data/platformPickerCoverage.json','utf8'));
  const catalog=Object.fromEntries(Object.entries(coverage.platforms).map(([name,p])=>[name,p.slugs]));
  // Reuse the existing approved aliases; do not maintain another handwritten mapping.
  const client=readFileSync('src/data/agent.ts','utf8');
  const array=client.match(/const PLATFORM_PATTERNS: Array<\[RegExp, string\]> = (\[[\s\S]*?\n\]);/)?.[1];
  if(!array) throw Error('Platform alias declaration changed');
  const patterns=Function(`return (${array})`)();
  const line=readFileSync('supabase/functions/agent/index.ts','utf8').split('\n').find(l=>l.startsWith('RECOGNIZED PLATFORM NAMES'));
  if(!line) throw Error('Approved source names missing');
  for(const match of line.slice(line.indexOf('): ')+3).matchAll(/([^,]+?) \(([^)]+)\)/g)) {
    const name=match[1].trim(), ar=match[2];
    const slugs=name==='Aqar'?catalog.Aqar:[...new Set(patterns.filter(([re])=>re.test(name)||re.test(ar)).flatMap(([,slug])=>Object.values(catalog).find(ss=>ss.includes(slug))??[slug]))];
    if(slugs.length){catalog[name]=slugs;catalog[ar]=slugs;}
  }
  return catalog;
}
if(process.argv[1]?.endsWith('build-agent-source-catalog.mjs')) writeFileSync('supabase/functions/agent/searchSources.json',JSON.stringify(buildAgentSourceCatalog(),null,2)+'\n');
