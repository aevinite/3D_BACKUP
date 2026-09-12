// tests/net-retry.test.mjs — the rule the owner asked for on 2026-09-12:
// "it should not even come for three seconds if my network is good."
//
// A read must not report a network problem until a quiet retry has failed too — and, just as
// importantly, a WRITE must still go out exactly once, or this fix would start ringing up duplicate
// orders. Both halves are asserted here.
//
// It drives the REAL panel file (public/panels/netretry.js) with a stubbed fetch, then cross-checks
// that lib/netRetry.ts still carries the same numbers — the two exist separately only because the
// panels have no bundler, and a rule copied twice is a rule that drifts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PANEL_FILE = "public/panels/netretry.js";
const TS_FILE = "lib/netRetry.ts";

/** Load the panel file with a controllable fetch, and hand back its netFetch + the call log. */
function load({ responses, onLine = true }) {
  const calls = [];
  const ctx = {
    navigator: { onLine },
    setTimeout: (fn) => fn(),        // no real waiting — the delays are asserted separately
    Promise,
    Math,
    fetch: async (url, opts) => {
      calls.push({ url, method: (opts && opts.method) || "GET" });
      const next = responses.shift();
      if (next === undefined) throw new Error("test ran out of scripted responses");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(PANEL_FILE, "utf8"), ctx);
  return { netFetch: ctx.window.LFH_NET.fetch, calls };
}

const ok = (status = 200) => ({ status });
const netDown = () => Object.assign(new Error("Failed to fetch"), { name: "TypeError" });

test("a GET that blips once succeeds quietly — the person is never told", async () => {
  const { netFetch, calls } = load({ responses: [netDown(), ok()] });
  const res = await netFetch("/api/editor/all", { method: "GET" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2, "should have made a second attempt by itself");
});

test("a GET with no method named is still treated as a read", async () => {
  const { netFetch, calls } = load({ responses: [netDown(), ok()] });
  assert.equal((await netFetch("/api/admin/overview")).status, 200);
  assert.equal(calls.length, 2);
});

test("502/503/504 are retried; the recovered answer is returned", async () => {
  for (const bad of [502, 503, 504]) {
    const { netFetch, calls } = load({ responses: [ok(bad), ok(200)] });
    assert.equal((await netFetch("/x", { method: "GET" })).status, 200, `status ${bad}`);
    assert.equal(calls.length, 2, `status ${bad} should be retried`);
  }
});

test("A WRITE IS NEVER RETRIED — a second POST could ring up a second order", async () => {
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    const { netFetch, calls } = load({ responses: [netDown()] });
    await assert.rejects(() => netFetch("/api/editor/order", { method }));
    assert.equal(calls.length, 1, `${method} must be sent exactly once`);
  }
});

test("a 4xx is an answer, not a blip — returned as-is, never repeated", async () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    const { netFetch, calls } = load({ responses: [ok(status)] });
    assert.equal((await netFetch("/x", { method: "GET" })).status, status);
    assert.equal(calls.length, 1, `${status} must not be retried`);
  }
});

test("when the browser KNOWS it is offline, say so at once — no hopeless retries", async () => {
  const { netFetch, calls } = load({ responses: [netDown()], onLine: false });
  await assert.rejects(() => netFetch("/x", { method: "GET" }));
  assert.equal(calls.length, 1, "offline must not burn retries");
});

test("an abort is the caller's decision or the deadline — honoured immediately", async () => {
  for (const name of ["AbortError", "TimeoutError"]) {
    const { netFetch, calls } = load({ responses: [Object.assign(new Error(name), { name })] });
    await assert.rejects(() => netFetch("/x", { method: "GET" }));
    assert.equal(calls.length, 1, `${name} must not be retried`);
  }
});

test("it gives up after the budget and hands back the last real answer", async () => {
  const { netFetch, calls } = load({ responses: [ok(503), ok(503), ok(503)] });
  assert.equal((await netFetch("/x", { method: "GET" })).status, 503);
  assert.equal(calls.length, 3, "one attempt plus two retries, then stop");
});

test("it gives up after the budget and rethrows the last error", async () => {
  const { netFetch, calls } = load({ responses: [netDown(), netDown(), netDown()] });
  await assert.rejects(() => netFetch("/x", { method: "GET" }), /Failed to fetch/);
  assert.equal(calls.length, 3);
});

test("the panel copy and the TypeScript copy carry the SAME rule", () => {
  const panel = readFileSync(PANEL_FILE, "utf8");
  const ts = readFileSync(TS_FILE, "utf8");
  const waits = (s) => (s.match(/ATTEMPT_WAITS_MS\s*=\s*\[([^\]]*)\]/) || [])[1]?.replace(/\s/g, "");
  assert.equal(waits(panel), waits(ts), "retry delays drifted between the two copies");
  for (const status of ["502", "503", "504"]) {
    assert.ok(panel.includes(status) && ts.includes(status), `${status} missing from one copy`);
  }
  // Both must refuse to retry a write. The panel checks the method, the TS file checks the method.
  assert.ok(/GET"\s*\|\|\s*m === "HEAD"/.test(panel), "panel lost its idempotent-only guard");
  assert.ok(/GET"\s*\|\|\s*m === "HEAD"/.test(ts), "lib lost its idempotent-only guard");
});
