import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();
for (const vp of [{w:390,h:844,n:'mob'},{w:1280,h:800,n:'desk'}]) {
  const page=await b.newPage({viewport:{width:vp.w,height:vp.h}});
  await page.goto(`${base}/r/pizza-palace/menu?table=5`,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>localStorage.setItem('lfh_language','ar'));
  await page.reload({waitUntil:'networkidle'});
  await page.waitForTimeout(1500);
  await page.screenshot({path:`/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/31e57417-3407-44f9-bed5-e8d930de018c/scratchpad/ar-${vp.n}.png`});
  await page.close();
}
await b.close();
console.log('done');
