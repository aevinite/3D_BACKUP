// scripts/sweep/t16s10/new-a.mjs — NEW checks, sweep #10 T16, ids P185020–P185129.
// The two files nobody had ever checked: shrinkimg.js (0 rows) and netretry.js (2 rows).
// shrinkimg is driven in a real browser (canvas, createImageBitmap, WebP encoding) on the
// same-origin harness; netretry is driven in a Node vm with a scripted fetch and a recorded clock.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import vm from "node:vm";
import { R, ok, eq, assert, tag, src, code } from "./lib.mjs";
import { harness, memo, sleep } from "./browser.mjs";

const done = tag("new-a");
const SI = "shrinkimg.js", NR = "netretry.js";
let id = 185020;
const N = (file, what, fn, how) => R(`P${id++}`, file, what, fn, how);

// ══════════════════ shrinkimg.js — driven in a real browser ══════════════════
// Every image is MADE in the page (canvas → toBlob), so no fixture file is needed and nothing leaves the page.
const shrink = memo(async () => {
  const h = await harness({ scripts: [SI] });
  const r = await h.page.evaluate(async () => {
    const make = (w, h, type, q, noise) => new Promise((ok) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#c33"); g.addColorStop(1, "#33c"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      if (noise) { const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() * 255) | 0; d.data[i] = n; d.data[i + 1] = (n * 7) & 255; d.data[i + 2] = (n * 13) & 255; } x.putImageData(d, 0, 0); }
      c.toBlob((b) => ok(new File([b], "photo." + (type.split("/")[1] === "jpeg" ? "jpg" : type.split("/")[1]), { type })), type, q);
    });
    const dims = async (f) => { const b = await createImageBitmap(f, { imageOrientation: "from-image" }); return [b.width, b.height]; };
    const S = window.LFH_IMG.shrink, o = {};
    o.api = Object.keys(window.LFH_IMG).sort().join(",");
    o.max = window.LFH_IMG.MAX_EDGE;
    const big = await make(4000, 3000, "image/jpeg", 0.95, true);
    const a = await S(big); o.big = { changed: a.changed, type: a.file.type, from: a.from, to: a.to, note: a.note, name: a.file.name, dims: await dims(a.file), smaller: a.file.size < big.size };
    const tall = await make(1500, 3000, "image/jpeg", 0.95, true);
    const t = await S(tall); o.tall = { dims: await dims(t.file) };
    const png = await make(2600, 1300, "image/png", undefined, true);
    const p = await S(png); o.png = { changed: p.changed, type: p.file.type, dims: await dims(p.file), name: p.file.name };
    const small = await make(300, 200, "image/jpeg", 0.6, false);
    const s = await S(small); o.small = { changed: s.changed, same: s.file === small, note: s.note, size: small.size };
    const exact = await make(1280, 720, "image/jpeg", 0.98, true);
    const e = await S(exact); o.exact = { size: exact.size, changed: e.changed, dims: await dims(e.file) };
    const tiny = await make(1, 1, "image/png");
    const ty = await S(tiny); o.tiny = { changed: ty.changed, same: ty.file === tiny };
    const gif = new File([new Uint8Array([71, 73, 70, 56, 57, 97])], "x.gif", { type: "image/gif" });
    const gf = await S(gif); o.gif = { same: gf.file === gif, changed: gf.changed };
    const broken = new File([new Uint8Array([255, 216, 255, 0, 1, 2, 3])], "broken.jpg", { type: "image/jpeg" });
    const br = await S(broken); o.broken = { same: br.file === broken, changed: br.changed };
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });
    const em = await S(empty); o.empty = { same: em.file === empty };
    let threw = false; try { const n1 = await S(null); o.nul = { file: n1.file, changed: n1.changed }; } catch (err) { threw = true; } o.nullThrew = threw;
    try { const n2 = await S(undefined); o.undef = { changed: n2.changed }; } catch (err) { o.undefThrew = true; }
    const noname = new File([await (await make(2000, 1000, "image/jpeg", 0.95, true)).arrayBuffer()], "", { type: "image/jpeg" });
    const nn = await S(noname); o.noname = nn.file.name;
    const dotted = new File([await (await make(2000, 1000, "image/jpeg", 0.95, true)).arrayBuffer()], "my.dish.photo.JPG", { type: "image/jpeg" });
    o.dotted = (await S(dotted)).file.name;
    // already-optimised: a small, already-webp file under the cap
    const webpSmall = await make(800, 600, "image/webp", 0.5, false);
    const ws = await S(webpSmall); o.webpSmall = { changed: ws.changed, size: webpSmall.size };
    // a re-encode that would come out BIGGER: a tiny flat image over the skip size? force via a PNG that is already tiny
    const flatBig = await make(1300, 1300, "image/png", undefined, false);
    const fb = await S(flatBig); o.flatBig = { changed: fb.changed, out: fb.file.size, in: flatBig.size };
    // a browser that cannot make WebP (toBlob hands back null) → the original goes up
    const realToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
    const nb = await S(big); o.noWebp = { same: nb.file === big, changed: nb.changed };
    HTMLCanvasElement.prototype.toBlob = function () { throw new Error("canvas refused"); };
    const cr = await S(big); o.canvasThrows = { same: cr.file === big };
    HTMLCanvasElement.prototype.toBlob = realToBlob;
    // a browser without createImageBitmap → the <img> fallback still shrinks
    const realCIB = window.createImageBitmap; window.createImageBitmap = undefined;
    const fbk = await S(big); o.imgFallback = { changed: fbk.changed, type: fbk.file.type };
    window.createImageBitmap = realCIB;
    // createImageBitmap rejecting → the original
    window.createImageBitmap = () => Promise.reject(new Error("decode"));
    const rj = await S(big); o.cibRejects = { same: rj.file === big };
    window.createImageBitmap = realCIB;
    // readable()
    o.readable = [window.LFH_IMG.readable(500), window.LFH_IMG.readable(180 * 1024), window.LFH_IMG.readable(1048576), window.LFH_IMG.readable(3.45 * 1048576)];
    // it touches no network, no storage
    o.ls = Object.keys(localStorage).length;
    // two shrinks at once do not interfere
    const [x1, x2] = await Promise.all([S(big), S(tall)]);
    o.parallel = [await dims(x1.file), await dims(x2.file)];
    // the shrunk file is decodable as an image
    o.decodes = await new Promise((ok) => { const u = URL.createObjectURL(a.file), i = new Image(); i.onload = () => ok(i.naturalWidth > 0); i.onerror = () => ok(false); i.src = u; });
    o.lastModified = a.file.lastModified > Date.now() - 60000;
    return o;
  });
  const res = { r, errors: h.errors, sent: h.sent.length };
  await h.close(); return res;
});
const SR = (what, fn) => N(SI, what, async () => fn((await shrink()).r, await shrink()), "headless: images made in the page, shrunk by the real shrinkimg.js");
SR("the helper publishes shrink, MAX_EDGE and readable on window.LFH_IMG", (r) => ok(r.api === "MAX_EDGE,readable,shrink", r.api));
SR("the long-edge cap is 1280 px", (r) => ok(r.max === 1280));
SR("a 4000×3000 phone photo comes back changed", (r) => ok(r.big.changed === true));
SR("…as WebP", (r) => ok(r.big.type === "image/webp", r.big.type));
SR("…capped at 1280 on its long edge, keeping its shape (1280×960)", (r) => ok(r.big.dims.join("x") === "1280x960", r.big.dims.join("x")));
SR("…and smaller than what was given", (r) => ok(r.big.smaller, `${r.big.from} → ${r.big.to}`));
SR("…and the note reads like a person would say it ('X MB → Y KB')", (r) => ok(/^\d+(\.\d)? (MB|KB) → \d+(\.\d)? (MB|KB)$/.test(r.big.note), r.big.note));
SR("…and the file name keeps its stem and gains .webp", (r) => ok(r.big.name === "photo.webp", r.big.name));
SR("…and 'from'/'to' carry the real byte sizes", (r) => ok(r.big.from > r.big.to && r.big.to > 0, `${r.big.from}/${r.big.to}`));
SR("a PORTRAIT photo is capped on its HEIGHT (1500×3000 → 640×1280)", (r) => ok(r.tall.dims.join("x") === "640x1280", r.tall.dims.join("x")));
SR("a PNG screenshot is shrunk and turned into WebP too", (r) => ok(r.png.changed && r.png.type === "image/webp", r.png.type));
SR("…keeping its 2:1 shape (1280×640)", (r) => ok(r.png.dims.join("x") === "1280x640", r.png.dims.join("x")));
SR("…and its name loses .png for .webp", (r) => ok(r.png.name === "photo.webp", r.png.name));
SR("a small photo already within the cap is returned UNTOUCHED (rule 3)", (r) => ok(r.small.same && !r.small.changed, `${r.small.size} bytes`));
SR("…and says nothing (an empty note)", (r) => ok(r.small.note === ""));
SR("a 1280-wide photo over 180 KB is re-encoded but never enlarged", (r) => ok(r.exact.dims[0] <= 1280, `${r.exact.dims.join("x")}, ${r.exact.size} bytes in, changed ${r.exact.changed}`));
SR("a 1×1 image is left alone", (r) => ok(r.tiny.same && !r.tiny.changed));
SR("a GIF (not on the list) is passed through untouched", (r) => ok(r.gif.same && !r.gif.changed));
SR("a broken JPEG never throws — the original goes up (rule 1)", (r) => ok(r.broken.same && !r.broken.changed));
SR("an empty file is passed through untouched", (r) => ok(r.empty.same));
SR("shrink(null) answers instead of throwing", (r) => ok(!r.nullThrew && r.nul.changed === false));
SR("shrink(undefined) answers instead of throwing", (r) => ok(!r.undefThrew && r.undef && r.undef.changed === false));
SR("a file with NO name gets 'photo.webp'", (r) => ok(r.noname === "photo.webp", r.noname));
SR("a name with several dots keeps all but the last ('my.dish.photo.webp')", (r) => ok(r.dotted === "my.dish.photo.webp", r.dotted));
SR("an already-small WebP within the cap is left exactly as it is", (r) => ok(r.webpSmall.changed === false || r.webpSmall.size > 180 * 1024, `${r.webpSmall.size} bytes, changed ${r.webpSmall.changed}`));
SR("a re-encode is never kept when it would be BIGGER (rule 2)", (r) => ok(!r.flatBig.changed || r.flatBig.out < r.flatBig.in, `in ${r.flatBig.in} out ${r.flatBig.out}`));
SR("a browser that cannot encode WebP uploads the original", (r) => ok(r.noWebp.same && !r.noWebp.changed));
SR("a canvas that THROWS while encoding uploads the original", (r) => ok(r.canvasThrows.same));
SR("a browser without createImageBitmap still shrinks, through an <img>", (r) => ok(r.imgFallback.changed && r.imgFallback.type === "image/webp", JSON.stringify(r.imgFallback)));
SR("createImageBitmap refusing the file uploads the original", (r) => ok(r.cibRejects.same));
SR("readable() says bytes under a megabyte in KB, rounded", (r) => ok(r.readable[0] === "0 KB" && r.readable[1] === "180 KB", r.readable.join(" · ")));
SR("readable() says a megabyte and up with one decimal", (r) => ok(r.readable[2] === "1.0 MB" && r.readable[3] === "3.5 MB", r.readable.join(" · ")));
SR("the shrink touches no storage", (r) => ok(r.ls === 0));
N(SI, "the shrink makes no request at all (rule 4)", async () => ok((await shrink()).sent === 0, `${(await shrink()).sent} requests`), "the harness counts every /api request");
SR("two shrinks at the same time do not interfere", (r) => ok(r.parallel[0].join("x") === "1280x960" && r.parallel[1].join("x") === "640x1280", JSON.stringify(r.parallel)));
SR("the shrunk file decodes as a picture again", (r) => ok(r.decodes));
SR("the shrunk file carries a fresh lastModified, never 0", (r) => ok(r.lastModified));
N(SI, "shrinkimg raises no page error through any of that", async () => ok(!(await shrink()).errors.length, (await shrink()).errors.join(" | ")));
// EXIF orientation: a JPEG whose pixels are landscape but whose tag says "rotate 90°"
const exif = memo(async () => {
  const h = await harness({ scripts: [SI] });
  const r = await h.page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 2000; c.height = 1000; const x = c.getContext("2d");
    x.fillStyle = "#c00"; x.fillRect(0, 0, 1000, 1000); x.fillStyle = "#00c"; x.fillRect(1000, 0, 1000, 1000);
    const d = x.getImageData(0, 0, 2000, 1000); for (let i = 0; i < d.data.length; i += 4) d.data[i + 1] = (Math.random() * 60) | 0; x.putImageData(d, 0, 0);
    const jpg = new Uint8Array(await (await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.95))).arrayBuffer());
    // APP1 "Exif\0\0" + TIFF (little-endian) + one IFD entry: Orientation (0x0112) = 6
    const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff], len = body.length + 2;
    const app1 = [0xff, 0xe1, len >> 8, len & 255, ...body];
    const out = new Uint8Array(jpg.length + app1.length); out.set(jpg.slice(0, 2), 0); out.set(app1, 2); out.set(jpg.slice(2), 2 + app1.length);
    const f = new File([out], "rotated.jpg", { type: "image/jpeg" });
    const seen = await createImageBitmap(f, { imageOrientation: "from-image" });
    const s = await window.LFH_IMG.shrink(f);
    const after = await createImageBitmap(s.file);
    // which colour is on TOP after rotating 90° clockwise: the left half (red) goes to the top
    const cc = document.createElement("canvas"); cc.width = after.width; cc.height = after.height; const xx = cc.getContext("2d"); xx.drawImage(after, 0, 0);
    const top = xx.getImageData(Math.floor(after.width / 2), 5, 1, 1).data, bottom = xx.getImageData(Math.floor(after.width / 2), after.height - 5, 1, 1).data;
    return { seen: [seen.width, seen.height], out: [after.width, after.height], changed: s.changed, top: [top[0], top[2]], bottom: [bottom[0], bottom[2]] };
  });
  const res = { r, errors: h.errors };
  await h.close(); return res;
});
N(SI, "a phone photo tagged 'rotate 90°' is read the way the phone shows it (portrait)", async () => { const r = (await exif()).r; return ok(r.seen[1] > r.seen[0], r.seen.join("x")); }, "headless: a JPEG built with an EXIF Orientation=6 tag");
N(SI, "…and arrives upright after the shrink, not on its side (640×1280)", async () => { const r = (await exif()).r; return ok(r.changed && r.out.join("x") === "640x1280", r.out.join("x")); }, "the same file");
N(SI, "…with the picture really turned, not just its box (red on top)", async () => { const r = (await exif()).r; return ok(r.top[0] > 150 && r.top[1] < 80, `top rgb r${r.top[0]} b${r.top[1]} · bottom r${r.bottom[0]} b${r.bottom[1]}`); }, "sample the pixels");
// static reads of shrinkimg.js
N(SI, "the encoder asks for high-quality smoothing", () => /ctx\.imageSmoothingQuality = "high";/.test(code(SI)));
N(SI, "WebP quality is 0.82", () => /var QUALITY = 0\.82;/.test(code(SI)));
N(SI, "the skip size is 180 KB", () => /var SKIP_UNDER = 180 \* 1024;/.test(code(SI)));
N(SI, "only PNG, JPEG and WebP are touched — the same three the upload route accepts", () => { const t = (code(SI).match(/var TYPES = \{([^}]*)\}/) || [])[1]; return ok(/image\/jpeg/.test(t) && /image\/png/.test(t) && /image\/webp/.test(t) && !/gif|heic/.test(t), t); });
N(SI, "the bitmap is closed once used, so a 4000-px decode is not held in memory", () => count2(code(SI), /bitmap\.close\(\)/) === 2);
N(SI, "an object URL made for the <img> fallback is revoked when the image fails", () => /img\.onerror = function \(\) \{ URL\.revokeObjectURL\(url\); resolve\(null\); \};/.test(code(SI)));
N(SI, "the whole of shrink() sits inside one try that hands back the original", () => /\} catch \(e\) \{\s*return out;/.test(code(SI)));
N(SI, "it is plain ES5-style JavaScript: no import, no require", () => !/\bimport\b|require\(/.test(code(SI)));
N(SI, "it writes nothing to localStorage, IndexedDB or a cookie", () => !/localStorage|indexedDB|document\.cookie/.test(code(SI)));
N(SI, "it makes no network request", () => !/fetch\(|XMLHttpRequest|sendBeacon/.test(code(SI)));
N(SI, "it is loaded by the manager panel, the page with the dish-photo upload", () => /shrinkimg\.js\?v=[0-9a-f]{8}/.test(src("public/panels/editor/index.html")));
N(SI, "every page that loads it carries a content-hash stamp on it", () => ["editor", "kitchen", "tablet"].every((p) => { const h = src(`public/panels/${p}/index.html`); return !/shrinkimg\.js"/.test(h) && (!/shrinkimg/.test(h) || /shrinkimg\.js\?v=[0-9a-f]{8}/.test(h)); }));
N(SI, "issue-raise.js shrinks a PHOTO before upload, and never a voice note", () => /if \(kind !== "audio" && window\.LFH_IMG\)/.test(code("issue-raise.js")));
N(SI, "…and a failure inside the shrink still uploads the original", () => /try \{ file = \(await LFH_IMG\.shrink\(file\)\)\.file; \} catch \(e\) \{/.test(code("issue-raise.js").replace(/\/\*[^]*?\*\//g, "")) || /try \{ file = \(await LFH_IMG\.shrink\(file\)\)\.file; \} catch \(e\) \{\s*\}/.test(code("issue-raise.js")));
N(SI, "the manager panel's dish-photo upload calls the same shrink", () => /LFH_IMG\.shrink\(/.test(code("public/panels/editor/app.js")));
function count2(t, re) { return (t.match(new RegExp(re.source, "g")) || []).length; }

// ══════════════════ netretry.js — driven in a vm with a recorded clock ══════════════════
function loadNR({ responses, onLine = true, hasTimeout = true, randoms = [0.5] }) {
  const calls = [], waits = []; let ri = 0;
  const ctx = {
    navigator: { onLine }, Promise, Object, Error,
    Math: Object.assign(Object.create(Math), { random: () => randoms[ri++ % randoms.length], floor: Math.floor, min: Math.min, max: Math.max }),
    setTimeout: (fn, ms) => { waits.push(ms); fn(); },
    AbortSignal: hasTimeout ? { timeout: (ms) => ({ aborted: false, deadlineMs: ms }) } : {},
    fetch: async (url, opts) => { calls.push({ url, opts }); const n = responses.shift(); if (n === undefined) throw new Error("no more scripted answers"); if (typeof n === "function") return n(opts); if (n instanceof Error) throw n; return n; },
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src(NR), ctx);
  return { f: ctx.window.LFH_NET.fetch, calls, waits };
}
const res = (status) => ({ status });
const down = () => Object.assign(new Error("Failed to fetch"), { name: "TypeError" });
const NN = (what, fn) => N(NR, what, fn, "node vm: the real netretry.js, a scripted fetch, a recorded clock");
NN("it publishes exactly one thing: LFH_NET.fetch", async () => { const c = { navigator: {}, Promise, Object, Math, setTimeout, AbortSignal: {}, fetch: async () => res(200) }; c.window = c; vm.createContext(c); vm.runInContext(src(NR), c); return eq(Object.keys(c.window.LFH_NET), ["fetch"]); });
NN("a healthy GET is ONE request, with no wait", async () => { const t = loadNR({ responses: [res(200)] }); const r = await t.f("/a"); return ok(r.status === 200 && t.calls.length === 1 && t.waits.length === 0, `${t.calls.length} call(s), waits ${t.waits.join(",")}`); });
NN("a POST is sent exactly ONCE, even when it fails at the network", async () => { const t = loadNR({ responses: [down()] }); let threw = false; try { await t.f("/a", { method: "POST" }); } catch { threw = true; } return ok(threw && t.calls.length === 1); });
NN("…a POST that answers 503 is handed back as it is, never re-sent", async () => { const t = loadNR({ responses: [res(503)] }); const r = await t.f("/a", { method: "POST" }); return ok(r.status === 503 && t.calls.length === 1); });
NN("…and PUT, PATCH and DELETE likewise go out once", async () => { const out = []; for (const m of ["PUT", "PATCH", "DELETE"]) { const t = loadNR({ responses: [res(503)] }); await t.f("/a", { method: m }); out.push(t.calls.length); } return ok(out.every((n) => n === 1), out.join(",")); });
NN("…and a write is given NO deadline of its own (the outbox owns writes)", async () => { const t = loadNR({ responses: [res(200)] }); await t.f("/a", { method: "POST" }); return ok(!t.calls[0].opts.signal); });
NN("a lower-case 'get' is still a read", async () => { const t = loadNR({ responses: [down(), res(200)] }); await t.f("/a", { method: "get" }); return ok(t.calls.length === 2); });
NN("HEAD is a read too, and retried", async () => { const t = loadNR({ responses: [res(502), res(200)] }); const r = await t.f("/a", { method: "HEAD" }); return ok(r.status === 200 && t.calls.length === 2); });
NN("502 is retried", async () => { const t = loadNR({ responses: [res(502), res(200)] }); return ok((await t.f("/a")).status === 200 && t.calls.length === 2); });
NN("503 is retried", async () => { const t = loadNR({ responses: [res(503), res(200)] }); return ok((await t.f("/a")).status === 200 && t.calls.length === 2); });
NN("504 is retried", async () => { const t = loadNR({ responses: [res(504), res(200)] }); return ok((await t.f("/a")).status === 200 && t.calls.length === 2); });
NN("500 is an ANSWER, not a blip — handed back at once", async () => { const t = loadNR({ responses: [res(500)] }); return ok((await t.f("/a")).status === 500 && t.calls.length === 1); });
NN("429 is never hammered — handed back at once", async () => { const t = loadNR({ responses: [res(429)] }); return ok((await t.f("/a")).status === 429 && t.calls.length === 1); });
NN("401 / 403 / 404 / 409 / 422 are answers, never retried", async () => { const out = []; for (const s of [401, 403, 404, 409, 422]) { const t = loadNR({ responses: [res(s)] }); await t.f("/a"); out.push(t.calls.length); } return ok(out.every((n) => n === 1), out.join(",")); });
NN("a network blip then a 503 then a 200 still lands the answer", async () => { const t = loadNR({ responses: [down(), res(503), res(200)] }); return ok((await t.f("/a")).status === 200 && t.calls.length === 3); });
NN("three tries at most — one attempt plus two retries", async () => { const t = loadNR({ responses: [down(), down(), down(), res(200)] }); let threw = false; try { await t.f("/a"); } catch { threw = true; } return ok(threw && t.calls.length === 3, `${t.calls.length}`); });
NN("…after which the LAST real answer is handed back when there was one", async () => { const t = loadNR({ responses: [down(), res(503), down()] }); const r = await t.f("/a"); return ok(r.status === 503, String(r.status)); });
NN("…and the last ERROR is rethrown when nothing ever answered", async () => { const t = loadNR({ responses: [down(), down(), down()] }); try { await t.f("/a"); return false; } catch (e) { return ok(e.message === "Failed to fetch"); } });
NN("the first wait is 250–375 ms (250 plus up to half again)", async () => { for (const r of [0, 0.999]) { const t = loadNR({ responses: [down(), res(200)], randoms: [r] }); await t.f("/a"); if (!(t.waits[0] >= 250 && t.waits[0] <= 375)) return ok(false, String(t.waits[0])); } return true; });
NN("the second wait is 600–900 ms", async () => { for (const r of [0, 0.999]) { const t = loadNR({ responses: [down(), down(), res(200)], randoms: [r] }); await t.f("/a"); if (!(t.waits[1] >= 600 && t.waits[1] <= 900)) return ok(false, String(t.waits[1])); } return true; });
NN("the waits are whole milliseconds (jitter is floored)", async () => { const t = loadNR({ responses: [down(), down(), res(200)], randoms: [0.3333] }); await t.f("/a"); return ok(t.waits.every((w) => Number.isInteger(w)), t.waits.join(",")); });
NN("two devices with different luck wait different times (jitter is real)", async () => { const a = loadNR({ responses: [down(), res(200)], randoms: [0.1] }), b = loadNR({ responses: [down(), res(200)], randoms: [0.9] }); await a.f("/a"); await b.f("/a"); return ok(a.waits[0] !== b.waits[0], `${a.waits[0]} vs ${b.waits[0]}`); });
NN("with no signal it does not burn retries — one try, then 'no internet'", async () => { const t = loadNR({ responses: [down()], onLine: false }); try { await t.f("/a"); return false; } catch { return ok(t.calls.length === 1); } });
NN("an AbortError is never retried", async () => { const t = loadNR({ responses: [Object.assign(new Error("x"), { name: "AbortError" })] }); try { await t.f("/a"); return false; } catch { return ok(t.calls.length === 1); } });
NN("a read is given the 15 s ceiling", async () => { const t = loadNR({ responses: [res(200)] }); await t.f("/a"); return ok(t.calls[0].opts.signal.deadlineMs === 15000); });
NN("…ONE ceiling for all the attempts, not one each", async () => { const t = loadNR({ responses: [down(), down(), res(200)] }); await t.f("/a"); return ok(t.calls[0].opts.signal === t.calls[2].opts.signal); });
NN("a caller's own signal is used, never replaced", async () => { const mine = { aborted: false }; const t = loadNR({ responses: [res(200)] }); await t.f("/a", { signal: mine }); return ok(t.calls[0].opts.signal === mine); });
NN("the caller's options object is not mutated when the ceiling is added", async () => { const o = { method: "GET" }; const t = loadNR({ responses: [res(200)] }); await t.f("/a", o); return ok(!("signal" in o)); });
NN("a phone with no AbortSignal.timeout still reads (no ceiling, no crash)", async () => { const t = loadNR({ responses: [res(200)], hasTimeout: false }); const r = await t.f("/a"); return ok(r.status === 200 && !t.calls[0].opts); });
NN("a phone whose AbortSignal.timeout THROWS still reads", async () => { const c = { navigator: { onLine: true }, Promise, Object, Math, Error, setTimeout: (f) => f(), AbortSignal: { get timeout() { throw new Error("nope"); } }, fetch: async () => res(200) }; c.window = c; vm.createContext(c); vm.runInContext(src(NR), c); return ok((await c.window.LFH_NET.fetch("/a")).status === 200); });
NN("when OUR ceiling fires, the error is named TimeoutError and reads in English", async () => { const t = loadNR({ responses: [(opts) => { opts.signal.aborted = true; throw Object.assign(new Error("signal timed out"), { name: "TimeoutError" }); }] }); try { await t.f("/a"); return false; } catch (e) { return ok(e.name === "TimeoutError" && e.message === "the server didn't answer in time" && e.timeout === true, e.message); } });
NN("…but a CALLER's own abort keeps the caller's error exactly", async () => { const mine = { aborted: true }; const t = loadNR({ responses: [Object.assign(new Error("user went away"), { name: "AbortError" })] }); try { await t.f("/a", { signal: mine }); return false; } catch (e) { return ok(e.message === "user went away"); } });
NN("a ceiling that has already fired stops the retries at once", async () => { const t = loadNR({ responses: [(o) => { o.signal.aborted = true; throw down(); }, res(200)] }); try { await t.f("/a"); return false; } catch (e) { return ok(t.calls.length === 1, `${t.calls.length} call(s)`); } });
NN("the shared rule matches lib/netRetry.ts: the same waits", () => { const a = (code(NR).match(/ATTEMPT_WAITS_MS = \[([^\]]+)\]/) || [])[1]; const b = (src("lib/netRetry.ts").match(/\[\s*250\s*,\s*600\s*\]/) || [])[0]; return ok(a && a.replace(/\s/g, "") === "250,600" && !!b, `panel [${a}] · lib ${b || "differs"}`); });
NN("…and the same transient statuses (502, 503, 504)", () => /502: 1, 503: 1, 504: 1/.test(code(NR)) && /502/.test(src("lib/netRetry.ts")) && /504/.test(src("lib/netRetry.ts")));
N(NR, "all three panels load netretry.js before their own app.js", () => ["editor", "kitchen", "tablet"].every((p) => { const h = src(`public/panels/${p}/index.html`), o = [...h.matchAll(/src="\/panels\/([^"?]+)/g)].map((m) => m[1]); const i = h.indexOf("netretry.js"), j = h.search(/src="(\/panels\/\w+\/)?app\.js/); return o.indexOf("netretry.js") >= 0 && j > 0 && i < j; }), "read each index.html");
N(NR, "all three panels' read helpers go through LFH_NET.fetch, with plain fetch as the fallback", () => ["editor", "kitchen", "tablet"].every((p) => /window\.LFH_NET \? window\.LFH_NET\.fetch : fetch/.test(code(`public/panels/${p}/app.js`))), "read each app.js");
N(NR, "the file makes no request of its own and keeps no state between calls", () => !/localStorage|indexedDB/.test(code(NR)) && count2(code(NR), /\bfetch\(/) === 2, "read the file: the two fetch( calls are the write pass-through and the read attempt");
N(NR, "test:netretry is green", async () => { const { npmRun } = await import("./lib.mjs"); const r = npmRun("test:netretry"); return ok(r.ok, (r.out.match(/ℹ pass \d+/) || [""])[0]); }, "npm run test:netretry");

done();
