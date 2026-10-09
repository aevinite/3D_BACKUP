// lib/readGuard.ts — every method and branch.
import { suite } from "./lib.mjs";
const t = suite("lib/readGuard.ts", 168701, 50);
const G = await import("@/lib/readGuard.ts");
const ERR = { message: "boom", code: "57014" };
const set = (reads) => { let s; const real = console.error; const out = []; console.error = (...a) => out.push(a.join(" ")); try { s = new G.ReadSet("owner/x", reads); } finally { console.error = real; } return [s, out]; };
{ const r = G.named("a", { data: [1], error: null, count: 3 }); t("named: keeps name, data, count; ms 0; not retried", r.name === "a" && r.data[0] === 1 && r.count === 3 && r.ms === 0 && r.retried === false); }
{ const r = G.named("a", { data: undefined, error: undefined }); t("named: missing data/error become null; a missing count is null", r.data === null && r.error === null && r.count === null); }
{ const r = G.named("a", null); t("named(null result) does not crash", r.data === null && r.error === null); }
{ const r = await G.rd("a", async () => ({ data: [1], error: null, count: 0 })); t("rd: a good read keeps its count of 0 (a head count is not 'no rows')", r.count === 0 && r.data.length === 1 && r.retried === false && r.ms >= 0); }
{ let n = 0; const r = await G.rd("a", async () => (++n, { data: null, error: { code: "23514", message: "violates check constraint" } })); t("rd: a refusal is NOT retried", n === 1 && r.retried === false && !!r.error); }
{ let n = 0; const r = await G.rd("a", async () => (++n === 1 ? { data: null, error: { message: "fetch failed" } } : { data: [7], error: null })); t("rd: a transient failure gets ONE retry and the retry's answer", n === 2 && r.retried === true && r.data[0] === 7); }
{ let n = 0; const r = await G.rd("a", async () => (++n, { data: null, error: { message: "fetch failed" } })); t("rd: a second transient failure is reported, not retried again", n === 2 && !!r.error); }
{ const r = await G.rd("a", async () => { throw new Error("socket hang up"); }); t("rd: a read that THROWS is turned into an error, not a crash", !!r.error); }
{ const [, out] = set([G.named("orders", { data: null, error: ERR }), G.named("ok", { data: [], error: null }), G.named("plain", { data: null, error: "just text" }), G.named("err", { data: null, error: new Error("e!") })]);
  t("ReadSet logs each failure exactly once with the route and read names", out.length === 3 && out[0].startsWith('[owner/x] read "orders" failed (57014)'));
  t("…a string error is logged as itself, an Error by its message, a code-less error without '()'", /read "plain" failed after/.test(out[1]) && /just text/.test(out[1]) && /e!/.test(out[2])); }
{ const [s] = set([G.named("a", { data: [1, 2], error: null }), G.named("b", { data: null, error: ERR })]);
  t("failed(): false for a good read, true for a failed one, TRUE for a name that does not exist", !s.failed("a") && s.failed("b") && s.failed("typo"));
  t("anyFailed true, allFailed false, failedNames ['b']", s.anyFailed && !s.allFailed && s.failedNames.join() === "b");
  t("error(name) is the read's own error; for an unknown name an Error naming it", s.error("b") === ERR && /no read named "zz"/.test(s.error("zz").message));
  t("firstError is the first failure", s.firstError === ERR);
  t("rows() of a good read → its rows; of a failed read → throws ReadFailed naming route and read", s.rows("a").length === 2 && (() => { try { s.rows("b"); return false; } catch (e) { return e instanceof G.ReadFailed && e.where === "owner/x" && e.read === "b" && e.cause === ERR && /the "b" read failed/.test(e.message); } })());
  t("rows() of an unknown read throws (a typo never reads as an empty list)", (() => { try { s.rows("nope"); return false; } catch (e) { return e instanceof G.ReadFailed; } })());
  t("one() → the first row; throws when the read failed", s.one("a") === 1 && (() => { try { s.one("b"); return false; } catch { return true; } })());
  t("rowsOr: a failed or unknown read → the fallback; a good one → its rows", s.rowsOr("b", ["fb"])[0] === "fb" && s.rowsOr("nope", ["fb"])[0] === "fb" && s.rowsOr("a", []).length === 2);
  t("value(): a good read → its data; failed or unknown → throws", s.value("a").length === 2 && (() => { try { s.value("b"); return false; } catch { return true; } })() && (() => { try { s.value("q"); return false; } catch { return true; } })());
  t("count(): unknown → throws; failed → throws; no count asked → throws", ["q", "b", "a"].every((n) => { try { s.count(n); return false; } catch (e) { return e instanceof G.ReadFailed; } }));
  t("partial(): only failed reads that have a key, each key once", JSON.stringify(s.partial({ a: "sales", b: "expenses", q: "expenses" })) === '["expenses"]'); }
{ const [s] = set([G.named("a", { data: null, error: null, count: 4 })]); t("count(): a head count → the number; one() of an empty good read → null; rows() → []", s.count("a") === 4 && s.one("a") === null && s.rows("a").length === 0 && s.value("a") === null); }
{ const [s] = set([G.named("a", { data: null, error: ERR }), G.named("b", { data: null, error: ERR })]); t("allFailed true when every read failed", s.allFailed && s.anyFailed); }
{ const [s] = set([]); t("an empty ReadSet: nothing failed, not allFailed, firstError null", !s.anyFailed && !s.allFailed && s.firstError === null && s.failedNames.length === 0); }
{ const s = new G.ReadSet("x", [{ name: "slow", data: [], error: null, count: null, ms: 900, retried: false }, { name: "fast", data: [], error: null, count: null, ms: 3, retried: false }]); t("slowerThan(500) lists only the slow read, with its time", JSON.stringify(s.slowerThan(500)) === '[{"name":"slow","ms":900}]'); }
t("keepWhatAnswered is gone (item 14) — nothing exported under that name", typeof G.keepWhatAnswered === "undefined");
{ const [s] = set([G.named("a", { data: null, error: null })]); t("rowsOr: a good read that returned no data → [] (not the fallback — empty is an answer)", s.rowsOr("a", ["fb"]).length === 0); }
{ const s = new G.ReadSet("x", [{ name: "edge", data: [], error: null, count: null, ms: 500, retried: false }]); t("slowerThan(500) does NOT list a read of exactly 500 ms (strictly slower)", s.slowerThan(500).length === 0); }
