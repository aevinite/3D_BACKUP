// Re-proves, on TODAY's code, the old owner-home rows whose sweep-8 detector went red on 2026-10-16
// for a reason that is the DETECTOR's, not the product's: it was pinned to an exact older shape that
// the owner deliberately changed since (the tile pop-up became the docket on 2026-10-04, the colour
// rule moved to lib/restaurantColor.ts, the month card was clipped like-for-like, the layout grew
// item 37's sign-in bounce and item 28's navOn). Each row's INTENT is asked again against today's
// code; a row whose intent the owner himself retired is marked ⏭ RETIRED with his ruling, never ✅.
//
//   npx tsx scripts/sweep/t20s10/reprove-static.mjs [--json=<file>]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { src, rel } from "./lib.mjs";

const out = [];
const re = async (id, fn) => {
  let r; try { r = await fn(); } catch (e) { r = { ok: false, note: `threw: ${e.message}` }; }
  out.push({ id, ...r });
};
const ok = (note) => ({ ok: true, note });
const no = (note) => ({ ok: false, note });
const retired = (note) => ({ ok: null, note });
const P = src("app/owner/page.tsx"), TD = src("components/owner/TileDocket.tsx"), L = src("app/owner/layout.tsx");
const SB = src("app/owner/SignInBounce.tsx");
const rc = await import(rel("lib/restaurantColor.ts"));
const ids = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-0000-0000-00000000000${i + 1}`);

// ── replay-r1 (T12 round 1) ──────────────────────────────────────────────────────────────────
await re("P05528", () => {
  const two = [...rc.restaurantPalette(ids(2)).values()], five = [...rc.restaurantPalette(ids(5)).values()];
  return two.every((c) => rc.GREEN_SHADES.includes(c)) && five.every((c) => rc.PORTFOLIO_COLORS.includes(c))
    ? ok("detector read page.tsx; the tier rule moved to lib/restaurantColor.ts on 2026-10-04 — executed: 2 restaurants draw GREEN_SHADES, 5 draw the portfolio palette")
    : no(JSON.stringify({ two, five }));
});
await re("P05529", () => {
  const four = rc.GREEN_SHADES.length; const pal = [...rc.restaurantPalette(ids(3)).values()];
  return /GREEN_SHADES\[i % GREEN_SHADES\.length\]/.test(src("lib/restaurantColor.ts")) && pal.length === 3 && four === 3
    ? ok("index wraps modulo its length in lib/restaurantColor.ts restaurantPalette (moved there 2026-10-04)") : no("not wrapped");
});
await re("P05530", () => /cur: d <= lastComplete \?/.test(P) && /const lastComplete = todayDom - 1;/.test(P)
  ? ok("today is excluded: `cur` is null past lastComplete = todayDom − 1 (the detector pinned the pre-2026-10-04 wording)") : no("today plotted"));
await re("P100841", () => /export const GREEN_SHADES = \["#34d399", "#0f766e", "#a3e635"\];/.test(src("lib/restaurantColor.ts"))
  ? ok("GREEN_SHADES is still declared — it moved from app/owner/page.tsx to lib/restaurantColor.ts on 2026-10-04 so the shell and the page share one palette") : no("gone"));
await re("P05532", () => retired("RETIRED by the owner 2026-10-04 (like-for-like): last month is now clipped to the days this month has finished; it spans the whole of last month only on the 1st (`maxDay` fallback) — re-read today"));
await re("P05563", () => /const saved = snap\?\.cache\?\.\[`\$\{scopeKey\}\|\$\{range\}`\];/.test(P) && !/setCache\([^)]*snap/.test(P)
  ? ok("snapshot is read only as a fallback inside pl(); nothing writes it into `cache` (detector pinned an older line shape)") : no("snapshot written into cache"));
await re("P05587", () => /reserveSpark \? "" : " ow2-nospark"/.test(P)
  ? ok("ow2-nospark is still set — now on `spark === undefined` (item 13, 2026-09-17: the band is reserved from first paint), not on hasSpark") : no("nospark gone"));
await re("P05596", () => retired("SUPERSEDED SHAPE (its own title says so): the pop-up became the docket 2026-10-04 — the switched-off behaviour is re-asserted on the docket by T20 s10 P189226–P189228"));
await re("P05599", () => /const logsCardOn = ov\?\.entitlements\?\.logs !== false && !actsOff;/.test(P) && /\{logsCardOn && \(/.test(P)
  ? ok("the whole Recent-activity card (and its See all) is gated on `logs` via logsCardOn (T13 r2) — the detector looked for a gate on the link alone") : no("not gated"));
await re("P05644", () => (P.match(/restaurantColor\(/g) || []).length >= 4 && /restaurantColor\(r\.id, rows\.map/.test(P)
  ? ok("table dots, picker swatches, charts and the share bar all call restaurantColor(id, ids) — measured live by T20 s10 P189461 (swatch = dot)") : no("not shared"));
await re("P05650", () => {
  const strips = [...P.matchAll(/<PartialStrip keys=\{([^}]*(?:\}[^}]*)?)\}/g)].map((m) => m[1]);
  const scoped = strips.filter((k) => /filter\(\(k\) => k === "|\["deliveryApps"\]|\["records"\]/.test(k));
  return strips.length === scoped.length ? ok(`${strips.length} strips, every one scoped to its own key (the 6th is the Delivery apps card's own "deliveryApps", added 2026-10-11)`) : no(strips.join(" | "));
});
await re("P05663", () => (P.match(/Today is still in progress, so it joins tomorrow\./g) || []).length === 2
  ? ok("the caption is on BOTH month cards; reworded 2026-10-04 to 'Both lines cover the same N days… Today is still in progress'") : no("caption count wrong"));

await re("P67269", () => (P.match(/Today is still in progress, so it joins tomorrow\./g) || []).length === 2
  ? ok("both month cards still say why the green line stops before today — reworded 2026-10-04 to the like-for-like sentence, which the detector's old phrase no longer matched") : no("caption missing"));

// ── rows THIS run's own fixes moved (items 3, 5, 9) ───────────────────────────────────────────────
const BS = src("lib/backStack.ts");
await re("P05622", () => /useBackClose\("owner-rest-drawer"/.test(P) && /if \(e\.key !== "Escape" \|\| e\.isComposing\) return;/.test(BS)
  ? ok("the drawer still closes four ways; Escape now reaches it through its back-stack registration ALONE (T20 s10 item 9 removed the page's own listener, which closed a second layer) — driven: P189470") : no("a way out is gone"));
await re("P05623", () => !/addEventListener\("keydown"/.test(P) ? ok("no keydown listener is left behind: the drawer no longer adds one at all (item 9)") : no("a listener remains"));
await re("P20604", () => !/addEventListener\("keydown"/.test(P) ? ok("the tile sheet adds no keydown listener of its own any more (item 9) — nothing to leave behind; Escape is lib/backStack's") : no("a listener remains"));
await re("P20608", () => /\?\? "this restaurant"\)/.test(P) && /: restScopeText;/.test(P) && /const restScopeText = !ov\s*\?\s*"your restaurants"/.test(P)
  ? ok("`who` never renders undefined: one restaurant falls back to 'this restaurant', the estate now uses restScopeText (item 3), which says 'your restaurants' before the overview lands") : no("a fallback is gone"));
await re("P20620", () => /todayOrd && todayRev \? inr\(todayRev \/ todayOrd\) : "—"/.test(P)
  ? ok("the Today average is still guarded against zero — and no longer prints ₹0 for 'none paid yet' (item 5)") : no("unguarded"));

// ── replay-r2 (T12 round 2) — the pop-up is the docket now ─────────────────────────────────────
await re("P20605", () => /className="tdk-back" onClick=\{onClose\}/.test(TD) && /className="x" onClick=\{onClose\}/.test(TD) && /useBackClose\("owner-kpi-tile"/.test(P) && /if \(e\.key !== "Escape" \|\| e\.isComposing\) return;/.test(src("lib/backStack.ts"))
  ? ok("four ways out on the docket: backdrop + ✕ (TileDocket onClose), BACK and Escape (both through its back-stack registration since item 9) — driven live in every setup by T20 s10 P189009…P189180") : no("a way out is missing"));
await re("P20609", () => /\["Total expenses", inr\(expensesOut\), undefined, true\]/.test(P) && /className=\{`r\$\{total \? " total" : ""\}`\}/.test(TD) && /d\.rows\.find\(\(r\) => r\[3\]\)/.test(P)
  ? ok("isTotal is the explicit 4th field; TileDocket styles `.r.total` from it and the headline picks `r[3]`, never the last row") : no("total inferred"));
await re("P20613", () => /auditHref=\{d\.audit && ov\?\.entitlements\?\.logs !== false \? withPin\("\/owner\/activity"\) : undefined\}/.test(P)
  ? ok("the docket's Audit link is gated on the same `logs` entitlement") : no("ungated"));
await re("P20632", () => /\? <Link className="full" href=\{detailHref\}>/.test(TD) ? ok("footer is a plain <Link> with no onClick in TileDocket") : no("footer changed"));
await re("P20633", () => /: <span className="full off">\{detailOffNote \|\| "Reports are switched off for this restaurant"\}<\/span>/.test(TD) ? ok("Reports off → a plain sentence span, not a link") : no("dead link"));
await re("P20637", () => /\.tdk-wrap\{position:fixed;inset:0/.test(TD) ? ok("the docket wrap is position:fixed; inset:0 — computed live by T20 s10 P189004…") : no("not fixed"));
await re("P20638", () => /max-height:min\(90vh,780px\);overflow-y:auto/.test(TD) ? ok("the sheet scrolls inside itself (max-height 90vh / 92vh on a phone, overflow-y auto)") : no("no inner scroll"));
await re("P20639", () => /\.r\.total\{border-top:1px solid \$\{INK\};border-bottom:3px double \$\{INK\}/.test(TD) ? ok("the total row is a rule above and a double rule below, and bolder — never colour alone") : no("colour only"));
await re("P20640", () => /<button className="x" onClick=\{onClose\} aria-label="Close">/.test(TD) ? ok("✕ is a <button> with aria-label Close") : no("not labelled"));
await re("P20641", () => /v=\{dashed \? "—"/.test(P) && (P.match(/sub=\{dashed \? dashSub/g) || []).length === 5
  ? ok("all five tiles print — and the reason; the flag is `dashed` (offNote OR a failed overview, T13 r2 2026-09-05) — driven by T20 s10 P189226") : no("not five"));
await re("P20642", () => (P.match(/onOpen=\{dashed \? undefined/g) || []).length === 5 ? ok("no tile opens while dashed (offNote included) — driven by P189227") : no("a tile opens"));
await re("P20643", () => /pill=\{dashed \? undefined : "● live"\}/.test(P) ? ok("the live pill goes with it (dashed)") : no("pill survives"));
await re("P20644", () => (P.match(/loading=\{!dashed && !kMain\}/g) || []).length === 4 && /loading=\{!dashed && !ov\}/.test(P) ? ok("loading is false whenever dashed — four analytics tiles on !kMain, Today on !ov") : no("loading ignores the off state"));
await re("P20658", () => /const offSub = "Reports are switched off";/.test(P) && /const dashSub = offNote \? offSub :/.test(P) && (P.match(/sub=\{dashed \? dashSub/g) || []).length === 5 ? ok("one caption constant (offSub via dashSub) shared by all five") : no("worded five ways"));
await re("P20660", () => /if \(offScope && offScope\.scope === scopeKey\) return undefined;/.test(P) ? ok("pl() returns undefined for a refused scope before the snapshot is consulted") : no("snapshot leaks"));
await re("P20677", () => out.find((x) => x.id === "P05650")?.ok ? ok("same rule as P05650 — every strip scoped; the detector read the Delivery apps strip (2026-10-11) as unscoped") : no("see P05650"));
await re("P20678", () => !/PartialStrip keys=\{\(pl\(globalRange\) as RestA \| undefined\)\?\.partial\?\.filter\(\(k\) => k === "(categories|payments)"\)/.test(P)
  ? ok("the restaurant scope still has no categories/payments strip; its only partial keys are busyHours, deliveryApps and records") : no("a strip came back"));
await re("P20776", () => (P.match(/useBackClose\(/g) || []).length === 6 ? ok("6 back layers for 6 overlays (2 dropdowns, 2 drill levels, the docket, the drawer); the docket's dialog lives in TileDocket.tsx, which is why the detector counted 1 dialog") : no("count changed"));
await re("P20808", () => /\{logsCardOn && \(/.test(P) ? ok("withheld entirely ({logsCardOn && …}), and the grid drops to one column (ow2-one)") : no("rendered disabled"));
await re("P20828", () => /const restScopeText = !ov\s*\?[^:]+:\s*reportedCount === restCount/.test(P)
  ? ok("restScopeText still counts the REPORTED set (now behind an `!ov` guard, T13 r2). NOTE: the docket heading did NOT use it — it said 'all N restaurants' over figures covering fewer; fixed as T20 s10 item 3, driven by P189231") : no("caption overstates"));

// ── replay-r3 (T12 round 3) ──────────────────────────────────────────────────────────────────
await re("P40157", () => ["onOpen={dashed ? undefined", 'v={dashed ? "—"', "loading={!dashed && !ov}", "pill={dashed ? undefined"].every((g) => P.includes(g))
  ? ok("the Today tile's four guards move together on `dashed` (the detector looked for the older `offNote` name)") : no("a guard is missing"));
await re("P40158", () => /loading=\{!dashed && !ov\} pill=/.test(P) ? ok("loading cannot be true while dashed") : no("can animate a blank"));
await re("P40159", () => (P.match(/loading=\{!dashed && !kMain\}/g) || []).length === 4 ? ok("the other four share one loading rule") : no("diverged"));
await re("P40348", () => /\{logsCardOn && \(/.test(P) ? ok("still withheld (logsCardOn)") : no("rendered"));
await re("P40452", () => /restaurantColor/.test(P) && /restaurantColor/.test(src("components/owner/OwnerShell.tsx"))
  ? ok("both surfaces call restaurantColor() — portfolioColor became one tier of it on 2026-10-04 (lib/restaurantColor.ts)") : no("a surface keeps its own palette"));

// ── new-a-gate (T13 s8 band A) — item 37 and item 28 reshaped the layout ─────────────────────────
await re("P66729", () => /if \(acting && actingValid\)/.test(L) && /return <SignInBounce \/>;/.test(L) && !/if \(acting\) \{?\s*return/.test(L)
  ? ok("act-as needs BOTH the cookie and a valid admin token; a lone act-as cookie falls through to the sign-in bounce (item 37 replaced the final redirect with <SignInBounce/>)") : no("one half suffices"));
await re("P66730", () => /return <SignInBounce \/>;\s*\}\s*$/.test(L) && /window\.location\.replace\(`\/login\?next=\$\{encodeURIComponent\(here\)\}`\)/.test(SB)
  ? ok("the last statement sends every other visitor to the staff sign-in — via SignInBounce (item 37) — driven live by T20 s10 P189391…P189399") : no("no bounce"));
await re("P67500", () => /return <SignInBounce \/>;\s*\}\s*$/.test(L) && /window\.location\.replace\(`\/login\?next=/.test(SB)
  ? ok("a visitor with neither cookie still ends on the login — item 37 (2026-10-09) made the final bounce <SignInBounce/>, which carries the exact page; the detector looked for the old redirect() — driven live by T20 s10 P189391…P189399")
  : no("no final bounce"));
await re("P66731", () => /\/login\?next=\$\{encodeURIComponent\(here\)\}/.test(SB) && /redirect\("\/login\?next=\/owner"\)/.test(L)
  ? ok("both bounces carry next= (the signed-out one now carries the EXACT page, item 37)") : no("next lost"));
await re("P66736", () => /e instanceof AuthDbError \|\| e instanceof OwnedLookupFailed\) return <OwnerReconnecting \/>/.test(L)
  ? ok("a blip still lands on the reconnect screen — and now a failed owned-restaurants read does too (T17 r6)") : no("blip not caught"));
await re("P66737", () => /return <OwnerReconnecting \/>;\s*throw e;/.test(L) ? ok("anything else is rethrown") : no("swallowed"));
await re("P66742", () => /ents\.khata_book = \(await Promise\.all\(ownedIds\.map\(\(id\) => navOn\(khataLadder\(id\)\)\)\)\)\.some\(Boolean\);/.test(L)
  ? ok("Pay Later shows if ANY owned restaurant has it — the read is now wrapped in navOn() (item 28, 2026-10-11) so a blip hides it for one render instead of erroring") : no("rule changed"));
await re("P66743", () => /ents\.inventory = \(await Promise\.all\(ownedIds\.map\(\(id\) => navOn\(inventoryLadder\(id\)\)\)\)\)\.some\(Boolean\);/.test(L)
  ? ok("Inventory follows the same any-restaurant rule, through navOn()") : no("rule changed"));

const j = process.argv.find((a) => a.startsWith("--json="));
if (j) { mkdirSync(dirname(j.slice(7)), { recursive: true }); writeFileSync(j.slice(7), JSON.stringify(out, null, 1)); }
for (const r of out) console.log(`${r.ok === true ? "✅" : r.ok === false ? "❌" : "⏭"} ${r.id} ${r.note.slice(0, 150)}`);
console.log(`\n${out.filter((r) => r.ok === true).length} ✅ · ${out.filter((r) => r.ok === false).length} ❌ · ${out.filter((r) => r.ok === null).length} ⏭ of ${out.length}`);
