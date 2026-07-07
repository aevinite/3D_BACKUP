import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();
// french-house light theme icon double?
const p1=await b.newPage({viewport:{width:390,height:844}});
await p1.goto(`${base}/menu`,{waitUntil:'networkidle'}); await p1.waitForTimeout(800);
const fh=await p1.evaluate(()=>{const vis=el=>el&&getComputedStyle(el).display!=='none';return{theme:document.documentElement.getAttribute('data-theme'),sun:vis(document.querySelector('.theme-icon-sun')),moon:vis(document.querySelector('.theme-icon-moon'))};});
console.log('french-house LIGHT theme-icon:', JSON.stringify(fh), '<- both true = doubled bug');
await p1.close();
// french-house Arabic hero
const p2=await b.newPage({viewport:{width:390,height:844}});
await p2.goto(`${base}/menu`,{waitUntil:'domcontentloaded'});
await p2.evaluate(()=>localStorage.setItem('lfh_language','ar'));
await p2.reload({waitUntil:'networkidle'}); await p2.waitForTimeout(1500);
const hero=await p2.evaluate(()=>({greet:document.querySelector('.greet-badge')?.textContent,title:document.querySelector('.hero-title')?.textContent,dir:document.documentElement.getAttribute('dir')}));
console.log('french-house Arabic hero:', JSON.stringify(hero));
await p2.screenshot({path:'/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/31e57417-3407-44f9-bed5-e8d930de018c/scratchpad/fh-ar.png'});
await b.close();
