// scripts/sweep/t6s10/probe-ink.mjs — for one tab and skin, print the ink and every background
// behind each low-contrast word, so a contrast red is LOOKED AT before it is believed.
//   node scripts/sweep/t6s10/probe-ink.mjs orders light
import { ev, closeLive } from "./lib.mjs";
const [tab = "orders", skin = "light", view = ""] = process.argv.slice(2);
await ev(`(() => { try { localStorage.setItem('lfh_panel_theme', '${skin}'); } catch {} document.documentElement.setAttribute('data-theme', '${skin}'); return true; })()`);
const r = await ev(`(async () => { ${view ? `state.ordersView = '${view}';` : ""} setTab('${tab}'); await new Promise((f) => setTimeout(f, 3000));
  const els = [...document.querySelectorAll('#editor h2, #editor h3, #editor h4, #editor label, #editor b, #editor small, #editor .muted')].filter((e) => e.offsetParent && e.textContent.trim());
  const out = [];
  for (const e of els) { const chain = []; for (let x = e; x && chain.length < 6; x = x.parentElement) { const cs = getComputedStyle(x); chain.push((x.className || x.tagName).toString().slice(0, 30) + ' bg=' + cs.backgroundColor + (cs.backgroundImage !== 'none' ? ' img' : '') + ' op=' + cs.opacity); }
    out.push({ t: e.textContent.trim().slice(0, 30), cls: (e.className || e.tagName).toString(), color: getComputedStyle(e).color, chain }); }
  return out.filter((x) => /₹798|still owed|bill-owed/.test(x.t + x.cls)).slice(0, 6); })()`);
console.log(JSON.stringify(r, null, 1));
await closeLive();
