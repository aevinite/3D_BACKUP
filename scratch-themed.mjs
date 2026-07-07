import { chromium } from 'playwright';
const base='http://localhost:4010';
const slugs=['pizza-palace','burger-barn','spice-route','sakura-sushi','taco-fiesta','green-bowl'];
const b=await chromium.launch();
for(const s of slugs){
  const p=await b.newPage({viewport:{width:1280,height:800}});
  await p.goto(`${base}/r/${s}/menu?table=5`,{waitUntil:'networkidle'}); await p.waitForTimeout(800);
  const info=await p.evaluate(()=>({themed:!!document.querySelector('#app.brand-themed'),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),bg:getComputedStyle(document.body).backgroundColor}));
  console.log(s.padEnd(14), JSON.stringify(info));
  await p.close();
}
await b.close();
