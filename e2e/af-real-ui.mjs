import { chromium } from '@playwright/test';
import fs from 'fs';
const BASE='https://ezhalah-app.vercel.app';
const OUT='/private/tmp/claude-501/-Users-yusufalnashwan-Downloads-design-handoff-ezhalah/7f08fd23-e882-4446-af5f-c7a236d4f9f7/scratchpad/e2e-harness/results.jsonl';
const EXPECT={'شقة':['شقة','مبنى شقق مخدومة','ملحق علوي'],'دور':['دور'],'عمارة سكنية':['عمارة','مجمع سكني','مجمع','برج','مبنى'],'غرفة':['غرفة'],'استوديو':['استوديو','ستوديو','شقَّة صغيرة (استوديو)'],'فيلا':['فيلا','تاون هاوس','بيت','قصر'],'استراحة':['استراحة'],'مزرعة':['مزرعة'],'أرض زراعية':['أرض زراعية'],'أرض سكنية':['أرض سكنية','أرض','حوش'],'مكتب':['مكتب','مكاتب مشتركة'],'محل':['محل','كشك','درايف ثرو'],'معرض':['معرض'],'مستودع':['مستودع','مخازن سحابية'],'ورشة':['ورشة'],'مبنى تجاري':['مبنى تجاري','عمارة','صالة','سينما'],'فندق':['فندق'],'محطة وقود':['محطة وقود','محطة','محطة بنزين'],'أرض تجارية':['أرض تجارية'],'أرض صناعية':['أرض صناعية']};

async function runCohort(browser, c, viewport){
  const page=await browser.newPage({viewport});
  const reqs=[]; const resp={};
  page.on('request',r=>{const u=r.url();if(u.includes('/rest/v1/rpc/')){try{reqs.push({fn:u.split('/rpc/')[1].split('?')[0],body:JSON.parse(r.postData()||'{}')});}catch{}}});
  page.on('response',async r=>{const u=r.url();if(u.includes('/rest/v1/rpc/af_eligible_count')){try{resp.af=await r.json();}catch{}}});
  const T=(t)=>page.getByText(t,{exact:true}).first();
  const out={cohort:c.label,device:viewport.width<500?'mobile':'desktop',select_ok:true,notes:[],interview:'not-reached'};
  try{
    await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:60000}); await page.waitForTimeout(2500);
    if(c.deal==='rent'){await T('إيجار').click({timeout:15000});await page.waitForTimeout(600);await T(c.period==='monthly'?'شهري':'سنوي').click({timeout:15000});await page.waitForTimeout(400);}
    if(c.category==='Commercial'){await T('تجاري').click({timeout:15000});await page.waitForTimeout(500);}
    const city=page.locator('[data-testid="city-input"]');await city.click();await city.fill(c.city);await page.waitForTimeout(1600);
    await page.getByText(new RegExp('^'+c.city+'$')).nth(1).click({timeout:8000}).catch(()=>page.getByText(c.city).last().click());
    await page.waitForTimeout(700);
    await T(c.group).click({timeout:15000});await page.waitForTimeout(500);
    await T(c.typeChip).click({timeout:15000});await page.waitForTimeout(500);
    await T('بحث').click({timeout:15000});
    await page.waitForFunction(()=>document.body.innerText.includes('لقينا')||document.body.innerText.includes('الرجاء'),{timeout:90000}).catch(()=>{});
    await page.waitForTimeout(1500);
    const l=reqs.filter(r=>r.fn==='location_search_candidates_ar').at(-1);
    if(!l){out.select_ok=false;out.notes.push('no search request');await page.close();return out;}
    const b=l.body,exp=EXPECT[c.typeChip]||[],at=b.p_types||[],dealAr=c.deal==='rent'?'إيجار':'بيع';
    if(b.p_deal!==dealAr){out.select_ok=false;out.notes.push('deal '+b.p_deal);}
    if(b.p_category!==c.category){out.select_ok=false;out.notes.push('cat '+b.p_category);}
    if(!(b.p_cities||[]).includes(c.city)){out.select_ok=false;out.notes.push('city '+JSON.stringify(b.p_cities));}
    if(!at.length){out.select_ok=false;out.notes.push('p_types EMPTY(group-leak)');}
    const foreign=at.filter(t=>!exp.includes(t));
    if(foreign.length){out.select_ok=false;out.notes.push('FOREIGN(group-leak):'+JSON.stringify(foreign));}
    if(c.deal==='rent'&&!(c.period==='monthly'?b.p_rent_period==='شهري':(b.p_rent_period==='سنوي'||b.p_rent_period==null))){out.select_ok=false;out.notes.push('period '+b.p_rent_period);}
    out.sent={p_deal:b.p_deal,p_types:at,p_category:b.p_category,p_cities:b.p_cities,p_rent_period:b.p_rent_period};
    // INTERVIEW answer-landing (best-effort)
    const start=page.getByText('يلا نبدأ',{exact:true}).first();
    if(await start.count()>0){
      await start.click({timeout:8000}); await page.waitForTimeout(4000);
      // read first question title + first option's count, click it, read new header total
      const q=await page.evaluate(()=>{const b=document.body.innerText;const i=b.indexOf('إزهله بالذكاء الصناعي');const seg=b.slice(i,i+300);const qm=seg.match(/\n([^\n]*؟)\n/);const nums=[...seg.matchAll(/([\d,]{2,})/g)].map(m=>m[1]);return {q:qm?qm[1]:null, firstChip:nums[1]||null};});
      out.interview={question:q.q,firstChip:q.firstChip};
      // click first option (the first row after the title) via the count text
      if(q.firstChip){
        await page.getByText(q.firstChip,{exact:true}).first().click({timeout:6000}).catch(()=>{});
        await page.waitForTimeout(3500);
        const landed=await page.evaluate(()=>{const b=document.body.innerText;const m=b.match(/([\d,]+)\s*نتيجة/);return m?m[1]:null;});
        const afv=resp.af!=null?String(resp.af):null;
        out.interview.landed=landed; out.interview.af=afv;
        const norm=s=>s?s.replace(/,/g,''):s;
        out.interview.land_ok = (norm(landed)===norm(q.firstChip));
      }
    } else {
      out.interview='thin/no-interview';
    }
  }catch(e){out.select_ok=false;out.notes.push('EXC:'+(e.message||'').slice(0,60));}
  await page.close();
  fs.appendFileSync(OUT, JSON.stringify(out)+'\n');
  return out;
}

const C=[
 // Residential
 {label:'Apartment/Buy',group:'الشقق والسكن المشترك',typeChip:'شقة',deal:'buy',category:'Residential',city:'الرياض'},
 {label:'Apartment/Rent',group:'الشقق والسكن المشترك',typeChip:'شقة',deal:'rent',period:'annual',category:'Residential',city:'جدة'},
 {label:'Floor/Buy',group:'الشقق والسكن المشترك',typeChip:'دور',deal:'buy',category:'Residential',city:'الرياض'},
 {label:'Floor/Rent',group:'الشقق والسكن المشترك',typeChip:'دور',deal:'rent',period:'annual',category:'Residential',city:'الرياض'},
 {label:'ResBldg/Buy',group:'الشقق والسكن المشترك',typeChip:'عمارة سكنية',deal:'buy',category:'Residential',city:'جدة'},
 {label:'ResBldg/Rent',group:'الشقق والسكن المشترك',typeChip:'عمارة سكنية',deal:'rent',period:'annual',category:'Residential',city:'الرياض'},
 {label:'Room/Rent',group:'الشقق والسكن المشترك',typeChip:'غرفة',deal:'rent',period:'annual',category:'Residential',city:'الرياض'},
 {label:'Studio/Rent',group:'الشقق والسكن المشترك',typeChip:'استوديو',deal:'rent',period:'annual',category:'Residential',city:'الرياض'},
 {label:'Villa/Buy',group:'الفلل والبيوت',typeChip:'فيلا',deal:'buy',category:'Residential',city:'الرياض'},
 {label:'Villa/Rent',group:'الفلل والبيوت',typeChip:'فيلا',deal:'rent',period:'annual',category:'Residential',city:'الرياض'},
 {label:'RestHouse/Buy',group:'الاستراحات والريف',typeChip:'استراحة',deal:'buy',category:'Residential',city:'جدة'},
 {label:'RestHouse/Rent',group:'الاستراحات والريف',typeChip:'استراحة',deal:'rent',period:'annual',category:'Residential',city:'الرياض'},
 {label:'Farm/Buy',group:'الاستراحات والريف',typeChip:'مزرعة',deal:'buy',category:'Residential',city:'الرياض'},
 {label:'AgriPlot/Buy',group:'الاستراحات والريف',typeChip:'أرض زراعية',deal:'buy',category:'Residential',city:'الرياض'},
 {label:'ResLand/Buy',group:'الأراضي السكنية',typeChip:'أرض سكنية',deal:'buy',category:'Residential',city:'جدة'},
 {label:'ResLand/Rent',group:'الأراضي السكنية',typeChip:'أرض سكنية',deal:'rent',period:'annual',category:'Residential',city:'الرياض'},
 // Commercial
 {label:'Office/Buy',group:'التجزئة والمكاتب',typeChip:'مكتب',deal:'buy',category:'Commercial',city:'الرياض'},
 {label:'Office/Rent',group:'التجزئة والمكاتب',typeChip:'مكتب',deal:'rent',period:'annual',category:'Commercial',city:'الرياض'},
 {label:'Shop/Buy',group:'التجزئة والمكاتب',typeChip:'محل',deal:'buy',category:'Commercial',city:'الرياض'},
 {label:'Shop/Rent',group:'التجزئة والمكاتب',typeChip:'محل',deal:'rent',period:'annual',category:'Commercial',city:'جدة'},
 {label:'Showroom/Buy',group:'التجزئة والمكاتب',typeChip:'معرض',deal:'buy',category:'Commercial',city:'الرياض'},
 {label:'Showroom/Rent',group:'التجزئة والمكاتب',typeChip:'معرض',deal:'rent',period:'annual',category:'Commercial',city:'الرياض'},
 {label:'Warehouse/Buy',group:'الصناعة واللوجستيات',typeChip:'مستودع',deal:'buy',category:'Commercial',city:'الدمام'},
 {label:'Warehouse/Rent',group:'الصناعة واللوجستيات',typeChip:'مستودع',deal:'rent',period:'annual',category:'Commercial',city:'الرياض'},
 {label:'Workshop/Buy',group:'الصناعة واللوجستيات',typeChip:'ورشة',deal:'buy',category:'Commercial',city:'الرياض'},
 {label:'Workshop/Rent',group:'الصناعة واللوجستيات',typeChip:'ورشة',deal:'rent',period:'annual',category:'Commercial',city:'الرياض'},
 {label:'CommBldg/Buy',group:'المباني والمرافق',typeChip:'مبنى تجاري',deal:'buy',category:'Commercial',city:'الرياض'},
 {label:'CommBldg/Rent',group:'المباني والمرافق',typeChip:'مبنى تجاري',deal:'rent',period:'annual',category:'Commercial',city:'الرياض'},
 {label:'Hotel/Buy',group:'المباني والمرافق',typeChip:'فندق',deal:'buy',category:'Commercial',city:'مكة المكرمة'},
 {label:'GasStation/Buy',group:'المباني والمرافق',typeChip:'محطة وقود',deal:'buy',category:'Commercial',city:'الرياض'},
 {label:'GasStation/Rent',group:'المباني والمرافق',typeChip:'محطة وقود',deal:'rent',period:'annual',category:'Commercial',city:'الرياض'},
 {label:'CommLand/Buy',group:'الأراضي التجارية والصناعية',typeChip:'أرض تجارية',deal:'buy',category:'Commercial',city:'الرياض'},
 {label:'IndLand/Buy',group:'الأراضي التجارية والصناعية',typeChip:'أرض صناعية',deal:'buy',category:'Commercial',city:'الدمام'},
];
try{fs.unlinkSync(OUT);}catch{}
const b=await chromium.launch({headless:true});
// desktop pass: all cohorts
for(const c of C){ await runCohort(b,c,{width:1280,height:900}); }
// mobile pass: representative subset spanning families/categories
const mob=['Apartment/Rent','Villa/Buy','Shop/Rent','CommLand/Buy','RestHouse/Buy','Office/Rent'];
for(const c of C.filter(x=>mob.includes(x.label))){ await runCohort(b,c,{width:390,height:844}); }
await b.close();
fs.appendFileSync(OUT, JSON.stringify({done:true})+'\n');
