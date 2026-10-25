// Execute the real locale selector and modal bodies; mutation proof guards the observed English leaks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { stripTypeScriptTypes } from 'node:module';
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const data = (source: string, name: string) => new Function(stripTypeScriptTypes(source.replace(/^import.*;\n/gm,'').replace(/^export /gm,''))+`;return ${name};`)();
const en = data(read('src/data/legalEnglish.ts'),'LEGAL_DOCS_EN');
const ar = data(read('src/data/legal.ts').split('/** Display translation only:')[0],'LEGAL_DOCS');
const legalSource = read('src/data/legal.ts');
function selector(source: string) {
  const body = source.slice(source.indexOf('export function getLegalDocs('));
  return new Function('LEGAL_DOCS','LEGAL_DOCS_EN',stripTypeScriptTypes(body.replace('export ',''))+';return getLegalDocs;')(ar,en);
}
const pick = selector(legalSource);
assert.equal(pick('en'),en);
assert.equal(pick('ar'),ar);
for (const key of ['terms','privacy']) {
  assert.equal(en[key].length,ar[key].length);
  assert.equal(en[key].length,key==='terms'?17:15);
  // The privacy policy changed 2026-10-21 (Cloudflare Turnstile line, owner-approved); the terms did not.
  assert.equal(en[key][0], key === 'privacy' ? 'Last updated: 21 October 2026' : 'Last updated: 4 September 2026');
  for(let i=1;i<en[key].length;i++) {
    assert(en[key][i].startsWith(`${i}) `));
    assert(en[key][i].includes('\n\n'));
    assert(!/[\u0600-\u06ff]/.test(en[key][i]));
    assert.equal((en[key][i].match(/\{\{CONTACT_EMAIL\}\}/g)||[]).length,(ar[key][i].match(/\{\{CONTACT_EMAIL\}\}/g)||[]).length);
  }
}
assert.match(en.privacy[5],/outside the Kingdom.*Asia Pacific/s);
assert.match(en.privacy[7],/30 days/);
assert.match(en.privacy[8],/SDAIA/);
assert.match(en.terms[15],/does not carry out real estate brokerage activity/);

const modal = read('src/components/InfoModal.tsx');
function render(source: string, locale: 'ar'|'en', component: string, initial='terms') {
  const ast = ts.createSourceFile('modal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const names = ['SupportBody','SupportForm','Field','SupCard','RtRow','LegalBody'];
  const constants = ['IS_WEB','WEB_SMOOTH','BODY_PAD','CLOSE_INSET','CLOSE_SIZE','CLOSE_GAP','CLOSE_CLEAR','TOP_CLEAR','s'];
  const fragments = ast.statements.filter(node => ts.isFunctionDeclaration(node) ? names.includes(node.name?.text??'') : ts.isVariableStatement(node) && node.declarationList.declarations.some(d=>constants.includes(d.name.getText(ast)))).map(node=>node.getText(ast)).join('\n');
  const js = ts.transpileModule(fragments,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children})};
  const useState=(value:any)=>[typeof value==='function'?value():value,()=>{}];
  const ctx={React,useState,useEffect:()=>{},useI18n:()=>({locale,isRTL:locale==='ar'}),useApp:()=>({user:null}),recallSupportDraft:()=>({subject:'',message:'',email:''}),rememberSupportDraft:()=>{},validateSupportMessage:()=>null,SUBJECT_MAX:140,MESSAGE_MAX:5000,Platform:{OS:'web'},I18nManager:{isRTL:false},StyleSheet:{create:(x:any)=>x},colors:{},cardShadow:{},View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',Ionicons:'Icon',RNImage:'Image',XImage:'Image',EAGLE:'eagle',getLegalDocs:pick,hasLegalDocs:()=>true};
  const run=new Function(...Object.keys(ctx),`${js};return ${component};`)(...Object.values(ctx));
  const root=run({t:(key:string)=>key,initial,icon:'business',email:'address',desc:'description',text:'Typical response time: 72 hours.',label:'Subject'});
  const nodes:any[]=[];
  const walk=(node:any)=>{if(!node || typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}if(typeof node.type==='function'){walk(node.type({...node.props,children:node.children}));return;}nodes.push(node);node.children.forEach(walk);};
  walk(root);
  return nodes;
}
const flatten=(style:any):any=>Array.isArray(style)?Object.assign({},...style.map(flatten)):style||{};
function layoutContract(source: string) {
  for(const component of ['SupportBody','SupportForm','Field','SupCard','RtRow','LegalBody']) {
    const nodes=render(source,'en',component);
    const fields=nodes.filter(n=>n.type==='TextInput');
    for(const n of fields) assert.equal(flatten(n.props.style).textAlign,'left',`${component} input`);
    const texts=nodes.filter(n=>n.type==='Text' && ['right','left'].includes(flatten(n.props.style).textAlign));
    assert(texts.length>0);
    for(const n of texts) assert.equal(flatten(n.props.style).textAlign,'left',`${component} text`);
  }
  for(const tab of ['terms','privacy']) {
    const nodes=render(source,'en','LegalBody',tab);
    const text=nodes.filter(n=>n.type==='Text').flatMap(n=>n.children).join(' ');
    assert(!/[\u0600-\u06ff]/.test(text));
    assert(text.includes(tab === 'privacy' ? '21 October 2026' : '4 September 2026'));
    assert(!text.includes('{{CONTACT_EMAIL}}'));
  }
  const arabic=render(source,'ar','RtRow');
  assert.equal(flatten(arabic.find(n=>n.type==='Text').props.style).textAlign,'right');
}
layoutContract(modal);
const mustCatch=(label:string,broken:()=>void)=>{assert.throws(broken,undefined,label);};
mustCatch('English legal selector reverting to Arabic',()=>assert.equal(selector(legalSource.replace("locale === 'en' ? LEGAL_DOCS_EN : LEGAL_DOCS",'LEGAL_DOCS'))('en'),en));
mustCatch('English alignment overrides removed',()=>layoutContract(modal.replaceAll('!isRTL && s.textLtr','false').replaceAll('!isRTL && s.inputLtr','false')));
console.log('PASS complete English legal sections/contact tokens, preserved disclosures, actual Support/legal rendering and English alignment; both regressions caught by mutation.');
