import { chromium } from 'playwright';
const base = 'http://localhost:4010';
const slugs = ['french-house','pizza-palace','burger-barn','spice-route','sakura-sushi','taco-fiesta','green-bowl'];
const b = await chromium.launch();
for (const slug of slugs) {
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR: '+e.message));
  try {
    await page.goto(`${base}/r/${slug}/menu?table=5`, { waitUntil:'networkidle', timeout:30000 });
    await page.waitForTimeout(1500);
    const vals = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const bodyCs = getComputedStyle(document.body);
      return {
        accent: cs.getPropertyValue('--accent').trim(),
        gold: cs.getPropertyValue('--gold').trim(),
        accentGlow: cs.getPropertyValue('--accent-glow').trim(),
        title: document.title,
        dir: document.documentElement.getAttribute('dir'),
        lang: document.documentElement.getAttribute('lang'),
        dataTheme: document.documentElement.getAttribute('data-theme'),
      };
    });
    console.log(slug.padEnd(14), JSON.stringify(vals), errs.length?('ERRS:'+errs.slice(0,3).join('|')):'');
  } catch(e) {
    console.log(slug.padEnd(14), 'NAV FAIL', e.message);
  }
  await page.close();
}
await b.close();
