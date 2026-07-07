import { chromium } from 'playwright';
const base='http://localhost:4010';
const b=await chromium.launch();
const page=await b.newPage({viewport:{width:390,height:844}});
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto(`${base}/r/pizza-palace/menu?table=5`,{waitUntil:'networkidle'});
await page.waitForTimeout(1000);
// seed a plain cart line at qty 99
await page.evaluate(()=>{
  const line=[{id:'seed-x',title:'Test Pizza',price:'299.00',image:'',qty:99,sig:'[]'}];
  localStorage.setItem('lfh_cart:pizza-palace', JSON.stringify(line));
  window.dispatchEvent(new CustomEvent('lfh:cart-updated'));
});
await page.waitForTimeout(300);
await page.evaluate(()=>window.dispatchEvent(new CustomEvent('lfh:open-cart')));
await page.waitForTimeout(800);
const bill = await page.evaluate(()=>{
  const lines=[...document.querySelectorAll('.bill-line')].map(l=>l.textContent.trim());
  const qtyEls=[...document.querySelectorAll('.cart-item, .bill-item, [class*="qty"]')].map(e=>e.textContent.trim()).slice(0,6);
  return { lines, qtyEls };
});
console.log('bill lines:', JSON.stringify(bill.lines));
// try clicking + on the cart line (should stay at 99)
const incBtns = await page.$$('button');
// find the qty +
console.log('errs:', errs.slice(0,3));
await page.screenshot({path:'/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/31e57417-3407-44f9-bed5-e8d930de018c/scratchpad/cart99.png'});
await b.close();
