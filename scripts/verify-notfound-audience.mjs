// verify-notfound-audience.mjs — A DINER AND A WAITER MUST NOT GET THE SAME 404.
//
//   node scripts/verify-notfound-audience.mjs --base http://localhost:4210
//   npm run verify:notfound -- --base http://localhost:4210
//
// WHY THIS EXISTS (owner, 2026-08-26, having looked at ten prototypes).
//
// He picked TWO different 404 screens, on purpose:
//   · a GUEST gets "the order slip on the spike" — a kitchen docket stamped VOID — and their way
//     out is the MENU, because that is what they came for.
//   · a MEMBER OF STAFF gets "burnt toast", and their way out stays "/", because that IS their
//     door. His words: "I liked burned toast for … any worker like tablet owner, even me, admin
//     manager, kitchen".
//
// Getting this wrong is not cosmetic. "/" redirects to /login, the staff username-and-password
// screen — so showing a diner the staff 404 drops them on a password prompt, which is the exact
// dead end components/GuestNotFound.tsx was written to remove.
//
// AND IT HAS ALREADY BEEN WRONG ONCE, WHICH IS WHY THIS IS DRIVEN AND NOT READ. The first
// implementation decided the audience with an inline <script> that stamped an attribute on <html>,
// and CSS that revealed one screen or the other. It worked on exactly TWO routes out of ten: React
// 19 hoists <style> and <script> children, and on the rest neither ran before paint — so a waiter
// on /manager/nope was shown the GUEST screen, unstyled. Reading the file would have told you
// nothing; only loading the routes did.
//
// So this loads real 404s and asks, of each one: which screen is in the tree, is ONLY that one in
// the tree, and where does its way out actually point.
import { chromium } from "playwright";
import { requireUp } from "./sweep/appUp.mjs";

const args = process.argv.slice(2);
const BASE = (args[args.indexOf("--base") + 1] || "").replace(/\/$/, "");
if (!BASE || !args.includes("--base")) {
  console.log("\n--base <url> is required. This guard needs the app running:\n" +
    "  npm run build && npx next start --port 4210\n" +
    "  npm run verify:notfound -- --base http://localhost:4210\n");
  process.exit(2);
}
// …and having a base is not the same as something answering on it. Without this, a stopped server
// answered with a raw ERR_CONNECTION_REFUSED stack, which reads as "this guard is broken" rather
// than "start the app" — the exact thing scripts/sweep/appUp.mjs was written to end.
await requireUp(BASE, "the two 404 screens");

let pass = 0, fail = 0, skipped = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, why) => { fail++; console.log(`  ❌ ${m}${why ? `\n       ${why}` : ""}`); };
// "I could not see it" is neither a pass nor a fault. Counted separately and printed, so a run
// that could not answer never looks like a run that answered yes.
const skip = (m, why) => { skipped++; console.log(`  ⏭  ${m}${why ? `\n       ${why}` : ""}`); };

// path → which screen, and where its way out must point.
const CASES = [
  ["/r/french-house/menu/no-such-page", "guest", "/r/french-house/menu"],
  ["/menu/no-such-page",                "guest", "/menu"],
  ["/manager/no-such-page",             "staff", "/"],
  ["/kitchen/no-such-page",             "staff", "/"],
  ["/tablet/no-such-page",              "staff", "/"],
  ["/owner/no-such-page",               "staff", "/"],
  ["/aevinite/no-such-page",            "staff", "/"],
  ["/editor/no-such-page",              "staff", "/"],
  // A STRAY ADDRESS BELONGS TO THE GUEST — and there is deliberately NO BUTTON on it.
  //
  // Settled 2026-08-28. This guard and verify:guest had asserted OPPOSITE things about /signup for
  // two days, and both quoted the owner from 2026-08-26: this one leant on burnt toast being the
  // default for anyone not obviously a guest, the other on the staff door being offered "if written
  // login or aevinite then only". He was shown the disagreement and left the call to me.
  //
  // A restaurant's public web address is typed at by diners with bad links, not by waiters. Wrong
  // towards the guest costs a worker one extra tap — "/" is one word away and they know the way in.
  // Wrong towards staff costs a diner a PASSWORD PROMPT, the exact dead end both screens exist to
  // remove. So: guest.
  //
  // `null` for the way out is the assertion, not an omission. With no restaurant to name we cannot
  // offer a menu — "/menu" is restaurant #1 by definition and would be the WRONG restaurant — so
  // the screen shows the advice and no button, and a button reappearing here is a regression.
  ["/signup",                           "guest", null],
  ["/no-such-thing/at-all",             "guest", null],
];

const run = async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    for (const [path, want, href] of CASES) {
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
      try {
        // ONE RETRY, AND A DIFFERENT VERDICT WHEN IT IS THE NETWORK'S FAULT.
        //
        // These are client components, so the audience is not chosen until their JavaScript has
        // arrived and hydrated. Against a deployed site that occasionally takes longer than any
        // patience is worth: two consecutive runs against production gave 11/2 and then 13/13 on a
        // site that had not changed. A flaky guard is barely better than one that cries wolf.
        //
        // So a screen that never appears is reported as "could not be read" — the honest answer —
        // and never as "the wrong screen was shown", which is a claim about the product. This
        // project's own rule: "could not run" is not "ran and found a fault".
        let appeared = false;
        for (let attempt = 0; attempt < 2 && !appeared; attempt++) {
          if (attempt) await p.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          else await p.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => {});
          // Wait for a screen that has been DECIDED — i.e. one rendered by React after it read the
          // address — not merely for one to be in the DOM. Waiting for ".nf-s" used to succeed
          // instantly against the server's own render, which is how the flash hid from this check.
          appeared = await p.waitForFunction(
            () => !!document.querySelector(".nf-g .rail, .nf-s .stage"), null, { timeout: 15000 })
            .then(() => true).catch(() => false);
        }
        if (!appeared) {
          skip(`${path}: neither screen appeared in time`,
            "the audience is chosen once this screen's JavaScript hydrates, so a slow network reads "
            + "the same as a broken page. Re-run, or run against a local production build.");
          continue;
        }
        const s = await p.evaluate(() => {
          const g = document.querySelector(".nf-g"), st = document.querySelector(".nf-s");
          const h = document.getElementById("nf-home");
          const h1 = document.querySelector(".nf h1");
          return {
            which: g ? "guest" : (st ? "staff" : null),
            both: !!(g && st),
            href: h ? h.getAttribute("href") : null,
            label: h ? h.textContent.trim() : null,
            title: h1 ? h1.textContent.trim() : null,
            // is the screen actually painted, or an invisible shell?
            painted: !!h1 && h1.getBoundingClientRect().height > 6,
          };
        });

        if (s.which !== want) {
          bad(`${path} shows the ${s.which || "no"} screen, not the ${want} one`,
            want === "guest"
              ? "a diner sent to the staff 404 lands on '/', which redirects to the staff password screen"
              : "a member of staff sent to the guest 404 is told to scan a QR code on their table");
        } else if (s.both) {
          bad(`${path} has BOTH screens in the tree`, "only one may ever be rendered, or one will show through the other");
        } else if (href === null && s.href !== null) {
          bad(`${path} offers a way out (${s.href}) when it does not know which restaurant they meant`,
            "there is nothing behind it — /menu is restaurant #1, which is the wrong one for a stranger, "
            + "and it would bounce them straight back to this screen");
        } else if (href !== null && s.href !== href) {
          bad(`${path}'s way out points at ${s.href}, not ${href}`, `it reads "${s.label}"`);
        } else if (!s.painted) {
          bad(`${path} rendered the right screen but nothing is visible`, "the styles did not arrive");
        } else if (errs.length) {
          bad(`${path} threw`, errs[0]);
        } else {
          ok(`${path} → ${want}: "${s.title}"` + (s.href ? ` · "${s.label}" → ${s.href}` : " · no way out offered, and none should be"));
        }
      } catch (e) {
        bad(`${path} could not be loaded`, e.message);
      } finally { await p.close().catch(() => {}); }
    }

    // ── THE ROUTES THAT HAVE THEIR OWN 404 ──────────────────────────────────────────────────
    // A dish page carries its own not-found (components/GuestNotFound.tsx). It shows the SAME
    // docket with the SAME words — the owner threw out the dish-specific variant on 2026-08-26
    // ("we don't even need it") — so what is asserted here is the rule, not the drawing: a guest
    // looking for a missing page must never be handed a way out that leads to the staff password
    // screen, and the words must not have drifted back into a special case.
    for (const path of ["/r/french-house/item/no-such-dish", "/item/no-such-dish"]) {
      const p = await ctx.newPage();
      try {
        await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
        // The dish screen asks whether the menu is live before it offers a button, so the link
        // appears LATER than the page does. Wait for the answer, not for a guess at how long it takes.
        await p.waitForFunction(() => !!document.querySelector("a.btn, a[href*='/menu']"), null, { timeout: 20000 })
          .catch(() => { /* reported below */ });
        const s = await p.evaluate(() => {
          const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
          const h = document.querySelector("h1, h2");
          return { hrefs, heading: h ? h.textContent.trim() : null };
        });
        const toMenu = s.hrefs.some((h) => /\/menu$/.test(h));
        const toRoot = s.hrefs.some((h) => h === "/");
        // and it must NOT have grown a dish-specific wording again
        const noDishVariant = !/dish/i.test(s.heading || "");
        toMenu && !toRoot && noDishVariant
          ? ok(`${path} shows the guest docket ("${s.heading}") and its way out is a menu, not the staff door`)
          : bad(`${path}'s 404 offers a way out that is not a menu`,
            `links: ${JSON.stringify(s.hrefs.slice(0, 4))} — "/" redirects to the staff password screen`);
      } finally { await p.close().catch(() => {}); }
    }

    // ── THE WAY OUT MUST BE READABLE ────────────────────────────────────────────────────────
    //
    // This is here because it went wrong and nothing caught it. app/globals.css carries
    // `a { color: inherit !important }` so guest links never turn blue, and an !important
    // declaration beats any normal one however specific — so the colours set on these buttons never
    // applied to an anchor and the text inherited the page colour. Measured on the built site: the
    // guest button 1.19:1 and the STAFF button 1.00:1, which is text the exact colour of the thing
    // it is printed on. Both ways out were invisible. Every other check was green, because every
    // other check asked what the buttons SAID and where they WENT, never whether anyone could see
    // them. The owner found it by looking.
    {
      const p = await ctx.newPage();
      try {
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
                             return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
        for (const [path, label] of [["/menu/no-such-page", "the guest 404"], ["/manager/no-such-page", "the staff 404"], ["/item/no-such-dish", "the dish 404"]]) {
          await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
          await p.waitForFunction(() => !!document.querySelector("a.nf-btn, a.btn"), null, { timeout: 20000 }).catch(() => {});
          const seen = await p.evaluate(() => {
            const parse = (x) => { const m = String(x).match(/rgba?\(([^)]+)\)/); return m ? m[1].split(",").slice(0, 3).map(Number) : null; };
            return [...document.querySelectorAll("a.nf-btn, a.btn, button.nf-btn")].map((e) => {
              // FINDING THE REAL BACKDROP, and this took a correction. A ghost button has a
              // transparent background, so the backdrop is an ancestor's — but these screens are
              // painted with a radial-gradient, which is a background-IMAGE and reports its
              // background-COLOR as transparent. Walking up only for a colour therefore sailed
              // past the cream gradient all the way to the body's near-black and reported the
              // perfectly readable "Try again" at 1.15:1. So a gradient counts: take the first
              // colour it declares, which is the one under the top of the card.
              const cs = getComputedStyle(e);
              let bg = parse(cs.backgroundColor);
              if (!bg || /rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor)) {
                let n = e.parentElement;
                while (n) {
                  const s2 = getComputedStyle(n);
                  if (s2.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(s2.backgroundColor)) { bg = parse(s2.backgroundColor); break; }
                  if (s2.backgroundImage && s2.backgroundImage !== "none" && /rgba?\(/.test(s2.backgroundImage)) { bg = parse(s2.backgroundImage); break; }
                  n = n.parentElement;
                }
              }
              return { txt: e.textContent.trim(), fg: parse(cs.color), bg: bg || [11, 16, 32] };
            });
          });
          const unreadable = seen.filter((b) => b.fg && ratio(b.fg, b.bg) < 4.5)
            .map((b) => `"${b.txt}" at ${ratio(b.fg, b.bg).toFixed(2)}:1`);
          seen.length && unreadable.length === 0
            ? ok(`${label}: every way out is readable (${seen.map((b) => ratio(b.fg, b.bg).toFixed(1) + ":1").join(", ")})`)
            : bad(`${label} has a way out nobody can read`,
              seen.length ? unreadable.join(", ") + " — 4.5:1 is the floor; 1.00:1 means the text is the same colour as the button"
                          : "no buttons were found at all");
        }
      } finally { await p.close().catch(() => {}); }
    }

    // ── AN ADDRESS A BROWSER CANNOT READ MUST NOT ANSWER A BARE ERROR (owner, 2026-09-02) ───
    //
    // His words: "make sure it doesn't happen only and if it happens, then what will the staff do?"
    //
    // A web address carries anything unusual as % plus two digits. Damage those digits — a link cut
    // short by a chat app, a stray % typed by hand, a QR photographed badly and retyped — and the
    // address is no longer readable text. Next decodes the restaurant name out of the path while
    // matching /r/[restaurant]/menu, that decode throws, and the throw lands INSIDE Next's own
    // request handling, before any page or error boundary. It answered twenty-one bytes:
    // "Internal Server Error". middleware.ts now turns each of these into the guest screen that
    // says what to do. This row is what stops that regressing.
    {
      const damaged = [
        ["a name cut short mid-character", "/r/%E0%A4/menu"],
        ["a name with a broken character inside it", "/r/fr%E0%A4ance/menu"],
        ["a lone percent sign in the name", "/r/%/menu"],
        ["a printed code cut short mid-character", "/q/%E0%A4"],
        ["a printed code with a bad escape", "/q/%zz"],
        ["a broken character in the middle of a name", "/r/a%E0b/menu"],
      ];
      const bad500 = [];
      for (const [what, url] of damaged) {
        let st = -1;
        try { st = (await fetch(BASE + url, { redirect: "follow" })).status; } catch { st = -2; }
        if (st >= 500 || st === -2) bad500.push(`${what} (${url}) -> ${st === -2 ? "no answer at all" : st}`);
      }
      if (bad500.length) bad("a damaged address still answers a bare server error", bad500.join("  ·  "));
      else ok(`all ${damaged.length} damaged addresses answer a real guest screen, never a bare server error`);

      const p4 = await browser.newPage();
      try {
        await p4.setViewportSize({ width: 360, height: 780 });
        await p4.goto(`${BASE}/r/%E0%A4/menu`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await p4.waitForTimeout(3500);
        const t4 = await p4.evaluate(() => document.body.innerText).catch(() => "");
        if (/member of staff/i.test(t4) && /menu isn|table doesn/i.test(t4))
          ok("…and a damaged address tells the person to ask a member of staff");
        else bad("a damaged address does not tell the person what to do next", `screen reads: ${t4.slice(0, 90).replace(/\n/g, " · ")}`);
      } finally { await p4.close().catch(() => {}); }

      const { readFileSync: rf } = await import("node:fs");
      const { join: jn, dirname: dn } = await import("node:path");
      const { fileURLToPath: fu } = await import("node:url");
      const R2 = jn(dn(fu(import.meta.url)), "..");
      let mw = null;
      try { mw = rf(jn(R2, "middleware.ts"), "utf8"); } catch { mw = null; }
      if (!mw) bad("middleware.ts is gone", "the damaged-address fix lived there; without it those addresses answer a bare 500 again");
      else {
        const code2 = mw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        const gatey = /tokenIsValid|requireRole|ownerScope|cookies\(|supabase|ADMIN_PASSWORD|session/i.test(code2);
        const scoped = /matcher: \["\/r\/:path\*", "\/q\/:path\*"\]/.test(code2);
        const temporary = /307/.test(code2) && !/\b308\b/.test(code2);
        if (gatey) bad("the middleware has grown a gate", "CLAUDE.md: the gate is per-route on purpose. This file checks no permission, reads no session, touches no database.");
        else if (!scoped) bad("the middleware is no longer scoped to the two guest doors", "it must not run on the panels, the APIs or the assets");
        else if (!temporary) bad("the middleware's hop is not temporary", "a permanent hop would be cached in that person's browser for ever, and this is a mistake, not a move");
        else ok("…and the middleware that does it still holds no gate, runs only on the two guest doors, and hops temporarily");
      }
    }

    // ── EVERY RULE IN THIS SCREEN'S STYLESHEET MATCHES SOMETHING (T1 round 2, 2026-09-02) ───
    // Fifty rules ship with every 404 and not one of them had ever been checked. Four could never
    // match anything: three left behind when the toaster's "again" class was replaced by re-keying,
    // and one anchor rule for a button that is a <button>. They were deleted; this stops the next
    // four appearing. A rule that matches nothing is bytes every visitor downloads for no reason —
    // and, worse, it hides the ones that were MEANT to match and no longer do.
    //
    // Judged on the right screen, and with scripting BOTH on and off: .nf-g rules on a diner's
    // address, .nf-s rules on a staff one, and the no-JavaScript fallback (which is the .nf-s skin
    // and is the only place an <a class="nf-btn nf-again"> exists) with scripting disabled.
    {
      const { readFileSync } = await import("node:fs");
      const { join, dirname } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
      const nf = readFileSync(join(ROOT, "app/not-found.tsx"), "utf8");
      const css = (nf.match(/const CSS = `([\s\S]*?)`;/) || [])[1] || "";
      const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|\n)([^@\n{}][^{}\n]*?)\s*\{([^}]*)\}/g)]
        .map((m) => m[2].trim()).filter((s2) => s2 && !s2.startsWith("@") && !/^\d/.test(s2));
      const pages = {};
      for (const [k, url, js] of [["guest", "/menu/zz-css-guard", true], ["staff", "/manager/zz-css-guard", true], ["nojs", "/zz-css-guard", false]]) {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, javaScriptEnabled: js });
        const pg = await ctx.newPage();
        await pg.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await pg.waitForTimeout(js ? 3000 : 900);
        pages[k] = { ctx, pg };
      }
      const dead = [];
      for (const sel of rules) {
        const parts = sel.replace(/:focus-visible|::before|::after|:visited|:hover|:active/g, "").split(",").map((x) => x.trim()).filter(Boolean);
        let hits = 0;
        // EACH COMMA-SEPARATED PART IS JUDGED ON ITS OWN SCREEN. The reduce-motion rule names
        // `.nf-g .docket` AND `.nf-s .slice` in one selector; routing the whole rule by whether it
        // mentions .nf-g or .nf-s skipped BOTH screens and called a live rule dead.
        for (const k of ["guest", "staff", "nojs"]) {
          const mine = parts.filter((s2) => (/\.nf-g/.test(s2) ? k !== "staff" : /\.nf-s/.test(s2) ? k !== "guest" : true));
          if (!mine.length) continue;
          if (k === "nojs") {
            // With scripting off there is no DOM to query, so match the MARKUP: every class token
            // in the selector must be present, and a tag qualifier (`a.nf-again`) must appear on a
            // tag of that name. Crude, but it is the only way to see the <noscript> fallback — and
            // that fallback is the one place an <a class="nf-btn nf-again"> exists.
            const html = await pages[k].pg.content();
            const ns = (html.match(/<noscript>([\s\S]*?)<\/noscript>/) || [])[1] || "";
            for (const s2 of mine) {
              const classes = [...s2.matchAll(/\.([\w-]+)/g)].map((mm) => mm[1]);
              const tag = (s2.match(/(?:^|\s)([a-z]+)\./) || [])[1];
              const classesThere = classes.every((cl) => ns.includes(cl));
              const tagThere = !tag || new RegExp(`<${tag}\\b[^>]*class="[^"]*${classes[classes.length - 1]}`).test(ns);
              if (classesThere && tagThere) hits += 1;
            }
          } else {
            hits += await pages[k].pg.evaluate((ss) => ss.reduce((a, s2) => { try { return a + document.querySelectorAll(s2).length; } catch { return a; } }, 0), mine);
          }
        }
        // .nf-brand is only drawn when the device has stored THIS restaurant's name — a cold probe
        // has not, so it is exempted rather than counted as dead.
        if (hits === 0 && !/nf-brand/.test(sel)) dead.push(sel);
      }
      for (const k of Object.keys(pages)) await pages[k].ctx.close().catch(() => {});
      if (!rules.length) bad("the 404 stylesheet could not be read", "the `const CSS = \\`…\\`` block did not parse");
      else if (dead.length) bad(`${dead.length} rule(s) in the 404's stylesheet match nothing at all`, dead.join("  ·  "));
      else ok(`all ${rules.length} rules in the 404's stylesheet match something real (checked on both screens, and with scripting off)`);
    }

    // ── THE VOID STAMP COVERS NO WORD ON THE DOCKET (owner, item 9, 2026-09-02) ─────────────
    // It used to be pinned to the docket's BOTTOM, which on a 206px docket put it straight across
    // the last two rows: "none" half covered, "no such table" struck through by its own border.
    // The stamp is meant to slam across the docket — that is the design — it just has to land on
    // the blank part, which is the top-right beside the big "404".
    //
    // MEASURED AS INK, NEVER AS BOXES. `h2` and `.big` are block elements: their rectangles span
    // the whole docket even when the words inside them are 70px wide on the left, so a box test
    // reports an overlap that a reader cannot see. A Range around the text node gives what is
    // actually painted. The first version of this check got that wrong and reported two overlaps
    // that were not there.
    //
    // BOTH DOCKETS, because there are two: the platform 404's VOID stamp, and the guest menu's own
    // CLOSED stamp on components/GuestNotFound.tsx — the screen a diner reaches from a wrong or
    // retired restaurant link, which is the commoner of the two. They had the identical fault and
    // it was found on the second one only because this check was pointed at it.
    for (const [label, w, h, url, root] of [
      ["phone", 360, 780, "/zz-nf-stamp-probe", ".nf-g"],
      ["desktop", 1280, 800, "/zz-nf-stamp-probe", ".nf-g"],
      ["phone, the wrong-restaurant screen", 360, 780, "/r/zz-nf-stamp-probe/menu", ".gnf"],
      ["desktop, the wrong-restaurant screen", 1280, 800, "/r/zz-nf-stamp-probe/menu", ".gnf"],
    ]) {
      const p = await browser.newPage();
      try {
        await p.setViewportSize({ width: w, height: h });
        await p.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await p.waitForSelector(`${root} .stamp`, { timeout: 15000 }).catch(() => {});
        const r = await p.evaluate((rt) => {
          const st = document.querySelector(`${rt} .stamp`);
          if (!st) return null;
          const s = st.getBoundingClientRect();
          const ink = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
          const hit = [];
          for (const el of document.querySelectorAll(`${rt} .docket h2, ${rt} .big, ${rt} .row span`)) {
            if (!el.textContent.trim()) continue;
            const b = ink(el);
            if (b.width && b.left < s.right && s.left < b.right && b.top < s.bottom && s.top < b.bottom) hit.push(el.textContent.trim());
          }
          return { hit, onDocket: s.width > 0 && s.height > 0 };
        }, root);
        if (!r) skip(`${label}: the stamp covers no word on the docket`, "this address did not draw a guest docket");
        else if (!r.onDocket) bad(`${label}: the stamp is not drawn at all`, "it should still slam onto the docket");
        else if (r.hit.length) bad(`${label}: the stamp covers words on the docket`, `it lands on: ${r.hit.join(", ")}`);
        else ok(`${label}: the stamp slams onto the blank part of the docket, covering no word`);
      } finally { await p.close().catch(() => {}); }
    }

    // ── ONE APOSTROPHE ACROSS THE GUEST SCREENS ─────────────────────────────────────────────
    // This exact fault has now been made three times in one day: the French dictionary mixed the
    // typographic ’ with the typewriter ', then the rewritten offline page did, then these two
    // guest screens did. Nobody can name it when they see it and everybody registers it. So it is
    // a check rather than a thing to remember.
    {
      // components/Maintenance.tsx joined this list on 2026-09-02 (T1 round 3). It is the third
      // screen a diner meets when something is not available, it carries readable words, and it was
      // the only one of the three not guarded — it had drifted to the typewriter apostrophe while
      // the other two use the typeset one.
      const files = ["app/not-found.tsx", "components/GuestNotFound.tsx", "components/Maintenance.tsx", "public/offline.html"];
      const { readFileSync } = await import("node:fs");
      const { join, dirname } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
      const mixed = [];
      for (const f of files) {
        const src = readFileSync(join(ROOT, f), "utf8");
        // Only the words a person READS: quoted strings and JSX text, not code or comments.
        // Strip block comments, whole-line comments AND trailing comments. The first version of
        // this check only dropped whole-line ones and then flagged the file over the word "don't"
        // in a trailing code comment — a guard that invents a failure protects nothing. Only the
        // words a person actually READS are in scope.
        const text = src
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .split("\n")
          .filter((l) => !/^\s*\/\//.test(l))
          .map((l) => l.replace(/\s\/\/.*$/, ""))
          .join("\n");
        const curly = /[\u2019]|&rsquo;/.test(text);
        // a typewriter apostrophe INSIDE a word ("isn't", "doesn't") — not a JS string delimiter.
        //
        // …AND ITS HTML ENTITIES, which this check could not see until 2026-09-02 (T1 round 3).
        // JSX cannot carry a bare apostrophe in text, so a file that wants the typewriter one writes
        // `&apos;` — and `&apos;` matched neither side of this test. components/Maintenance.tsx used
        // it twice and read as having no apostrophes at all; mixing the two styles in that file did
        // not turn this row red. A guard that cannot see the thing it is for is worse than no guard,
        // because it reads as a pass. Proven by sabotage after the fix: one of each now goes red.
        const straight = /[a-z]'[a-z]/i.test(text) || /&apos;|&#0*39;/.test(text);
        if (curly && straight) mixed.push(f);
      }
      mixed.length === 0
        ? ok(`the guest screens use one apostrophe style each (${files.length} files checked)`)
        : bad(`a screen mixes the typographic ’ with the typewriter ': ${mixed.join(", ")}`,
          "two apostrophes on one screen reads as cheap on the screen a restaurant is paying us for");
    }

    // ── THE TAB AND THE SHARE PREVIEW ARE PART OF THE WHITE LABEL TOO (owner's item 7, 2026-09-02) ──
    //
    // The guest 404's SCREEN has been white-label since 2026-08-04. Its <head> was not: both dish
    // doors answered a correct 404 carrying `<title>Aevidine — Restaurant OS</title>` and the
    // platform's own sales description, because Next discards a route's generateMetadata when the
    // page calls notFound() and falls back to the ROOT layout's. So a diner read our company across
    // the top of their phone, and a forwarded link previewed as our pitch under the restaurant's name.
    //
    // DRIVEN, NOT READ, and deliberately so: the fix is a `metadata` export in a not-found boundary,
    // which is a framework behaviour rather than a rule of ours. A source check would keep passing
    // the day Next stops honouring it. This asks the served document.
    {
      for (const path of ["/item/no-such-dish-zz", "/r/french-house/item/no-such-dish-zz"]) {
        let head = null, status = 0;
        try {
          const res = await fetch(BASE + path, { redirect: "follow" });
          status = res.status;
          head = (await res.text()).split("</head>")[0];
        } catch { head = null; }
        if (head === null) {
          skipped++;
          console.log(`  ⏭  could not read the head of ${path}`);
          continue;
        }
        const title = (head.match(/<title>([^<]*)/) || [])[1] || "";
        const desc = (head.match(/<meta name="description" content="([^"]*)/) || [])[1] || "";
        const brandInHead = /Aevidine/i.test(head);
        status === 404 && !brandInHead
          ? ok(`a dead dish link names no platform brand in the tab or the share preview (${path} → 404, title "${title}")`)
          : bad(`${path} answered ${status} and its <head> still says: title "${title}" / description "${desc.slice(0, 60)}"`,
            "a guest who opens a stale dish link reads OUR company in their browser tab, and a forwarded "
            + "link previews as our sales pitch under the restaurant's name. The fix is a `metadata` export "
            + "in BOTH app/item/[slug]/not-found.tsx and app/r/[restaurant]/item/[slug]/not-found.tsx, which "
            + "verify:3d-viewer requires to stay byte-identical.");
      }
    }

    // The two screens must stay DIFFERENT. A future tidy-up that makes them share one look would
    // quietly undo the whole point of the decision.
    {
      const g = await ctx.newPage();
      await g.goto(BASE + "/menu/no-such-page", { waitUntil: "domcontentloaded" });
      await g.waitForFunction(() => !!document.querySelector(".nf-g, .nf-s"), null, { timeout: 20000 }).catch(() => {});
      const gt = await g.evaluate(() => (document.querySelector(".nf h1") || {}).textContent || "");
      const s = await ctx.newPage();
      await s.goto(BASE + "/manager/no-such-page", { waitUntil: "domcontentloaded" });
      await s.waitForFunction(() => !!document.querySelector(".nf-g, .nf-s"), null, { timeout: 20000 }).catch(() => {});
      const st = await s.evaluate(() => (document.querySelector(".nf h1") || {}).textContent || "");
      gt.trim() && st.trim() && gt.trim() !== st.trim()
        ? ok(`the two screens really are different ("${gt.trim()}" vs "${st.trim()}")`)
        : bad("the guest and staff 404s have converged on the same screen",
          "the owner picked two different ones deliberately — the docket for diners, the toaster for staff");
      await g.close(); await s.close();
    }
    await ctx.close();
  } catch (e) {
    bad("the run stopped early", e.stack || e.message);
  } finally {
    await browser.close().catch(() => {});
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`
      + (skipped ? `, ${skipped} could not be read (re-run, or use a local production build)` : "") + "\n");
    process.exit(fail === 0 ? 0 : 1);
  }
};
run();
