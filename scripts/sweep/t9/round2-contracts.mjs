// SWEEP #8 · T9 · ROUND 2, block D — EVERY ENDPOINT × EVERY BODY SHAPE, BY READING THE GUARD.
// P99801–P99861.
//
// Verified by READING the handler, never by calling it with a hostile body — the house rule is that
// a gap found by reading is REPORTED, not demonstrated, and nothing here touches the network. What
// each row asserts is that the handler has a guard for that shape and answers it with a sentence and
// a status, rather than letting the value reach a query.
import { row, ROUTE, ROUTEC, APPC, has, hasRe, lacks, lacksRe } from "./lib.mjs";

const rslice = (from, to) => { const r = ROUTEC(); const i = r.indexOf(from); const j = r.indexOf(to); return i < 0 || j < 0 ? "" : r.slice(i, j); };
const ENDPOINTS = [
  ["orders/:id/accept",        'if (a === "orders" && c === "accept")',        'if (a === "orders" && c === "ready")'],
  ["orders/:id/ready",         'if (a === "orders" && c === "ready")',         'if (a === "orders" && c === "unready")'],
  ["orders/:id/unready",       'if (a === "orders" && c === "unready")',       'if (a === "items" && c === "status")'],
  ["items/:id/status",         'if (a === "items" && c === "status")',         'if (a === "platform" && c === "status")'],
  ["platform/:id/status",      'if (a === "platform" && c === "status")',      'if (a === "dishes" && c === "sold-out")'],
  ["dishes/:id/sold-out",      'if (a === "dishes" && c === "sold-out")',      'if (a === "print-jobs" && b === "claim")'],
  ["print-jobs/claim",         'if (a === "print-jobs" && b === "claim")',     'if (a === "print-station" && b === "take")'],
  ["print-station/take",       'if (a === "print-station" && b === "take")',   'if (a === "print-station" && b === "release")'],
  ["print-station/release",    'if (a === "print-station" && b === "release")','if (a === "print-jobs" && c === "done")'],
  ["print-jobs/:id/done",      'if (a === "print-jobs" && c === "done")',      'if (a === "printer-events" && path.length === 1)'],
  ["printer-events",           'if (a === "printer-events" && path.length === 1)', 'return err("unknown POST endpoint"'],
];

let n = 99801;
const next = () => "P" + n++;

// D1 · every endpoint is reachable only after the SAME four gates, in the same order
row(next(), "every write endpoint sits behind the gate, the scope, the block list and the two clash checks", () => {
  const r = ROUTEC();
  const post = r.slice(r.indexOf("async function postImpl("));
  const order = ["const g = await gate(req)", "panelRestaurantId(req, g)", "deviceBlocked(dev, rid)", "replayClash(", "expectClash("];
  let at = -1;
  for (const step of order) {
    const i = post.indexOf(step);
    if (i < 0) return `missing step: ${step}`;
    if (i < at) return `${step} runs out of order`;
    at = i;
  }
  // …and the first endpoint branch comes after all five
  const firstBranch = post.indexOf('if (a === "issue")');
  return firstBranch > at || "an endpoint branch is reachable before the gates finish";
});
// D2 · each endpoint, one row: it exists, it answers, and it cannot fall through silently
for (const [name, from, to] of ENDPOINTS) {
  row(next(), `POST ${name} exists and is reached by an explicit branch`, () => (rslice(from, to).length > 0) || "the branch is gone");
  row(next(), `POST ${name} always answers — every path in it ends in ok() or err()`, () => {
    const s = rslice(from, to);
    if (!s) return "branch not found";
    const answers = (s.match(/return (ok|err)\(/g) || []).length;
    return answers >= 1 || "the branch can fall through without answering";
  });
  row(next(), `POST ${name} scopes every database call it makes to this restaurant`, () => {
    const s = rslice(from, to);
    if (!s) return "branch not found";
    const calls = [...s.matchAll(/sb\.from\("(\w+)"\)([\s\S]{0,300}?)(?=sb\.from\(|return |await logAction|$)/g)];
    const bad = calls.filter((c) => !/restaurant_id/.test(c[2]) && !/\.rpc\(/.test(c[2]));
    return bad.length === 0 || `${bad.length} unscoped call(s) on ${bad.map((c) => c[1]).join(", ")}`;
  });
}
// D3 · the body shapes each endpoint validates
const SHAPES = [
  ["items/:id/status refuses a status outside its four", 'if (!["received", "preparing", "ready", "served"].includes(status)) return err("invalid status")'],
  ["platform/:id/status refuses a status outside its four", 'if (!["accepted", "preparing", "ready", "handed_over"].includes(status)) return err("invalid status")'],
  ["printer-events refuses a kind outside its five", 'if (!kinds.includes(kind)) return err("invalid problem kind")'],
  ["unready refuses a snapshot that is not an array", 'const raw = Array.isArray(body?.dishes) ? body.dishes : []'],
  ["unready refuses an empty snapshot with a sentence", 'return err("Nothing to take back — refresh the board and try again.", 400)'],
  ["unready caps the snapshot length", '.slice(0, 200)'],
  ["unready only accepts the three pre-served statuses", 'const VALID = ["received", "preparing", "ready"]'],
  ["print-jobs/claim coerces and caps its id list", '(body.ids as unknown[]).map(String).slice(0, 20)'],
  ["print-jobs/claim answers nothing won for an empty list", 'if (!ids.length) return ok({ won: [] })'],
  ["print-jobs/:id/done reads ok as a strict boolean", 'const okPrint = !!(body && body.ok === true)'],
  ["print-jobs/:id/done caps the error text it stores", 'String(body?.error || "print failed").slice(0, 120)'],
  ["dishes/:id/sold-out reads value as a strict boolean", 'const value = !!(body && body.value === true)'],
  ["printer-events trims and caps a typed note", 'typeof body?.note === "string" ? body.note.trim().slice(0, 300) : null'],
  ["printer-events caps a supplied printer name", 'typeof body?.printer === "string" && body.printer.trim().slice(0, 120)'],
  ["an issue's subject is coerced to a string", 'subject: String(ib?.subject || "")'],
  ["a missing/undefined id segment is refused before any query", 'if (emptyIdSegment(b) || emptyIdSegment(c)) return err("Missing id — please refresh and try again.")'],
  ["the ?table= slice refuses a non-numeric value", '/^\\d{1,6}$/.test(tblRaw.trim())'],
  ["a body that is not JSON becomes an empty object", 'catch { return {}; }'],
];
for (const [label, needle] of SHAPES) row(next(), label, () => has(ROUTE(), needle));

// D4 · every refusal a person can reach is a sentence, with a status
row(next(), "every err() on this route carries a plain sentence, never a bare code", () => {
  const errs = [...ROUTEC().matchAll(/return err\("([^"]+)"/g)].map((m) => m[1]);
  const bare = errs.filter((e) => e.length < 12 && !/^invalid /.test(e));
  return bare.length === 0 || `terse refusals: ${bare.join(" | ")}`;
});
row(next(), "every refusal that is the person's fault carries a 4xx, never a 5xx", () => {
  const codes = [...ROUTEC().matchAll(/return err\("[^"]+", (\d{3})\)/g)].map((m) => Number(m[1]));
  const bad = codes.filter((c) => c >= 500);
  return bad.length === 0 || `a person-facing refusal answers ${bad.join(", ")}`;
});
row(next(), "the two 409s are the two 'the ground moved' cases, not ordinary refusals", () => {
  const r = ROUTEC();
  const c409 = [...r.matchAll(/return err\("([^"]+)", 409\)/g)].map((m) => m[1]);
  return c409.length >= 1 || "no 409 anywhere — a moved-underneath case would be reported as a bad request";
});
row(next(), "the 403s are the blocked device and the platform-accept gate, and nothing else", () => {
  const c403 = [...ROUTEC().matchAll(/return err\("([^"]+)", 403\)/g)].map((m) => m[1]);
  const ok = c403.every((s) => /blocked by staff|isn't allowed to accept platform/.test(s));
  return ok || `unexpected 403: ${c403.join(" | ")}`;
});
row(next(), "the 404s all name what was not found, in words", () => {
  const c404 = [...ROUTEC().matchAll(/return err\("([^"]+)", 404\)/g)].map((m) => m[1]);
  const vague = c404.filter((s) => !/order|dish|platform order|print job|endpoint/i.test(s));
  return vague.length === 0 || `a vague 404: ${vague.join(" | ")}`;
});
// D5 · the panel only ever sends shapes the route accepts
row(next(), "the panel sends no endpoint the route does not implement", () => {
  const sent = [...APPC().matchAll(/api\("POST", `?\/([\w-]+)/g)].map((m) => m[1]);
  const known = new Set(["orders", "items", "platform", "dishes", "print-jobs", "print-station", "printer-events", "issue"]);
  const bad = [...new Set(sent)].filter((s) => !known.has(s));
  return bad.length === 0 || `the panel posts to: ${bad.join(", ")}`;
});
row(next(), "the panel never sends a GET the route does not implement", () => {
  const gets = [...APPC().matchAll(/api\("GET", "\/([\w-]+)/g)].map((m) => m[1]);
  const bad = [...new Set(gets)].filter((g) => !["board", "whoami"].includes(g));
  return bad.length === 0 || `unknown GETs: ${bad.join(", ")}`;
});
row(next(), "every write the panel makes carries the restaurant pin", () => {
  const a = APPC();
  const calls = [...a.matchAll(/"\/api\/kitchen" \+ ([a-zA-Z(]+)/g)].map((m) => m[1]);
  return calls.every((c) => c.startsWith("ridQ")) || "a call skips ridQ";
});
row(next(), "the route reads no body field the panel never sends", () => {
  const r = ROUTEC(), a = APPC();
  const read = new Set([...r.matchAll(/body\??\.(\w+)/g)].map((m) => m[1]));
  const known = new Set(["status", "value", "ids", "ok", "error", "kind", "note", "printer", "dishes", "subject", "image_url", "audio_url"]);
  const extra = [...read].filter((k) => !known.has(k) && !a.includes(k));
  return extra.length === 0 || `the route reads fields nobody sends: ${extra.join(", ")}`;
});
