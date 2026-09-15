// verify-own-hero — EVERY RESTAURANT'S HERO SHOWS ITS OWN WORDS, INCLUDING RESTAURANT #1.
//
// WHY THIS EXISTS (owner, 2026-09-15, picked as item 10 of sweep #9 terminal 30's report). The
// guest menu's hero read:
//
//     greeting={isDefault ? t.greeting : (tagline || "Welcome")}
//
// so French House — restaurant #1 — was the ONE tenant whose hero ignored its own
// `restaurants.tagline` and `hero_title`. The database said BONSOIR; the screen said BONJOUR, out
// of `lib/i18n.ts`. Editing that field on the flagship restaurant changed nothing anybody could
// see, and it took a sweep comparing the column against the rendered pixels to notice, because the
// screen looked perfectly correct on its own. Every other restaurant already read its own —
// Pizza Palace's BUONASERA was on screen throughout.
//
// It is now `tagline || (isDefault ? t.greeting : "Welcome")`: the stored value wins for everyone,
// and #1's localised copy is only its FALLBACK.
//
// ⚠️ R30 IS UNCHANGED AND THIS GUARD DEFENDS IT TOO. docs/REJECTED-IDEAS.md → R30 (owner,
// 2026-08-17: "i want english only for all") rejected giving OTHER restaurants a neutral
// TRANSLATED fallback, and reaching for `t.greeting` / `t.heroTitle` on their behalf — those keys
// hold restaurant #1's own copy and leaking them onto another tenant is the bug that line exists to
// prevent. So half A checks BOTH things at once: that the stored value comes first, AND that a
// non-#1 restaurant with no custom hero still falls back to the plain English literal.
//
//   node scripts/verify-own-hero.mjs                                  # source only
//   node scripts/verify-own-hero.mjs --base http://localhost:4431     # + the real rendered pages
//
// Exit 1 = a restaurant's own hero is being ignored, or #1's copy is leaking onto another tenant.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);

// ── A · the expression itself ────────────────────────────────────────────────────────────────
head("A · the hero reads the restaurant's own stored words first");
{
  const src = readFileSync(join(root, "components", "MenuView.tsx"), "utf8");
  const line = (src.match(/<HeroTitle[^>]*\/>/) || [""])[0];
  ok(!!line, `found the <HeroTitle> in the hero block`);
  if (line) {
    // The stored value must come BEFORE any i18n key or literal in each of the two expressions.
    const greetOk = /greeting=\{\s*tagline\s*\|\|/.test(line);
    const titleOk = /title=\{\s*heroTitle\s*\|\|/.test(line);
    ok(greetOk, `the greeting takes \`tagline\` first`
      + (greetOk ? "" : ` — it does not. A restaurant that sets a tagline must see it, #1 included.`));
    ok(titleOk, `the title takes \`heroTitle\` first`
      + (titleOk ? "" : ` — it does not.`));
    // R30: a NON-#1 restaurant with no custom hero must still get the plain English literal,
    // never a translated key. So t.greeting/t.heroTitle may only appear behind `isDefault`.
    const keyUse = [...line.matchAll(/t\.(greeting|heroTitle)/g)].map((m) => m[0]);
    const gated = keyUse.every(() => /isDefault\s*\?\s*t\.(greeting|heroTitle)\s*:/.test(line));
    ok(keyUse.length === 0 || gated,
      `restaurant #1's own copy (${keyUse.join(", ") || "none"}) is reachable ONLY behind isDefault — R30`
      + (gated ? "" : ` — it is not. Those keys are #1's French copy; another tenant must get "Welcome" / "Our Menu".`));
    const literalsKept = /"Welcome"/.test(line) && /"Our Menu"/.test(line);
    ok(literalsKept, `the English literals "Welcome" / "Our Menu" are still the fallback for other tenants — R30`);
  }
}

// ── B · the rendered pages, compared against the database ────────────────────────────────────
head("B · what three real restaurants actually render");
{
  const i = process.argv.indexOf("--base");
  const base = i > -1 ? process.argv[i + 1] : null;
  if (!base) {
    console.log("⏭  skipped: pass --base http://localhost:<port> to read the rendered heroes. Not a failure.");
  } else {
    const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const k = l.indexOf("="); return [l.slice(0, k).trim(), l.slice(k + 1).trim().replace(/^["']|["']$/g, "")];
    }));
    let env = {};
    try { env = parseEnv(readFileSync(join(root, ".env.local"), "utf8")); } catch { /* none */ }
    if (!env.SUPABASE_ACCESS_TOKEN) { console.log("⏭  skipped: needs .env.local to read what the database stores."); }
    else {
      let chromium;
      try { ({ chromium } = await import("playwright")); }
      catch { console.log("⏭  skipped: playwright is not installed here."); process.exit(bad === 0 ? 0 : 1); }
      const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
      const q = async (sql) => {
        const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: sql, read_only: true }),
        });
        if (!r.ok) throw new Error((await r.text()).slice(0, 140));
        return r.json();
      };
      const want = await q(`select slug, tagline, hero_title from restaurants
                             where deleted_at is null and active and slug in ('french-house','pizza-palace')`);
      const b = await chromium.launch();
      try {
        for (const r of want) {
          const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
          const p = await ctx.newPage();
          await p.goto(`${base}/r/${r.slug}/menu?table=9`, { waitUntil: "networkidle", timeout: 180000 });
          await p.waitForTimeout(3500);
          const hero = await p.evaluate(() => {
            const el = document.querySelector(".hero");
            return el ? el.innerText.replace(/\s+/g, " ").trim() : "";
          });
          if (r.tagline) {
            ok(hero.toUpperCase().includes(r.tagline.toUpperCase()),
              `${r.slug}: the stored tagline "${r.tagline}" is on screen (hero reads "${hero}")`);
          }
          if (r.hero_title) {
            ok(hero.includes(r.hero_title),
              `${r.slug}: the stored hero title "${r.hero_title}" is on screen`);
          }
          // and #1's French copy must never appear on another tenant
          if (r.slug !== "french-house") {
            ok(!/BONJOUR|little French house|All-Day Caf/i.test(hero),
              `${r.slug}: carries none of restaurant #1's copy`);
          }
          await ctx.close();
        }
      } finally { await b.close(); }
    }
  }
}

console.log(bad === 0
  ? "\n✅ every restaurant's hero shows its own words, and #1's copy stays on #1."
  : `\n❌ ${bad} problem(s) — a restaurant's own hero is being ignored, or #1's copy is leaking.`);
process.exit(bad === 0 ? 0 : 1);
