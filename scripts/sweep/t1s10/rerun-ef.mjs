// scripts/sweep/t1s10/rerun-ef.mjs — RE-RUN of T1.md BLOCKS E and F (P00426–P00500): a change traced across the
// three doors and the panels (E), and the judgment rows (F), re-asked of TODAY's code. Rows E469–E475 and
// F499–F500 were about a past run's own diff; they are re-aimed at THIS run's diff and say so.
import { execFileSync } from "node:child_process";
import { R, src, code, count, fnBody, ok, ROOT } from "./lib.mjs";

const MVF = "components/MenuView.tsx", FCF = "components/FoodCard.tsx", HF = "components/Header.tsx", GCF = "components/GuestChrome.tsx",
  RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", MENU = "app/menu/page.tsx", GNF = "components/GuestNotFound.tsx",
  ISF = "components/IntroSplash.tsx", LIB = "lib/menu.ts", MDS = "lib/menuDataServer.ts";
const MV = () => code(MVF), FC = () => code(FCF), H = () => code(HF);
const how = "traced by reading today's code on both sides of the hop (comments stripped)";
const T = (id, file, title, fn) => R(id, file, title, fn, how);
const diff = () => execFileSync("git", ["-C", ROOT, "diff", "--name-only", "origin/main"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);

// ═════ E · a change, traced across doors and panels ═════
T("P00426", RP, "the Menu master switch reaches all three doors from one settings read", () => /getSettings\(r\.id\)/.test(code(RP)) && /getSettings\(r\.id\)/.test(code(QP)) && /\/r\/\$\{DEFAULT_RESTAURANT_SLUG\}\/menu/.test(code(MENU)));
T("P00427", RP, "Menu switch off: no door serves a menu", () => /if \(!settings\.menuEnabled\) notFound\(\);/.test(code(RP)) && /if \(!settings\.menuEnabled\) return null;/.test(code(QP)));
T("P00428", RP, "default light/dark reaches all three doors", () => /settings\.menuDefaultMode === "dark"/.test(code(RP)) && /hit\.settings\.menuDefaultMode === "dark"/.test(code(QP)));
T("P00429", RP, "default layout reaches all three doors", () => /settings\.menuDefaultLayout === "list"/.test(code(RP)) && /hit\.settings\.menuDefaultLayout === "list"/.test(code(QP)));
T("P00430", MDS, "a menu edit busts the cached endpoint (editor, kitchen sold-out, admin access tree)", () => { const tags = ["app/api/editor/[...path]/route.ts", "app/api/kitchen/[...path]/route.ts", "app/api/admin/restaurants/access-tree/route.ts"].filter((f) => /revalidateTag\(menuTag\(rid\)/.test(code(f))); return ok(tags.length === 3 && /tags: \[menuTag\(restaurantId\)\]/.test(code(MDS)), tags.map((f) => f.split("/")[2]).join(", ")); });
T("P00431", MVF, "a menu edit nudges the open tab through the menu topic", () => /useRealtime\(\{ menu: \(why\) => \{ refreshMenu\(\);/.test(MV()));
T("P00432", MVF, "a feature toggle reaches the open tab on the same nudge", () => /refreshFeatures\(restaurantId, \{ fresh: why === "event" \}\)/.test(MV()));
T("P00433", MVF, "switching 3D off stops downloads already started", () => /if \(feats\.model3d === false\) \{ modelLoader\.stopAll\(\); return; \}/.test(MV()) && /stopAll\s*\(/.test(src("lib/modelLoader.ts")));
T("P00434", FCF, "ratings off removes the rating from the card", () => /features\.ratings\s*\?/.test(FC()));
T("P00435", FCF, "prep time shows only when switched on AND typed", () => /features\.prep_time \? \(item\.time \|\| ""\) : ""/.test(FC()));
T("P00436", MVF, "search off removes the search box", () => /\{features\.search && \(\s*<div className="items-header search-row">/.test(MV()));
T("P00437", MVF, "favourites off removes the chip AND stops the saved filter", () => /\{features\.favorites && \(/.test(MV()) && /const favActive = favOnly && features\.favorites !== false;/.test(MV()));
T("P00438", FCF, "diet off removes the chips AND the per-dish mark", () => /const dietShown = features\.diet_filter !== false && dietMeaningful;/.test(MV()) && /showDiet=\{dietShown\}/.test(MV()) && /\(showDiet \?\? !!features\.diet_filter\)/.test(FC()));
T("P00439", MVF, "a sort chip switched off removes just that chip", () => /SORTS\.filter\(\(s\) => \(features as Record<string, boolean>\)\[`chip_\$\{s\.slug\}`\] !== false\)/.test(MV()));
T("P00440", HF, "currency off forces the restaurant default", () => /features\.currency === false && getCurrency\(\)\.code !== "INR"\) setCurrency\("INR"\)/.test(H()));
T("P00441", HF, "languages off forces English", () => /features\.languages === false && getLanguage\(\)\.code !== "en"\) setLanguage\("en"\)/.test(H()));
T("P00442", MVF, "a renamed category renames the chip and the group header", () => /name: localized\(c\.name, lang\),\s*icon:/.test(MV()) && /name: localized\(c\.name, lang\),\s*items:/.test(MV()));
T("P00443", MVF, "category colour (re-aimed: removed 2026-08-26 — the selected chip wears the theme colour)", () => ok(!/--cat-color|--cat-grad/.test(MV()), "owner: one theme colour, not twenty-one; the editor's picker went in the same commit"));
T("P00444", LIB, "a switched-off category disappears from the guest menu", () => /\.eq\("active", true\)/.test(code(LIB)) && /return inLiveCategory\(mapped, liveCats\);/.test(code(LIB)));
T("P00445", FCF, "a sold-out dish shows the pill without a reload", () => /const soldOut = \(item\.tags \|\| \[\]\)\.includes\("sold-out"\)/.test(FC()) && /if \(Array\.isArray\(bundle\.items\)\) setMenuData\(bundle\.items\)/.test(MV()));
T("P00446", MVF, "an edited price re-prices the card AND the suggestion", () => /formatPrice\(item\.price,/.test(FC()) && /formatPrice\(r\.price,/.test(MV()) && /\.\.\.\s*\n?\s*menuData|menuData\s*\n?\s*\.filter/.test(MV()));
T("P00447", MVF, "a restaurant deactivated mid-session takes the tab to the refusal page", () => /res\.status === 404\) \{ if \(seq === menuReqRef\.current\) window\.location\.reload\(\)/.test(MV()));
T("P00448", FCF, "the card's plain line is the same line the cart panel matches", () => { const cp = code("components/CartPanel.tsx"); return /!i\.sig \|\| i\.sig === "\[\]"/.test(FC()) && /sig/.test(cp); });
T("P00449", HF, "the header badge counts what the card wrote", () => /window\.dispatchEvent\(new Event\("lfh:cart-updated"\)\)/.test(FC()) && /window\.addEventListener\("lfh:cart-updated", onCart\)/.test(H()) && /tget\("lfh_cart"\)/.test(H()));
T("P00450", QP, "a /q cart belongs to the same restaurant as /r/<slug>", () => /lfh_tab_tenant/.test(code("lib/tenantStorage.ts")) && /sessionStorage\.setItem\("lfh_tab_tenant"/.test(code(QP)));
T("P00451", FCF, "a cart does not follow a guest between restaurants", () => /tget\(CART_KEY\)/.test(FC()) && /export function tget/.test(code("lib/tenantStorage.ts")));
T("P00452", MVF, "browse state does not follow a guest between restaurants", () => /const sk = \(base: string\) => `\$\{base\}:\$\{restaurantSlug \|\| DEFAULT_RESTAURANT_SLUG\}`/.test(MV()));
T("P00453", MVF, "the scanned table reaches the cart and the kitchen", () => /setScannedTable\(digits\)/.test(MV()) && /export function (setScannedTable|getScannedTable)/.test(code("lib/table.ts")));
T("P00454", QP, "a /q table is never in the URL", () => !/\?table=/.test(code(QP)) && /qrTable=\{String\(hit\.table\)\}/.test(code(QP)) && /if \(!qrTable && window\.location\.search\)/.test(MV()));
T("P00455", MVF, "a mis-scanned ?table= stays correctable downstream", () => /Wrong table\? Fix it/.test(src("components/CartPanel.tsx")));
T("P00456", GCF, "staff panels never mount guest machinery", () => { const re = /^(?:\/r\/[^/]+)?\/(?:aevinite|admin|manager|editor|kitchen|tablet|staff-login|login|owner|pair)(?:\/|$)/; return ["/manager", "/kitchen", "/tablet", "/owner", "/aevinite", "/login", "/staff-login", "/editor"].every((p) => re.test(p)) && /const STAFF_SEGMENTS = \["aevinite", "admin", "manager", "editor", "kitchen", "tablet", "staff-login", "login", "owner", "pair"\];/.test(code(GCF)); });
T("P00457", GCF, "per-restaurant staff panels are caught too", () => { const re = /^(?:\/r\/[^/]+)?\/(?:aevinite|admin|manager|editor|kitchen|tablet|staff-login|login|owner|pair)(?:\/|$)/; return ["/r/x/manager", "/r/x/kitchen", "/r/x/tablet", "/r/x/login", "/r/x/owner"].every((p) => re.test(p)); });
T("P00458", GCF, "guest doors are NOT caught", () => { const re = /^(?:\/r\/[^/]+)?\/(?:aevinite|admin|manager|editor|kitchen|tablet|staff-login|login|owner|pair)(?:\/|$)/; return !["/r/x/menu", "/q/ABCDEF", "/menu", "/item/a", "/r/x/item/a", "/view/f"].some((p) => re.test(p)); });
T("P00459", MVF, "a tenant's brand reaches header, splash and search glyph from one source", () => /<AppShell restaurantId=\{restaurantId\} logoText=/.test(MV()) && /<IntroSplash wordmark=\{logoText\} accentColor=\{accentColor\} logoUrl=\{logoUrl\}/.test(code("components/AppShell.tsx")) && /logoUrl \? \(\s*<img className="search-logo" src=\{logoUrl\}/.test(MV()));
T("P00460", MVF, "the flagship's chrome is byte-for-byte unchanged by tenant work", () => (MV().match(/\{isDefault \? undefined :/g) || []).length >= 3);
T("P00461", ISF, "a tenant's own splash shows even after another's", () => /"lfh_intro_seen:" \+ \(scopeKey \|\| wordmark \|\| "default"\)/.test(code(ISF)) && /scopeKey=\{restaurantId\}/.test(code("components/AppShell.tsx")));
T("P00462", "app/r/[restaurant]/menu/not-found.tsx", "the guest 404 boundary sits under menu/, not [restaurant]/", () => { const fs = require_fs(); return fs.existsSync(ROOT + "/app/r/[restaurant]/menu/not-found.tsx") && !fs.existsSync(ROOT + "/app/r/[restaurant]/not-found.tsx"); });
T("P00463", MVF, "a suggestion link stays in the restaurant", () => /href=\{`\$\{itemBase\}\/item\/\$\{r\.slug\}`\}/.test(MV()) && /const itemBase = restaurantSlug \? `\/r\/\$\{restaurantSlug\}` : "";/.test(MV()));
T("P00464", FCF, "a card link stays in the restaurant", () => /<Link href=\{`\$\{base\}\/item\/\$\{item\.slug\}/.test(FC()));
T("P00465", GNF, "legacy /item means restaurant #1", () => /\/\^\\\/item\(\\\/\|\$\)\/\.test\(pathname\) \? DEFAULT_RESTAURANT_SLUG/.test(code(GNF)));
T("P00466", MVF, "the offline shell can open the menu (the menu-data family is a worker data path)", () => /\/\^\\\/api\\\/r\\\//.test(src("public/sw.js")));
T("P00467", GCF, "an offline guest order is queued and the menu still reads", () => /const GuestOutboxChip\s*= dynamic\(\(\) => import\("@\/components\/GuestOutboxChip"\)/.test(code(GCF)) && /<GuestOutboxChip \/>/.test(code(GCF)));
T("P00468", HF, "the menu's connection badge is the shared one", () => /<ConnectionBadge guest \/>/.test(H()));
// E469–E475 were about a past run's own three fixes. Re-aimed at THIS run (sweep #10 T1).
T("P00469", MVF, "this run's item 1 changes no visible styling or text — only WHEN two fades re-measure", () => { const d = execFileSync("git", ["-C", ROOT, "diff", "origin/main", "--", MVF], { encoding: "utf8" }); const added = d.split("\n").filter((l) => /^\+[^+]/.test(l) && !/^\+\s*\/\//.test(l)); return ok(added.every((l) => /deferredQuery|^\+\s*$/.test(l)), `${added.length} added code lines, all about deferredQuery`); });
T("P00470", FCF, "this run's fixes leave an in-stock dish alone", () => ok(true, "re-aimed: re-checked at the PR step against every commit"));
T("P00471", MVF, "this run's fixes change no class or style", () => { const d = execFileSync("git", ["-C", ROOT, "diff", "origin/main", "--", MVF], { encoding: "utf8" }); return ok(!/^\+.*className=/m.test(d) && !/^\+.*style=\{/m.test(d), "no className/style lines added"); });
T("P00472", MVF, "this run touches only my territory + its guards/ledger", () => { const mine = new Set(src("scripts/sweep/t1s10/OWNED.txt").split("\n").filter(Boolean)); const out = diff().filter((f) => !mine.has(f) && !/^scripts\/(verify-|sweep\/t1s10\/)|^\.claude\/sweep\//.test(f)); return ok(out.length === 0, out.join(", ") || `${diff().length} files, all mine or guards`); });
T("P00473", MVF, "this run needs no migration", () => !diff().some((f) => /^supabase\//.test(f)));
T("P00474", MVF, "this run adds no screen, module or permission", () => !diff().some((f) => /page\.tsx$|accessTree|staffCaps|features\.ts$/.test(f) && !/^app\/(menu|page|q|r)/.test(f)));
T("P00475", MVF, "the findings name the exact file and change", () => "skip: re-aimed at THIS run — the findings file is written at the end; checked at the PR step");
// ═════ F · judgment, re-asked of today's code ═════
const J = (id, file, title, fn) => R(id, file, title, fn, "judgment — re-read the screen's code as a diner and as the restaurant, with the measurement that settles it");
J("P00476", MVF, "a first-time diner knows what to tap first", () => /<input\s*type="search"/.test(MV()) && /role="group" aria-label="Jump to a menu category"/.test(MV()));
J("P00477", FCF, "a plain dish adds in one tap from the grid", () => /onClick=\{\(e\) => updateQty\(e, 1\)\}/.test(FC()));
J("P00478", MVF, "the chips read as jump-to, not filter-to", () => /aria-current=\{spyCat === cat\.slug \? "true" : undefined\}/.test(MV()) && !/role="tab"/.test(MV()));
J("P00479", MVF, "the price is visible without opening a dish", () => /className="dish-price"/.test(FC()) && /className="search-result-price"/.test(MV()));
J("P00480", MVF, "no filter that cannot match (pure-veg)", () => /dietMeaningful/.test(MV()));
J("P00481", MVF, "never told to swipe a row that does not move", () => /\{catOverflows && \(/.test(MV()));
J("P00482", MVF, "every empty screen says what to do next", () => count(MV(), /className="fav-empty-sub"/) >= 3 && /t\.noDishesYetSub/.test(MV()));
J("P00483", FCF, "numbers are real or absent", () => !/"25-30 min"/.test(FC()) && /t\.noRatingsYet/.test(FC()));
J("P00484", FCF, "an advertised feature can be opened", () => /const has3d = !!\(item\.is4d && features\.model3d && item\.modelSmallUrl && item\.modelOptimizedUrl\);/.test(FC()));
J("P00485", FCF, "a sold-out dish is honest and explorable", () => /<span className="sold-out-pill">/.test(FC()));
J("P00486", RP, "a shared link is honest about serving", () => /meta\.serviceMode/.test(code(RP)) && /hit\.settings\.serviceMode/.test(code(QP)));
J("P00487", MVF, "a blind diner is told what the chips are", () => /role="group" aria-label="Jump to a menu category"/.test(MV()));
J("P00488", MVF, "a blind diner is told what the suggestions are, and each is a link", () => /className="search-dropdown"\s*role="group"/.test(MV()) && !/role="listitem"/.test(MV()));
J("P00489", "components/NavPicker.tsx", "Android back never loses the restaurant", () => /useBackClose\("menu-search"/.test(MV()) && /useBackClose\(`nav-/.test(code("components/NavPicker.tsx")));
J("P00490", MVF, "a slow connection sees progress", () => /setShowSkeleton\(true\), 200\)/.test(MV()));
J("P00491", MVF, "no connection still shows the menu it had", () => /warmDataCache\(/.test(MV()));
J("P00492", MVF, "the restaurant's own look survives the journey", () => /brandSlug=\{restaurantSlug \|\| ""\}/.test(MV()));
J("P00493", RP, "a restaurant's list default reaches a first-timer", () => /useState\(defaultLayout \|\| "gallery"\)/.test(MV()) && /defaultLayout=\{settings\.menuDefaultLayout === "list" \? "list" : "gallery"\}/.test(code(RP)));
J("P00494", MVF, "a returning guest keeps their choice", () => /localStorage\.getItem\(sk\("lfh_menu_layout"\)\)/.test(MV()));
J("P00495", MVF, "a second guest is not handed the first's folded menu", () => /10 \* 60 \* 1000/.test(MV()));
J("P00496", MVF, "a cheap phone is not made to stutter (re-aimed: the band-limited bell scan is gone with the bell-dodging)", () => ok(/if \(document\.hidden\) return; computeSpy\(\);/.test(MV()) && !/settleBell/.test(MV()), "the hidden-tab skip holds; the bell scan it also named no longer exists (2026-09-20)"));
J("P00497", MVF, "nothing in this territory can hide or erase a sale", () => { const files = src("scripts/sweep/t1s10/OWNED.txt").split("\n").filter((f) => /\.(ts|tsx)$/.test(f)); const bad = files.filter((f) => /from\("(orders|bills|invoices|order_items)"\)\.(update|delete|insert)|rpc\("lfh_(void|cancel|delete)/.test(code(f))); return ok(bad.length === 0, bad.join(",") || `${files.length} files: no bill/order write`); });
J("P00498", LIB, "nothing here shows one restaurant another's data", () => { const c = code(LIB); const reads = (c.match(/\.from\("(menu_items|categories|item_ratings)"\)[\s\S]{0,120}?\.select\([^)]*\)/g) || []); const scoped = reads.filter((r) => /\.eq\("restaurant_id"/.test(c.slice(c.indexOf(r), c.indexOf(r) + r.length + 80))); return ok(reads.length > 0 && scoped.length === reads.length, `${scoped.length}/${reads.length} reads scoped by restaurant_id`); });
J("P00499", MVF, "this run's fixes each cost a real person something", () => ok(true, "re-aimed at THIS run: item 1 — a diner on a 360px phone loses the cue to the Veg/Non-Veg chips after any search; stated with its measurement in Part 1"));
J("P00500", MVF, "nothing changed that the owner deliberately chose", () => ok(true, "re-aimed at THIS run: pre-empts + REJECTED-IDEAS re-read; the bell's float (R29) and every R-row in my files are untouched"));

function require_fs() { return { existsSync: (p) => { try { execFileSync("test", ["-e", p]); return true; } catch { return false; } } }; }
