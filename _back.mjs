import { chromium } from 'playwright';
const DELAY = Number(process.argv[2] || 1200);
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--no-sandbox','--ssl-version-max=tls1.2',`--proxy-server=${process.env.HTTPS_PROXY}`,'--ignore-certificate-errors'] });
const p = await (await b.newContext({viewport:{width:1280,height:950},locale:'ar-SA'})).newPage();
await p.goto('https://ezhalah-app.vercel.app/',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
await p.locator('div:text-is("الوكيل الذكي")').first().click(); await p.waitForTimeout(2500);
const send=async(msg,until)=>{const box=p.locator('textarea').last();await box.click();await box.fill(msg);await p.keyboard.press('Enter');
  for(let i=0;i<80;i++){await p.waitForTimeout(2000);const t=await p.evaluate(()=>document.body.innerText);if(until(t))return t;}return await p.evaluate(()=>document.body.innerText);};
let t=await send('أبغى شقة للشراء في الرياض',x=>x.includes('تقصد')||x.includes('لقينا'));
if(t.includes('تقصد')) t=await send('المدينة كاملة',x=>x.includes('لقينا'));
console.log('base headline:', t.match(/لقينا\s*([\d,]+)/)?.[1]);
for(let i=0;i<8;i++){await p.mouse.wheel(0,3000);await p.waitForTimeout(900);}
await p.waitForTimeout(3500);
await p.locator('text=/نحدد الطلب/').first().click();

const card = async () => p.evaluate(()=>{
  const q=document.querySelector('[data-testid="af-question"]');
  const chip=document.querySelector('[data-testid="af-count-chip"]');
  const opts=[...document.querySelectorAll('[data-testid^="af-option-"]')].map(e=>e.getAttribute('data-testid'));
  return { hasCard: !!document.querySelector('[data-testid="af-confirm"]'), q:q?q.textContent.trim():null, chip:chip?chip.textContent.trim():null, opts };
});
const until = async (pred,ms=25000)=>{const t0=Date.now();let s;while(Date.now()-t0<ms){s=await card();if(pred(s))return s;await p.waitForTimeout(700);}return s;};

const q1 = await until(s=>s.hasCard && s.opts.length>0);
console.log('\nQ1:', JSON.stringify(q1).slice(0,260));
await p.click(`[data-testid="${q1.opts[0]}"]`);
const sel = await until(s=>s.chip!=null);
console.log('after select chip:', sel.chip);
await p.click('[data-testid="af-confirm"]');
await p.waitForTimeout(DELAY);
console.log(`\n--- clicking af-back after ${DELAY}ms ---`);
await p.click('[data-testid="af-back"]');
const restored = await until(s=>s.hasCard && s.q===q1.q && s.chip!=null, 30000);
console.log('RESTORED:', JSON.stringify(restored).slice(0,300));
console.log(restored.q===q1.q ? '✓ Back restored the question' : `✗ Back did NOT restore (expected="${q1.q}" got="${restored.q}")`);
await b.close();
