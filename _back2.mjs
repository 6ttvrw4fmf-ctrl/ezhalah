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

const readCard = () => p.evaluate(() => {
  const card = document.querySelector('[data-testid="af-card"]');
  const q = card?.querySelector('[data-testid="af-question-title"]')?.innerText?.trim() ?? null;
  const chipTxt = card?.querySelector('[data-testid="af-count-chip"]')?.innerText ?? null;
  const chip = chipTxt ? parseInt(chipTxt.replace(/[^\d]/g,''),10) : null;
  const opts = [...document.querySelectorAll('[data-testid^="af-option-"]')].map(e=>e.getAttribute('data-testid'));
  return { hasCard: !!card, q, chip, opts };
});
const until = async (pred,ms=25000)=>{const t0=Date.now();let s=await readCard();while(Date.now()-t0<ms){if(pred(s))return s;await p.waitForTimeout(350);s=await readCard();}return s;};

const st = await until(s=>s.hasCard && s.chip!=null);
console.log('\nQ1:', JSON.stringify(st));
await p.click(`[data-testid="${st.opts[0]}"]`);
const afterSelect = await until(s=>s.chip!=null && s.chip!==st.chip);
console.log('afterSelect:', afterSelect.chip, '| q:', afterSelect.q);
await p.click('[data-testid="af-confirm"]');
await p.waitForTimeout(DELAY);
const q2 = await readCard();
console.log('Q2 (after confirm):', JSON.stringify(q2).slice(0,200));
console.log(`\n--- af-back after ${DELAY}ms ---`);
await p.click('[data-testid="af-back"]');
const restored = await until(s=>s.hasCard && s.q===st.q && s.chip!=null, 30000);
console.log('RESTORED:', JSON.stringify(restored));
console.log(restored.q===st.q ? '✓ question restored' : `✗ NOT restored: expected="${st.q}" got="${restored.q}"`);
console.log(restored.chip===afterSelect.chip ? '✓ count restored' : `✗ count wrong: expected=${afterSelect.chip} got=${restored.chip}`);
console.log(JSON.stringify(restored.opts)===JSON.stringify(st.opts) ? '✓ options restored' : `✗ options differ: expected=${JSON.stringify(st.opts)} got=${JSON.stringify(restored.opts)}`);
await b.close();
