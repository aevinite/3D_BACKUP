import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:390,height:844}});
await page.goto(`${base}/r/pizza-palace/menu?table=5`,{waitUntil:'networkidle'});
await page.waitForTimeout(800);
const info = await page.evaluate(()=>{
  const sun=document.querySelector('.theme-icon-sun'), moon=document.querySelector('.theme-icon-moon');
  const r=el=>{const cs=getComputedStyle(el); const rect=el.getBoundingClientRect(); return {display:cs.display, w:rect.width,h:rect.height};};
  return { dataTheme:document.documentElement.getAttribute('data-theme'), sun:r(sun), moon:r(moon) };
});
console.log('LIGHT mode:', JSON.stringify(info));
// screenshot just the theme button
const btn = await page.$('button[title="Toggle Theme"]');
if (btn) await btn.screenshot({path:'/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/31e57417-3407-44f9-bed5-e8d930de018c/scratchpad/themebtn-light.png'});
await b.close();
