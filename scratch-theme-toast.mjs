import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();

// ---- #16 theme toggle icon on pizza-palace ----
const page=await b.newPage({viewport:{width:390,height:844}});
await page.goto(`${base}/r/pizza-palace/menu?table=5`,{waitUntil:'networkidle'});
await page.waitForTimeout(800);
const themeBtn = await page.$('button[aria-label*="mode"], button[title="Toggle Theme"]');
async function iconState(){ return page.evaluate(()=>{
  const sun=document.querySelector('.theme-icon-sun'), moon=document.querySelector('.theme-icon-moon');
  const vis=el=>el&&getComputedStyle(el).display!=='none';
  return { dataTheme: document.documentElement.getAttribute('data-theme'), sunVisible:vis(sun), moonVisible:vis(moon) };
});}
console.log('THEME toggle sequence:');
for (let i=0;i<5;i++){ const s=await iconState(); const ok = (s.dataTheme==='dark'&&s.moonVisible&&!s.sunVisible)||(s.dataTheme!=='dark'&&s.sunVisible&&!s.moonVisible); console.log('  '+i, JSON.stringify(s), 'match='+ok); if(themeBtn) await themeBtn.click(); await page.waitForTimeout(300); }
await page.close();

// ---- #5 toast sign-off ----
for (const slug of ['french-house','pizza-palace']){
  const p=await b.newPage({viewport:{width:390,height:844}});
  const url = slug==='french-house' ? `${base}/menu` : `${base}/r/${slug}/menu?table=5`;
  await p.goto(url,{waitUntil:'networkidle'}); await p.waitForTimeout(800);
  await p.evaluate(()=>window.dispatchEvent(new CustomEvent('lfh:toast',{detail:{message:'Hello',kicker:'test'}})));
  await p.waitForTimeout(400);
  const foot = await p.$eval('.toast-foot', e=>e.textContent.trim()).catch(()=>'NO TOAST');
  console.log('TOAST signoff', slug.padEnd(14), '=>', JSON.stringify(foot));
  await p.close();
}
await b.close();
