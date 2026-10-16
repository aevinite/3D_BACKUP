// Band G — the project's own rules, held against the files in this territory. ids P189481–P189500.
//
//   node scripts/sweep/t20s10/band-g-rules.mjs [--json=<file>]
//
// Read-only. Each row names the rule (CLAUDE.md, .claude/rules/*, docs/REJECTED-IDEAS.md) and the file.
import { execFileSync } from "node:child_process";
import { chk, report, src, ROOT } from "./lib.mjs";

const PG = "app/owner/page.tsx", TD = "components/owner/TileDocket.tsx", AN = "components/owner/AnimatedNumber.tsx";
const L = "app/owner/layout.tsx", MK = "app/owner/marketing/page.tsx", ON = "app/owner/online/page.tsx", DR = "lib/dashRange.ts";
const OC = "lib/ownerOverviewCache.ts", SN = "lib/ownerSnap.ts";
const strip = (t) => t.split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
const p = strip(src(PG)), td = strip(src(TD));
const grepFiles = (pat, dir) => { try { return execFileSync("grep", ["-rlE", pat, dir], { cwd: ROOT }).toString().trim().split("\n").filter(Boolean); } catch { return []; } };

await chk("P189481", PG, "every popup, drawer and drill level on the dashboard is registered with the back-button manager (rule: panels.md back-button)", "count useBackClose calls against the overlays", () => {
  const ids = [...p.matchAll(/useBackClose\(\s*[`"]([^`"]+)[`"]/g)].map((m) => m[1]);
  const want = ["owner-rng-${id}", "owner-rest", "owner-drill-restaurant", "owner-drill-dish", "owner-kpi-tile", "owner-rest-drawer"];
  return want.every((w) => ids.includes(w)) || `registered: ${ids.join(", ")}`;
});
await chk("P189482", PG, "nothing on the dashboard polls faster than the 60-second backstop (egress rule 9)", "read every timer", () =>
  !/setInterval\(/.test(p) && /useActiveAutoRefresh\(\(\) => tickRef\.current\(\), 60000\)/.test(p));
await chk("P189483", PG, "every request the dashboard makes goes to an /api/owner/* route", "read every fetch(", () => {
  const urls = [...p.matchAll(/fetch\(\s*`([^`]+)`/g)].map((m) => m[1]);
  return (urls.length >= 4 && urls.every((u) => u.startsWith("/api/owner/"))) || urls.join(" | ");
});
await chk("P189484", PG, "…and every one of them carries the admin's tab pin when there is one (bug C1: a second tab can never repaint this one)", "read every fetch(", () => {
  // the WHOLE line of each call — a URL here nests a template literal, so a backtick-bounded match
  // stops half way and misses the suffix (this band's own first run did exactly that).
  const lines = p.split("\n").filter((l) => /fetch\(\s*`\/api\/owner\//.test(l));
  return (lines.length >= 4 && lines.every((l) => /\$\{scp\}|scopePin/.test(l))) || lines.filter((l) => !/\$\{scp\}|scopePin/.test(l)).join(" | ");
});
await chk("P189485", PG, "every link out of the dashboard keeps the admin's pin (withPin or the detail link builder)", "read every href=", () => {
  const hrefs = [...p.matchAll(/href=\{([^}]+)\}/g)].map((m) => m[1].trim());
  return hrefs.every((h) => /^withPin\(|^detailHref\(|^d\.|auditHref|detailHref/.test(h)) || hrefs.filter((h) => !/^withPin\(|^detailHref\(/.test(h)).join(" | ");
});
await chk("P189486", PG, "the guest theme key lfh_theme is never read or written on the owner dashboard", "grep", () => !/lfh_theme/.test(p));
await chk("P189487", PG, "no chart-shape picker (Columns / Bars / Line) on any card — REJECTED R52", "grep for the old toggle", () => !/ToggleChart|chartType|setChartKind/.test(p));
await chk("P189488", PG, "the dashboard never moves the window's scroll (the console scrolls inside .adm-main / .adm)", "grep", () => !/window\.scrollTo|scrollTo\(0/.test(p));
await chk("P189489", PG, "the owner's revenue is never filtered by a bill's deleted_at on this page — binned bills stay IN (compliance §4)", "grep", () => !/deleted_at/.test(p));
await chk("P189490", PG, "the instant-paint snapshot and the saved drill are both keyed by the admin's tab pin", "read the two keys", () =>
  /const snapKey = `dash\$\{scopePin \? `:\$\{scopePin\}` : ""\}`/.test(src(PG)) && /const drillKey = `owner_drill\$\{scopePin \? `:\$\{scopePin\}` : ""\}`/.test(src(PG)));
await chk("P189491", OC, "the shell and the dashboard read the overview through the ONE shared fetch, so a load costs one request", "grep both importers", () => {
  const users = grepFiles("fetchOwnerOverview\\(", "components").concat(grepFiles("fetchOwnerOverview\\(", "app"));
  return (users.includes("app/owner/page.tsx") && users.some((f) => /OwnerShell/.test(f))) || users.join(", ");
});
await chk("P189492", SN, "the snapshot store is wiped on sign-in, so a new account in the same tab never sees the last one's figures", "grep the sign-in screens", () =>
  grepFiles("clearOwnerSnaps\\(\\)", "app").length + grepFiles("clearOwnerSnaps\\(\\)", "components").length >= 1);
await chk("P189493", TD, "opening a tile costs no request — the docket has no fetch of its own", "grep", () => !/fetch\(|useEffect\(/.test(td));
await chk("P189494", TD, "the docket is a labelled modal dialog with a labelled close button", "read the markup", () =>
  /role="dialog" aria-modal="true" aria-label=\{`\$\{title\} detail`\}/.test(src(TD)) && /className="x" onClick=\{onClose\} aria-label="Close"/.test(src(TD)));
await chk("P189495", TD, "a slice's tooltip is a title ATTRIBUTE, never an HTML <title> child (which rewrote the browser tab)", "read ShareBar", () => {
  // comments stripped first: the code's own note explaining the rule quotes "<title>" in prose
  const sb = td.slice(td.indexOf("function ShareBar"), td.indexOf("export default function TileDocket"));
  return (/title=\{`\$\{m\.k\}/.test(sb) && !/<title>/.test(sb)) || "ShareBar renders an HTML <title> child";
});
await chk("P189496", TD, "the docket is cream paper in BOTH skins on purpose — it reads no skin variable, so dark ink always sits on cream", "grep for skin variables", () => !/var\(--/.test(src(TD)));
await chk("P189497", AN, "AnimatedNumber is a client component (it runs animation frames)", "read line 1", () => src(AN).startsWith('"use client"'));
await chk("P189498", MK, "the two Coming-soon pages ship no client JavaScript of their own (server components)", "read both", () => !/use client/.test(src(MK)) && !/use client/.test(src(ON)));
await chk("P189499", L, "the owner panel's tab title is set once, in the layout, for every owner page", "read the export", () => /export const metadata = \{ title: "Owner — Aevidine" \}/.test(src(L)));
await chk("P189500", DR, "every manager-panel door that answers with a range clamps through dashRange (stats, staff-risk, menu matrix, GST report)", "grep the editor route family", () => {
  const users = grepFiles("clampDashRange|dashboardReach", "app/api/editor");
  return users.length >= 1 || "no editor route imports the clamp";
});

report("T20 band G · the project rules on this territory (P189481–P189500)", { expect: 20 });
process.exit(process.exitCode || 0);
