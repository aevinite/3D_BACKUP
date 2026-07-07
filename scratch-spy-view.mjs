import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();

// ---- #11 spy lock ----
const page=await b.newPage({viewport:{width:390,height:844}});
await page.goto(`${base}/r/pizza-palace/menu?table=5`,{waitUntil:'networkidle'});
await page.waitForTimeout(1000);
const cats = await page.$$eval('.cat-card:not(.cat-skeleton)', els=>els.map(e=>e.querySelector('.cat-name')?.textContent.trim()));
console.log('cats:', JSON.stringify(cats));
async function activeCat(){ return page.$$eval('.cat-card.active .cat-name', e=>e.map(x=>x.textContent.trim())); }
// tap last category (Desserts)
const cards = await page.$$('.cat-card:not(.cat-skeleton)');
await cards[cards.length-1].click();
await page.waitForTimeout(250);
console.log('right after tapping last cat: active=', JSON.stringify(await activeCat()));
await page.waitForTimeout(300);
console.log('~550ms after tap (still in lock): active=', JSON.stringify(await activeCat()));
await page.waitForTimeout(700);
console.log('~1250ms after tap (lock released): active=', JSON.stringify(await activeCat()));
// rapid taps
for (const c of cards){ await c.click(); await page.waitForTimeout(60); }
await page.waitForTimeout(200);
console.log('after rapid taps (last=Desserts): active=', JSON.stringify(await activeCat()));
await page.close();

// ---- #2 3D viewer accent ----
// find a model folder from a menu item
const p=await b.newPage({viewport:{width:1280,height:800}});
for (const [slug,label] of [['french-house','#1 gold'],['pizza-palace','red']]){
  const folder='test-folder';
  const rq = slug==='french-house' ? '' : `&r=${slug}`;
  await p.goto(`${base}/view/${folder}?from=x${rq}`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1500);
  const v=await p.evaluate(()=>({accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()}));
  console.log('VIEWER', slug.padEnd(14), label.padEnd(8), '--accent=', v.accent);
}
await b.close();
