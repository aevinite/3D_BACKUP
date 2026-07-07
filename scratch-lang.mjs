import { chromium } from 'playwright';
const base = 'http://localhost:4010';
const langs = ['en','de','fr','ar','hi','ko'];
const b = await chromium.launch();
for (const lang of langs) {
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(`${base}/r/pizza-palace/menu?table=5`, { waitUntil:'domcontentloaded' });
  await page.evaluate(l => localStorage.setItem('lfh_language', l), lang);
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.filter-chip')].map(c=>c.textContent.trim());
    const cats = [...document.querySelectorAll('.cat-card .cat-name')].map(c=>c.textContent.trim());
    // check overflow: any filter-chip wider than viewport?
    const overflow = [...document.querySelectorAll('.filter-chip')].some(c=>c.getBoundingClientRect().width>380);
    return { dir: document.documentElement.getAttribute('dir'), lang: document.documentElement.getAttribute('lang'),
      chips, catsCount: cats.length, cats: cats.slice(0,4), overflow,
      bodyScrollW: document.body.scrollWidth, winW: window.innerWidth };
  });
  const blank = info.chips.some(c=>!c || c==='undefined' || /undefined/i.test(c));
  console.log(lang, 'dir='+info.dir, 'blankChip='+blank, 'overflowChip='+info.overflow, 'hScroll='+(info.bodyScrollW>info.winW)+`(${info.bodyScrollW}>${info.winW})`, 'chips='+JSON.stringify(info.chips), errs.length?('ERR:'+errs[0]):'');
  await page.close();
}
await b.close();
