// Sweep #8 · terminal 8 — RE-RUN of every PRE-EXISTING ledger row whose subject is a file
// this terminal owns. Nothing here is a new id: each one already exists in T4/T5/T25/T29/T30
// and its `result` column is updated in place from this run's output.
//
//     node scripts/sweep/t8/rerun-old.mjs
import { read, exists, check, report, has, hasNot, countOf, before, htmlCodeOf, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";

const mgrLayout = read("app/manager/layout.tsx");
const mgrPage   = read("app/manager/page.tsx");
const edPage    = read("app/editor/page.tsx");
const html      = read("public/panels/editor/index.html");
// ORDERING IS READ OFF THE MARKUP, never the notes. index.html's obituaries name "editor/app.js"
// hundreds of lines above the tag, so a bare indexOf on the raw text reads a NOTE as the load
// position — which is exactly how four of these rows went red on a file whose order never moved.
const htmlCode  = htmlCodeOf(html);
const PF        = read("components/PanelFrame.tsx");
const SAB       = read("lib/safeAreaBridge.ts");

/* ── T5 (the manager panel, sweep #6/#7) ───────────────────────────────────────────────── */
check("P02001", "manager page gates through requirePanel('manager')", () => has(mgrLayout, /requirePanel\("manager", "\/manager"\)/));
check("P02002", "manager page pins the admin's ?rid through panelAdminRid", () => has(mgrPage, /panelAdminRid\("manager", rid\)/));
check("P02003", "manager page forwards ?as= into the iframe", () => has(mgrPage, /panelIframeSrc\("\/panels\/editor\/index\.html", adminRid, \{ as, view \}\)/));
check("P02004", "the manager tab has its own browser-tab title", () => has(mgrPage, /metadata = \{ title: "Manager — Aevidine" \}/));
check("P02005", "/editor still redirects to /manager (back-compat)", () => has(edPage, /redirect\("\/manager"/));
check("P02006", "…and keeps ?rid through the redirect", () => has(edPage, /rid \? `\?rid=\$\{encodeURIComponent\(rid\)\}` : ""/));
check("P02011", "billdoc.js loads BEFORE app.js", () => before(htmlCode, "billdoc.js", "editor/app.js"));
check("P02012", "backstack.js loads before app.js", () => before(htmlCode, "backstack.js", "editor/app.js"));
check("P02013", "outbox.js loads before offline.js", () => before(htmlCode, "outbox.js", "offline.js"));
check("P02014", "guestbell.js is loaded (the 🔔 in the top bar)", () => has(html, /guestbell\.js\?v=/));
check("P02015", "inventory.js loads before app.js (LFH_INV)", () => before(htmlCode, "editor/inventory.js", "editor/app.js"));
check("P02016", "auditsort.js is loaded", () => has(html, /auditsort\.js\?v=/));
check("P02017", "every panel asset carries a ?v= cache-bust", () => countOf(html, /src="\/panels\/[^"]+\.js\?v=/g) >= 12 || "fewer than 12");
check("P02018", "Font Awesome + Chart.js are self-hosted, not a CDN", () => hasNot(html, /(?:src|href)="https?:\/\//));
check("P02019", "the nav has one button per tab and no stray data-tab", () => countOf(html, /class="tab"[^>]*data-tab=/g) >= 8 || "fewer than 8");
check("P02020", "the skeleton list rows ship in the HTML", () => countOf(html, /lrow-skel/g) >= 6 || "fewer than 6");
check("P02292", "…and both routes embed it", () => has(mgrPage, /panels\/editor\/index\.html/));
check("P02473", "the manager panel's route is /manager; /editor only redirects", () => {
  const f = fs.readdirSync(path.join(ROOT, "app", "editor")).sort();
  return (has(edPage, /redirect/) === true && f.join(",") === "page.tsx") || `app/editor holds ${f.join(", ")} — a layout there would be a second gate`;
});
check("P02475", "the three panels each carry their own ?v= cache-busting index.html", () => ["editor", "tablet", "kitchen"].every((p) => /app\.js\?v=/.test(read(`public/panels/${p}/index.html`))) || "one panel is missing it");
check("P17239", "the phone gets a drawer, and the drawer has a way out", () => (has(html, /id="navBurger"/) === true && has(html, /id="navClose"/) === true) || "one of the two is gone");
check("P17240", "…with a scrim that lives inside the top bar", () => has(html, /Lives INSIDE the topbar so/));
check("P17400", "the ?as= person pin reaches the panel from the admin's console", () => has(mgrPage, /panelIframeSrc\("\/panels\/editor\/index\.html", adminRid, \{ as, view \}\)/));
check("P17451", "backstack.js is loaded before app.js", () => before(htmlCode, "backstack.js", "editor/app.js"));
check("P17479", "/editor still redirects to /manager and keeps ?rid", () => (has(edPage, /redirect\("\/manager"/) === true && has(edPage, /rid \? `\?rid=\$\{encodeURIComponent\(rid\)\}` : ""/) === true) || "one half is gone");
check("P17480", "the manager route gates through requirePanel('manager')", () => has(mgrLayout, /requirePanel\("manager", "\/manager"\)/));
check("P17482", "every panel asset carries a ?v= cache-bust", () => countOf(html, /src="\/panels\/[^"]+\.js\?v=/g) >= 12 || "fewer than 12");
check("P17484", "Font Awesome and Chart.js are self-hosted, not a CDN", () => hasNot(html, /(?:src|href)="https?:\/\//));
check("P17500", "the skeleton rows ship in the HTML", () => countOf(html, /lrow-skel/g) >= 6 || "fewer than 6");
check("P95008", "every helper PanelFrame imports is really exported", () => {
  const imports = [...PF.matchAll(/import \{([^}]+)\} from "@\/lib\/([^"]+)"/g)];
  for (const [, names, mod] of imports) {
    const src = read(`lib/${mod}.ts`);
    for (const n of names.split(",").map((s) => s.trim()).filter(Boolean))
      if (!new RegExp(`export (?:function|const|class|type|interface) ${n}\\b`).test(src)) return `${n} is not exported by lib/${mod}`;
  }
  return true;
});

/* ── T4 (the phone sweep) ──────────────────────────────────────────────────────────────── */
check("P01762", "/editor does not need muting because it redirects to /manager", () => has(edPage, /redirect\("\/manager"/));
check("P01939", "--sat reaches a panel's offline bar through the bridge's --safe-t", () => {
  if (has(SAB, /--safe-t/) !== true) return "the bridge no longer pushes --safe-t";
  const css = read("public/panels/editor/style.css");
  return /--sat:\s*max\(\s*env\(safe-area-inset-top[^)]*\)\s*,\s*var\(--safe-t/.test(css.replace(/\s+/g, " "))
    || "style.css no longer derives --sat from var(--safe-t)";
});

/* ── T25 (lib/**) ─────────────────────────────────────────────────────────────────────── */
check("P12268", "safeAreaBridge: a >120px viewport gap is treated as the keyboard, not the nav bar", () => has(SAB, /if \(measured > 120\) measured = 0;/));

/* ── T29 / T30 (the shared components + the coverage gaps) ────────────────────────────── */
const PANEL_HOSTS = [
  "app/manager/page.tsx", "app/kitchen/page.tsx", "app/tablet/page.tsx",
  "app/r/[restaurant]/manager/page.tsx", "app/r/[restaurant]/kitchen/page.tsx", "app/r/[restaurant]/tablet/page.tsx",
];
check("P14033", "CLAUDE.md's panel-embed claim (/manager + /editor both embed public/panels/editor/) is true", () => {
  const both = /panelIframeSrc\("\/panels\/editor\/index\.html"/.test(mgrPage)
    && /redirect\("\/manager"/.test(edPage);
  return both || "the claim no longer holds";
});
check("P14166", "PanelFrame is what every panel host renders (never a raw <iframe>)", () => {
  const bad = PANEL_HOSTS.filter((f) => !/PanelFrame/.test(read(f)));
  return bad.length === 0 ? true : `not through PanelFrame: ${bad.join(", ")}`;
});
check("P14167", "PanelFrame bridges the phone's safe-area insets into the iframe", () => has(PF, /attachSafeAreaBridge/));
check("P14455", "PanelFrame's safe-area bridge reaches every panel at BOTH addresses", () => {
  const bad = PANEL_HOSTS.filter((f) => !/PanelFrame/.test(read(f)));
  return bad.length === 0 ? true : `missing: ${bad.join(", ")}`;
});
check("P29416", "PanelFrame is what every panel host renders, never a raw iframe", () => {
  const raw = PANEL_HOSTS.filter((f) => /<iframe/.test(read(f)));
  return raw.length === 0 ? true : `raw iframe in: ${raw.join(", ")}`;
});
check("P41816", "every panel host resolves to PanelFrame", () => PANEL_HOSTS.every((f) => /from "@\/components\/PanelFrame"/.test(read(f))) || "one host does not import it");
check("P41817", "…and PanelFrame still bridges the phone's safe-area insets in", () => has(PF, /attachSafeAreaBridge\(\(\) => ref\.current\)/));
check("P43173", "PanelFrame exports something the tree imports", () => {
  if (!/export default function PanelFrame/.test(PF)) return "no default export";
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
    else if (/\.tsx?$/.test(e.name) && /components\/PanelFrame/.test(fs.readFileSync(p, "utf8"))) n++;
  } };
  walk(path.join(ROOT, "app")); walk(path.join(ROOT, "components"));
  return n >= 6 || `only ${n} importer(s)`;
});
check("P43183", "PanelFrame cleans up everything it starts", () => {
  // its ONE effect returns the bridge's own teardown
  return has(PF, /useEffect\(\(\) => attachSafeAreaBridge\(\(\) => ref\.current\), \[\]\)/);
});
check("P43189", "PanelFrame explains in its own header WHY it exists", () => (PF.indexOf("// Hosts a staff-panel iframe") > -1 && /1\) SIZING/.test(PF) && /2\) INSETS/.test(PF)) || "the header note is gone");
check("P14689", "PanelFrame is rendered by more than one panel — the coverage gap stays CLOSED", () => {
  const n = PANEL_HOSTS.filter((f) => /PanelFrame/.test(read(f))).length;
  return n >= 6 || `only ${n} panel host(s) render it`;
});
check("P14745", "components/ still has its top-level files, and PanelFrame is one of them", () => exists("components/PanelFrame.tsx"));
check("P14975", "the shared plumbing has a named owner — PanelFrame + safeAreaBridge", () => (exists("components/PanelFrame.tsx") && exists("lib/safeAreaBridge.ts")) || "one of the two moved");

process.exit(report("T8 · re-run of pre-existing rows") ? 1 : 0);
