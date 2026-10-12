// Bank G — logins, restaurant separation, and nothing personal written down (P183611–P183630).
// §1b of the sweep: answered by READING the code and observing normal use, never by trickery.
import { sec, read, code, imp, NO_DB } from "./lib.mjs";

const g = sec(183610);
const TR = read("app/api/tablet/[...path]/route.ts"), ER = read("app/api/editor/[...path]/route.ts");
g(1, "lib/billCustomer.ts", "both routes that save a bill's customer sign the caller in with requireRole before anything else", "requireRole in the editor + tablet routes", () => /requireRole/.test(ER) && /requireRole/.test(TR) || "a route without requireRole");
g(2, "public/panels/billcustomer.js", "the customer search sends only the digits typed — never a restaurant id; the server takes the restaurant from the login", "the request the sheet builds", () => /api\("GET", "\/customer-search\?q=" \+ encodeURIComponent\(asked\)\)/.test(read("public/panels/billcustomer.js")) && !/restaurant/.test(code(read("public/panels/billcustomer.js"))) || "the sheet sends more than the digits");
g(3, "public/panels/billcustomer.js", "…and the waiter-tablet's search route strips everything but digits and refuses under three", "tablet customer-search", () => { const i = TR.indexOf('path.join("/") === "customer-search"'); const b = TR.slice(i, i + 900); return (/replace\(\/\\D\/g, ""\)/.test(b) && /< 3/.test(b) && /p_restaurant_id: rid/.test(b)) || "unchecked input"; });
g(4, "lib/billCustomer.ts", "a customer's phone number is never written to the server log — only the restaurant and session ids", "every console.error in the file", () => { const logs = [...code(read("lib/billCustomer.ts")).matchAll(/console\.error\(([^;]+)\);/g)].map((m) => m[1]); return (logs.length >= 1 && logs.every((l) => !/phone|name\b/.test(l))) || logs.join(" | "); });
g(5, "public/panels/billdoc.js", "the paper file logs nothing at all (a bill holds a guest's name and number)", "no console.* in billdoc.js", () => !/console\./.test(code(read("public/panels/billdoc.js"))) || "it logs");
g(6, "public/panels/billcustomer.js", "the customer sheet logs nothing", "no console.*", () => !/console\./.test(code(read("public/panels/billcustomer.js"))) || "it logs");
g(7, "lib/printDocs.ts", "the helper's paper builder logs nothing about a guest", "no console.* in printDocs", () => !/console\.(log|error|warn)\([^)]*(phone|cust)/.test(code(read("lib/printDocs.ts"))) || "a guest detail is logged");
g(8, "lib/printDocs.ts", "a printed bill can never carry a server key — run on a real French House bill and checked for the key's text", "billHtmlForSession output vs the service key (compared, never printed)", async () => {
  if (NO_DB) return { skip: "--no-db" };
  const { readFileSync } = await import("node:fs");
  const env = Object.fromEntries(readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  const PD = await imp("lib/printDocs.ts");
  const { sql } = await import("./lib.mjs");
  const s = (await sql("select id from sessions where restaurant_id='00000000-0000-0000-0000-000000000001' and status='closed' and exists (select 1 from orders o where o.session_id=sessions.id and o.deleted_at is null) order by closed_at desc limit 1"))[0];
  const h = await PD.billHtmlForSession("00000000-0000-0000-0000-000000000001", s.id);
  const keys = [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_ACCESS_TOKEN, env.ADMIN_PASSWORD].filter((k) => k && k.length > 8);
  return (keys.length >= 2 && !keys.some((k) => h.includes(k))) || "a secret is on the paper";
});
g(9, "lib/printBoard.ts", "the board never carries a print helper's token — only whether a setup code is live", "AgentView/BoardState read for token fields", () => !/token\s*[:?]/.test(code(read("lib/printBoard.ts"))) || "a token field on the board");
g(10, "lib/printBoardWords.ts", "the words file holds no address, key or id — words only", "scan", () => !/https?:\/\/|[0-9a-f]{8}-[0-9a-f]{4}-|sk_|sbp_/.test(code(read("lib/printBoardWords.ts"))) || "found one");
g(11, "lib/printDocs.ts", "a bill job's paper is chosen by the job's own kind and payload, read back under the helper's restaurant", "the print-agent dispatch", () => /job\.kind === "bill" && payload\.sessionId\) html = await billHtmlForSession\(agent\.restaurant_id, String\(payload\.sessionId\), \{ parcel: !!payload\.parcel \}\)/.test(read("app/api/print-agent/[...path]/route.ts")) || "dispatch changed");
g(12, "docs/NUMBERING.md", "the page never suggests reusing or freeing a number (R44 — gaps are correct, reuse is the fault)", "read the page", () => !/reuse (the|a) number|free (the|a) number|fill the gap/i.test(read("docs/NUMBERING.md").replace(/never reused|not freed|is retired, not freed/gi, "")) || "the page suggests reuse");
g(13, "lib/billPreview.ts", "the preview is reachable only through the admin console (one importer outside lib)", "importers of billPreviewHtml", () => (read("app/api/admin/restaurants/bill-preview/route.ts").includes("billPreviewHtml") && read("components/admin/RestaurantSettings.tsx").length > 0) || "importer changed");
g(14, "public/panels/billdoc.d.ts", "the type file names no runtime secret and exports types only", "no `export const` but TIP_MAX", () => { const c = [...read("public/panels/billdoc.d.ts").matchAll(/export const (\w+)/g)].map((m) => m[1]); return (c.length === 1 && c[0] === "TIP_MAX") || c.join(","); });
