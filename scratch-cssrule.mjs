import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:390,height:844}});
const cdp = await page.context().newCDPSession(page);
await page.goto(`${base}/r/pizza-palace/menu?table=5`,{waitUntil:'networkidle'});
await page.waitForTimeout(800);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const doc = await cdp.send('DOM.getDocument',{depth:-1});
const q = await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId, selector:'.theme-icon-moon'});
const m = await cdp.send('CSS.getMatchedStylesForNode',{nodeId:q.nodeId});
const rules=[];
for (const r of (m.matchedCSSRules||[])){
  const props=(r.rule.style.cssProperties||[]).filter(p=>p.name==='display');
  if(props.length) rules.push({selector:r.rule.selectorList.text, display:props.map(p=>p.value).join(','), origin:r.rule.origin});
}
console.log('display rules matching .theme-icon-moon (in cascade order):');
rules.forEach(r=>console.log('  ',JSON.stringify(r)));
// also check FontAwesome presence
const faLinks = await page.evaluate(()=>[...document.styleSheets].map(s=>s.href).filter(Boolean).filter(h=>/font.?awesome|fa|kit/i.test(h)));
console.log('FA stylesheets:', faLinks);
await b.close();
