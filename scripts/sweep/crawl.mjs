// scripts/sweep/crawl.mjs — coverage crawler for /bug-test sweeps.
//
// Makes "click every single clickable thing" PROVABLE instead of a vibe. Given a
// Playwright frame/page, it enumerates EVERY element a human could click on the
// current screen and returns a stable descriptor + selector for each, so a sweep can:
//   1. know the full clickable inventory of a screen (the denominator),
//   2. click each one and record backend effects (the numerator),
//   3. report an honest coverage % and list exactly what is still un-clicked.
//
// "Clickable" = an interactive tag, an on*-handler attribute, one of the app's own
// click-hook data-* attributes, OR anything the browser renders with cursor:pointer
// (which is how this app wires most tiles/chips/pills). Hidden / zero-size / disabled
// nodes are excluded (you can't click them), and nested clickables are de-duped to the
// outermost so we don't count a button's inner <span> twice.
//
//   import { enumerateClickables, coverageLine } from "./scripts/sweep/crawl.mjs";
//   const clickables = await enumerateClickables(frame);
//   // ... click each by clickables[i].selector, record effect ...
//   console.log(coverageLine(clickables.length, clickedCount));

// The app's known click-hook data-attributes (handlers are attached by these). Extend
// as new ones appear — a data-* hook not in this list is still caught by cursor:pointer.
const DATA_HOOKS = [
  "data-t", "data-quick", "data-qt", "data-filter", "data-dish", "data-dishedit",
  "data-dishminus", "data-add-dish", "data-del-order", "data-order", "data-kotmenu",
  "data-tab", "data-action", "data-nav", "data-cat", "data-layer", "data-back",
];

// Runs in the page. Returns descriptors for every visible, enabled, clickable node,
// de-duped to the outermost clickable ancestor.
function pageEnumerate(dataHooks) {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05;
  };
  const isDisabled = (el) => el.disabled === true || el.getAttribute("aria-disabled") === "true";
  const hookSel = dataHooks.map((h) => `[${h}]`).join(",");
  const clickable = (el) => {
    if (isDisabled(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (["button", "a", "select", "summary"].includes(tag)) return true;
    if (tag === "input" && ["button", "submit", "checkbox", "radio", "file"].includes(el.type)) return true;
    if (el.matches("[role=button],[role=tab],[role=menuitem],[role=switch],[role=link]")) return true;
    for (const a of el.attributes) if (a.name.startsWith("on")) return true; // onclick etc.
    if (hookSel && el.matches(hookSel)) return true;
    if (getComputedStyle(el).cursor === "pointer") return true;
    return false;
  };
  const all = [...document.querySelectorAll("*")].filter((el) => isVisible(el) && clickable(el));
  // De-dupe to the OUTERMOST clickable: drop any node that has a clickable ancestor in the set.
  const set = new Set(all);
  const outermost = all.filter((el) => {
    let p = el.parentElement;
    while (p) { if (set.has(p)) return false; p = p.parentElement; }
    return true;
  });
  // Build a stable-ish descriptor + selector for each.
  const sel = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    for (const h of dataHooks) { const v = el.getAttribute(h); if (v != null) return `[${h}="${CSS.escape(v)}"]`; }
    // fall back to tag + nth-of-type within parent (good enough to re-click in the same render)
    const parent = el.parentElement;
    if (parent) {
      const sib = [...parent.children].filter((c) => c.tagName === el.tagName);
      const idx = sib.indexOf(el) + 1;
      const pid = parent.id ? `#${CSS.escape(parent.id)} > ` : "";
      return `${pid}${el.tagName.toLowerCase()}:nth-of-type(${idx})`;
    }
    return el.tagName.toLowerCase();
  };
  return outermost.map((el) => ({
    selector: sel(el),
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
    aria: el.getAttribute("aria-label") || undefined,
    hook: dataHooks.find((h) => el.hasAttribute(h)) || undefined,
  }));
}

export async function enumerateClickables(frameOrPage) {
  return await frameOrPage.evaluate(pageEnumerate, DATA_HOOKS);
}

export function coverageLine(total, clicked) {
  const pct = total ? Math.round((clicked / total) * 100) : 100;
  return `coverage: ${clicked}/${total} clickable elements (${pct}%)${clicked < total ? ` — ${total - clicked} NOT yet clicked` : " ✅"}`;
}
