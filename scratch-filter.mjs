import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:390,height:844}});
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto(`${base}/r/pizza-palace/menu?table=5`,{waitUntil:'networkidle'});
await page.waitForTimeout(1200);

const catCount = async ()=> page.$$eval('.cat-card:not(.cat-skeleton)', els=>els.map(e=>e.querySelector('.cat-name')?.textContent.trim()));
console.log('baseline cats:', JSON.stringify(await catCount()));

// #12: toggle Favorites (no favorites hearted) -> should empty categories
const favBtn = await page.$('.filter-chip:has-text("Favorites")');
if (favBtn){ await favBtn.click(); await page.waitForTimeout(600);
  console.log('after Favorites (none hearted): cats=', JSON.stringify(await catCount()));
  const empty = await page.$eval('#main-scroll', el=>el.textContent).catch(()=>'');
  console.log('  favorites empty-state text present:', /favorite|no dishes|empty|hearted/i.test(empty));
  await favBtn.click(); await page.waitForTimeout(600);
  console.log('after Favorites OFF: cats restored=', JSON.stringify(await catCount()));
}
// #12: Veg filter
const vegBtn = await page.$('.filter-chip:has-text("Veg"):not(:has-text("Non"))');
if (vegBtn){ await vegBtn.click(); await page.waitForTimeout(600);
  console.log('after Veg ON: cats=', JSON.stringify(await catCount()));
  // tap a still-visible category
  const cards = await page.$$('.cat-card:not(.cat-skeleton)');
  if (cards.length){ await cards[cards.length-1].click(); await page.waitForTimeout(700);
    console.log('  tapped last visible cat while Veg on; still Veg active=', await page.$eval('.filter-chip:has-text("Veg"):not(:has-text("Non"))', e=>e.classList.contains('active')).catch(()=>'?')); }
  const vb2 = await page.$('.filter-chip:has-text("Veg"):not(:has-text("Non"))');
  await vb2.click(); await page.waitForTimeout(600);
  console.log('after Veg OFF: cats restored=', JSON.stringify(await catCount()));
}
// #13: search hides filter row
await page.fill('#search-input','pizza'); await page.waitForTimeout(600);
console.log('while searching: filter-row present=', !!(await page.$('#sticky-header')), 'cats=', JSON.stringify(await catCount()));
await page.fill('#search-input',''); await page.waitForTimeout(600);
console.log('after clearing search: filter-row present=', !!(await page.$('#sticky-header')), 'cats=', JSON.stringify(await catCount()));
console.log('errs:', errs.slice(0,3));
await b.close();
