import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1280,height:800}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text());});
await p.goto(`${base}/view/Croissant?from=avocado-and-cream-cheese&r=pizza-palace&cat=pizzas`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(2500);
const info=await p.evaluate(()=>{
  const styles=[...document.querySelectorAll('style')].map(s=>s.textContent).filter(t=>t.includes('--accent'));
  return {
    accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    hasViewer: !!document.querySelector('.viewer-wrapper'),
    injectedAccentStyles: styles.map(s=>s.slice(0,80)),
    backHref: document.querySelector('a.try-again-btn, .viewer-back, a[href*="/item/"], a[href*="/menu"]')?.getAttribute('href')||null,
    bodyText: document.body.innerText.slice(0,120)
  };
});
console.log(JSON.stringify(info,null,1));
console.log('errs:', errs.slice(0,5));
await b.close();
