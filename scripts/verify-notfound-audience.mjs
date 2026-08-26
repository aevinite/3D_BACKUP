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

const args = process.argv.slice(2);
const BASE = (args[args.indexOf("--base") + 1] || "").replace(/\/$/, "");
if (!BASE || !args.includes("--base")) {
  console.log("\n--base <url> is required. This guard needs the app running:\n" +
    "  npm run build && npx next start --port 4210\n" +
    "  npm run verify:notfound -- --base http://localhost:4210\n");
  process.exit(2);
}

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
  ["/signup",                           "staff", "/"],
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
        } else if (s.href !== href) {
          bad(`${path}'s way out points at ${s.href}, not ${href}`, `it reads "${s.label}"`);
        } else if (!s.painted) {
          bad(`${path} rendered the right screen but nothing is visible`, "the styles did not arrive");
        } else if (errs.length) {
          bad(`${path} threw`, errs[0]);
        } else {
          ok(`${path} → ${want}: "${s.title}" · "${s.label}" → ${s.href}`);
        }
      } catch (e) {
        bad(`${path} could not be loaded`, e.message);
      } finally { await p.close().catch(() => {}); }
    }

    // ── THE ROUTES THAT HAVE THEIR OWN 404 ──────────────────────────────────────────────────
    // A dish page carries its own not-found (components/GuestNotFound.tsx), so it never reaches
    // the docket. That is fine and it predates today's work — but the RULE still has to hold, and
    // it is the rule that matters rather than which drawing appears: a guest looking for a missing
    // page must never be handed a way out that leads to the staff password screen.
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
        toMenu && !toRoot
          ? ok(`${path} has its own guest 404 ("${s.heading}") and its way out is a menu, not the staff door`)
          : bad(`${path}'s 404 offers a way out that is not a menu`,
            `links: ${JSON.stringify(s.hrefs.slice(0, 4))} — "/" redirects to the staff password screen`);
      } finally { await p.close().catch(() => {}); }
    }

    // ── ONE APOSTROPHE ACROSS THE GUEST SCREENS ─────────────────────────────────────────────
    // This exact fault has now been made three times in one day: the French dictionary mixed the
    // typographic ’ with the typewriter ', then the rewritten offline page did, then these two
    // guest screens did. Nobody can name it when they see it and everybody registers it. So it is
    // a check rather than a thing to remember.
    {
      const files = ["app/not-found.tsx", "components/GuestNotFound.tsx", "public/offline.html"];
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
        // a typewriter apostrophe INSIDE a word ("isn't", "doesn't") — not a JS string delimiter
        const straight = /[a-z]'[a-z]/i.test(text);
        if (curly && straight) mixed.push(f);
      }
      mixed.length === 0
        ? ok(`the guest screens use one apostrophe style each (${files.length} files checked)`)
        : bad(`a screen mixes the typographic ’ with the typewriter ': ${mixed.join(", ")}`,
          "two apostrophes on one screen reads as cheap on the screen a restaurant is paying us for");
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
