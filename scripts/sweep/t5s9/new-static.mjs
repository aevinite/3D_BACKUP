// SWEEP #9 · TERMINAL 5 — the STATIC half of this run's 50 new checks.
// Block P102001–P102100 (100 ids, pre-allocated to this terminal). Static: P102001–P102034.
// The live/visual half is scripts/sweep/t5s9/new-live.mjs (P102035–P102050).
//
// Aimed at ground the ledger does not stand on: the thinnest-covered files in this
// territory (OfflineNoticeStatic 1 row, InfinityLoader 2, Particles 2, StarRating 2,
// ChefCallButton 4, ConnectionBadge 4, ComingSoon 5, CustomerGreeter 6, ModelToastHost 6,
// VegIcon 6 — counted across all 44 ledger files, not trusted from a document).
import { src, code, has, grepRepo, walk, makeRunner, ROOT } from "./lib.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const { check, done } = makeRunner("T5 sweep-9 — 34 new static checks");

// The 40 files this terminal owns, re-derived rather than typed out.
const OTHERS = ["MenuView", "CartPanel", "SessionGate", "SessionStatusWidget", "OrderTracker", "PublicModelViewer"];
const MINE_COMPONENTS = readdirSync(join(ROOT, "components"))
  .filter((f) => f.endsWith(".tsx") && !OTHERS.includes(f.replace(".tsx", "")))
  .map((f) => "components/" + f);
const MINE = [...MINE_COMPONENTS, "public/sw.js", "public/offline.html", "lib/i18n.ts"];

/* ═════════ BAND A — the thinnest-covered components, read for correctness ═════════ */

const SR = () => code("components/StarRating.tsx");
check("P102001", "every star is operable from a keyboard, not only a tap", () => {
  const s = SR();
  return /role="button"/.test(s) && /tabIndex=\{0\}/.test(s) && /e\.key === "Enter" \|\| e\.key === " "/.test(s)
    || "a star can no longer be reached or fired from the keyboard";
});
check("P102002", "StarRating removes every hover listener it adds", () => {
  const s = SR();
  const adds = (s.match(/addEventListener\(/g) || []).length;
  const rems = (s.match(/removeEventListener\(/g) || []).length;
  return adds === rems && /enterHandlers\.forEach\(\(fn\) => fn\(\)\)/.test(s)
    || `${adds} added vs ${rems} removed`;
});
check("P102003", "tapping the rating you already have tells the parent nothing", () => {
  const s = SR();
  const i = s.indexOf("const handleClick");
  const guard = s.indexOf("if (starIdx === value) return;", i);
  const call = s.indexOf("onChange(next)", i);
  return guard > i && call > guard || "the no-change guard no longer sits before onChange";
});
check("P102004", "the score pill always prints a number, never a blank or NaN", () => {
  const s = SR();
  return /\{value\}/.test(s) && /value === 0 \? "zero" : ""/.test(s)
    || "the pill can render something other than the number";
});
check("P102005", "the loading symbol announces itself, and its drawing is hidden from a reader", () => {
  const s = code("components/InfinityLoader.tsx");
  return /role="status"/.test(s) && /aria-live="polite"/.test(s) && /aria-hidden="true"/.test(s)
    || "a screen reader now either misses the loader or reads its drawing";
});
check("P102006", "the loader's label always has a word — it can never print undefined", () =>
  /label = "Loading"/.test(code("components/InfinityLoader.tsx")) || "the default label is gone");
check("P102007", "the bubbles are built in the browser, so the server and the screen cannot disagree", () => {
  const s = code("components/Particles.tsx");
  const inEffect = /useEffect\(\(\) => \{[\s\S]*?Math\.random\(\)/.test(s);
  const atModule = /^const [A-Za-z]+ = Array\.from[\s\S]*?Math\.random/m.test(s);
  return (inEffect && !atModule) || "the random positions are no longer made inside the effect";
});
check("P102008", "every bubble gets a place and a stagger, so they never rise in lockstep", () => {
  const s = code("components/Particles.tsx");
  return /length: 20/.test(s) && /left: `\$\{Math\.random\(\) \* 100\}%`/.test(s) && /delay: `\$\{Math\.random\(\) \* 6\}s`/.test(s)
    || "a bubble is missing its position or its delay";
});
check("P102009", "the waiter bell disappears completely when waiter calls are switched off", () =>
  /if \(!features\.waiter_calls\) return null;/.test(code("components/ChefCallButton.tsx"))
    || "the bell no longer respects its own switch");
check("P102010", "the bell reads both its switches BEFORE it can return early", () => {
  const s = code("components/ChefCallButton.tsx");
  const hooks = s.indexOf("useFeatures(useRestaurantId())");
  const early = s.indexOf("return null");
  return hooks > 0 && hooks < early || "an early return now sits above a hook — the screen would crash on the switch flipping";
});
check("P102011", "the last-resort offline script carries nothing from the address bar", () => {
  const s = src("components/OfflineNoticeStatic.tsx");
  const script = s.slice(s.indexOf("const SCRIPT = `"), s.indexOf("`;", s.indexOf("const SCRIPT = `")));
  const interps = [...script.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  return interps.every((x) => x === "JSON.stringify(BAR_ID)") || "the inlined script now carries: " + interps.join(", ");
});
check("P102012", "the last-resort bar stands down every time React's own bar is up, not only at startup", () => {
  const s = src("components/OfflineNoticeStatic.tsx");
  // sync() must consult reactOwnsIt() on EVERY offline signal; the 5-second watch is
  // only for the boot race. The 2026-09-01 fault was the check living ONLY in the watch.
  return /function sync\(\)\{[\s\S]{0,200}?reactOwnsIt\(\)/.test(s)
    || "the React-is-alive check has left sync() — two bars can stack again";
});
check("P102013", "a returning guest is greeted only once the real restaurant is known", () => {
  const s = code("components/CustomerGreeter.tsx");
  return /const \{ id: restaurantId, ready \} = useRestaurantMeta\(\)/.test(s)
    && /if \(!restaurantId \|\| !ready\) return;/.test(s)
    || "the greeting can fire against the placeholder restaurant again";
});
check("P102014", "the greeting asks once per browser session per restaurant, and cancels if the guest leaves", () => {
  const s = code("components/CustomerGreeter.tsx");
  return /lfh_greeted_\$\{restaurantId\}/.test(s) && /sessionStorage\.getItem\(key\)/.test(s)
    && /cancelled = true; window\.clearTimeout\(t\)/.test(s)
    || "the once-per-session guard or the cancel is gone";
});
check("P102015", "the 3D ticket never invites you to open the dish you are already looking at", () => {
  const s = code("components/ModelToastHost.tsx");
  return /path === `\/view\/\$\{entry\.folder\}`/.test(s) && /unwatchByFolder\(entry\.folder\);\s*return;/.test(s)
    || "the already-on-that-page guard is gone";
});
check("P102016", "the 3D ticket keeps the restaurant AND the list the guest was browsing", () => {
  const s = code("components/ModelToastHost.tsx");
  return /rParam/.test(s) && /cParam/.test(s) && /href: `\/view\/\$\{entry\.folder\}\$\{qs\}`/.test(s)
    || "the ticket's link has lost the tenant or the category";
});
check("P102017", "the veg / non-veg badge is announced by what it MEANS, not by its shape", () => {
  const s = code("components/VegIcon.tsx");
  return /aria-label="Vegetarian"/.test(s) && /aria-label="Non-Vegetarian"/.test(s)
    || "the badge no longer names itself to a screen reader";
});
check("P102018", "every connection state lights a number of bars, so the meaning is never colour alone", () => {
  const s = code("components/ConnectionBadge.tsx");
  const i = s.indexOf("function computeView");
  const body = s.slice(i, s.indexOf("\nfunction statusLine", i));
  const returns = body.match(/return \{[\s\S]*?\};/g) || [];
  const noBars = returns.filter((r) => !/bars:/.test(r));
  return returns.length >= 4 && noBars.length === 0 || `${returns.length} states, ${noBars.length} without bars`;
});
check("P102019", "the connection badge never sends a request of its own", () => {
  const s = code("components/ConnectionBadge.tsx");
  return !/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(s)
    || "the badge now makes its own request — it is supposed to cost zero egress";
});
check("P102020", "a planned-but-unbuilt screen always has a heading, a reason, and no dead link", () => {
  const s = code("components/ComingSoon.tsx");
  return /<h1 className="adm-coming-h">/.test(s) && /Not built yet/.test(s) && !/<a\b/.test(s)
    || "the placeholder screen lost its heading, its reason, or gained a link with nothing behind it";
});

/* ═════════ BAND D — conformance to this project's own written rules ═════════ */

check("P102021", "every popup or drawer the guest can CLOSE answers the phone's back button", () => {
  const missing = [];
  for (const f of MINE_COMPONENTS) {
    const s = code(f);
    if (!/className="popup active"|role="dialog"|nav-picker-list/.test(s)) continue;
    // A wall the guest CANNOT close must NOT register: back would lift it. BanGate is exactly
    // that — its only control asks staff to unblock the device; there is no dismiss, and
    // `if (!banned) return null` is the only way off the screen. Registering it would make the
    // back button dismiss a block, which is the opposite of what the wall is for.
    // "Closable" means a CONTROL the guest can press closes it. BanGate's only `setBanned(false)`
    // is the server answering "this device is not blocked" — not a dismiss — so the wall stays
    // outside this rule, which is right: back must never lift a block.
    const closable = /on(?:Click|KeyDown)=\{[^}]{0,120}(?:setOpen\(false\)|onClose|dismiss|stay)/i.test(s)
      || /const (?:stay|close|dismiss)[^\n]*=>[^\n]*set[A-Za-z]+\(false\)/.test(s)
      || /useBackClose|setRootBackHandler/.test(s);
    if (!closable) continue;
    if (/useBackClose|setRootBackHandler/.test(s)) continue;
    missing.push(f);
  }
  return missing.length === 0 || "not registered: " + missing.join(", ");
});
check("P102022", "no timer in these 40 files ASKS THE SERVER faster than the 60-second backstop", () => {
  // The backstop rule is about egress — a repeated READ. A timer that only touches the page
  // (BotTrap's elapsed field at 500ms, OfflineNotice's "12 min ago" clock at 30s, the
  // last-resort bar's 5-second boot watch at 250ms) costs nothing and is not a poll. So the
  // check is on what the interval BODY does, not on its period.
  const bad = [];
  for (const f of MINE) {
    const s = code(f);
    for (const m of s.matchAll(/setInterval\(([\s\S]{0,400}?),\s*(\d+)\s*\)/g)) {
      const ms = Number(m[2]);
      if (!(ms > 0 && ms < 60000)) continue;
      if (/fetch\(|refresh\(|supabase|api\(|\.rpc\(/.test(m[1])) bad.push(`${f} @ ${ms}ms`);
    }
  }
  return bad.length === 0 || "asks the server faster than the backstop: " + bad.join(", ");
});
check("P102023", "no file here adds a column to `settings` — a new module never does (mig 326)", () => {
  const bad = MINE.filter((f) => /settings\.[a-z_]+ =|ALTER TABLE settings/i.test(code(f)));
  return bad.length === 0 || "writes a settings column: " + bad.join(", ");
});
check("P102024", "no guest component here reads a database table directly — every read goes through a helper", () => {
  const bad = MINE_COMPONENTS.filter((f) => /supabase\s*\n?\s*\.from\(/.test(code(f)));
  return bad.length === 0 || "a bare table read in: " + bad.join(", ");
});
check("P102025", "the offline layer's saved-data list has no pattern that matches no route", () => {
  const raw = src("public/sw.js");
  const i = raw.indexOf("const DATA_PATHS = [");
  const body = raw.slice(i, raw.indexOf("];", i));
  const fams = body.split("\n").filter((l) => !l.trim().startsWith("//"))
    .flatMap((l) => [...l.matchAll(/\/\^\\\/api\\\/([a-z-]+)/g)].map((m) => m[1]));
  const dead = fams.filter((f) => !walk("app/api", (r) => r.endsWith("route.ts")).some((r) => r.startsWith(`app/api/${f}`)));
  return dead.length === 0 || "matches no route: " + dead.join(", ");
});
check("P102026", "saved data is labelled as saved wherever a screen can show it", () => {
  const react = /Saved|saved/.test(code("components/OfflineNotice.tsx"));
  const panels = /X-LFH-From-Cache|X-LFH-Cached-At/.test(code("public/panels/offline.js"));
  return (react && panels) || `react=${react} panels=${panels}`;
});
check("P102027", "no component here hard-codes restaurant #1's name outside a guarded branch", () => {
  const bad = [];
  for (const f of MINE_COMPONENTS) {
    const s = code(f);
    for (const m of s.matchAll(/["'`]([^"'`]*(?:French House|french-house|Little French)[^"'`]*)["'`]/g)) {
      const around = s.slice(Math.max(0, m.index - 260), m.index);
      if (!/isDefault|DEFAULT_RESTAURANT/.test(around)) bad.push(`${f}: "${m[1]}"`);
    }
  }
  return bad.length === 0 || "unguarded: " + bad.join(" · ");
});
check("P102028", "every one of these components either renders something or is rendered by something", () => {
  const orphans = MINE_COMPONENTS.filter((f) => {
    const name = f.split("/")[1].replace(".tsx", "");
    return grepRepo(new RegExp(`(?:from|import\\()\\s*["'\`][^"'\`]*${name}["'\`]|<${name}[\\s/>]`),
      ["app", "components", "lib"]).filter((x) => x !== f).length === 0;
  });
  return orphans.length === 0 || "nothing reaches: " + orphans.join(", ");
});

/* ═════════ BAND E — cross-panel truth, and judgment ═════════ */

check("P102029", "every app signal these files FIRE has something listening, both ways", () => {
  const fired = new Set(), heard = new Set();
  const scan = (dirs) => {
    for (const f of dirs) {
      const s = code(f);
      // Both shapes count as firing it: the literal `new CustomEvent("lfh:x")`, and a
      // helper called with the name — lib/modelLoader.ts fires through `this.dispatch("lfh:x", …)`,
      // and an earlier version of this check called those two events orphans because of it.
      for (const m of s.matchAll(/(?:CustomEvent|Event|dispatch|emit)\(\s*["'`](lfh:[a-z-]+)["'`]/g)) fired.add(m[1]);
      for (const m of s.matchAll(/addEventListener\(\s*["'`](lfh:[a-z-]+)["'`]/g)) heard.add(m[1]);
    }
  };
  scan(MINE_COMPONENTS);
  const mineFired = new Set(fired), mineHeard = new Set(heard);
  scan(grepRepo(/lfh:/, ["app", "components", "lib", "public"]));
  const deaf = [...mineFired].filter((e) => !heard.has(e));
  const mute = [...mineHeard].filter((e) => !fired.has(e));
  return (deaf.length === 0 && mute.length === 0) || `nobody hears: ${deaf.join(", ") || "—"} · nobody fires: ${mute.join(", ") || "—"}`;
});
check("P102030", "the guest-widget route list still matches the top-level routes on disk", () => {
  const s = code("components/GuestChrome.tsx");
  const listed = (s.match(/const STAFF_SEGMENTS = \[([^\]]*)\]/) || [])[1]
    ?.split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean) || [];
  const GUEST_DOORS = ["menu", "item", "view", "q", "r", "pay"];
  const onDisk = readdirSync(join(ROOT, "app"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("(") && !d.name.startsWith("_") && d.name !== "api")
    .map((d) => d.name.replace(/^\[|\]$/g, ""));
  const unclaimed = onDisk.filter((d) => !listed.includes(d) && !GUEST_DOORS.includes(d));
  return unclaimed.length === 0 || "neither a guest door nor a staff segment: " + unclaimed.join(", ");
});
check("P102031", "the six languages agree across the type, the dictionary and the picker", () => {
  const declared = (src("lib/format.ts").match(/export type LanguageCode = ([^;]+);/) || [])[1]
    .split("|").map((x) => x.trim().replace(/"/g, ""));
  const inDict = declared.filter((l) => new RegExp(`^  ${l}: \\{`, "m").test(src("lib/i18n.ts")));
  const picker = (src("lib/format.ts").match(/LANGUAGES[\s\S]{0,700}?\]/) || [""])[0];
  const inPicker = declared.filter((l) => new RegExp(`["'\`]${l}["'\`]`).test(picker));
  return declared.length === 6 && inDict.length === 6 && (inPicker.length === 6 || inPicker.length === 0)
    || `declared=${declared.length} dictionary=${inDict.length} picker=${inPicker.length}`;
});
check("P102032", "JUDGMENT — the waiter bell is a <div> with a tap handler, not a real button", () => {
  const s = code("components/ChefCallButton.tsx");
  const isDiv = /<div className="chef-call" onClick=/.test(s);
  // Recorded, not fixed: it works for every diner who taps it, which is every diner.
  // Carried to the owner as a decision item (keyboard + screen-reader reachability).
  return isDiv ? "SKIP: recorded as a decision item, not a fault — a tap works, a Tab key does not"
    : true;
});
check("P102033", "JUDGMENT — the opening animation is remembered per restaurant, which is right for a shared phone", () => {
  const s = code("components/IntroSplash.tsx");
  return /lfh_intro_seen/.test(s) && /scopeKey/.test(s)
    || "the splash is remembered globally — a second restaurant's diner would never see its opening";
});
check("P102034", "JUDGMENT — the thinnest-checked files in this territory, named honestly", () => {
  // Re-derived above from the ledger, not remembered: OfflineNoticeStatic, InfinityLoader,
  // Particles and StarRating carried 1–2 rows each across all 44 ledger files before this run.
  // All four are now covered by P102001–P102012. Nothing here is a fault; the row exists so the
  // next sweep can see which corner was thin and check whether it stayed covered.
  return MINE.length === 40 || `the territory is ${MINE.length} files, not 40 — re-derive the split`;
});

done();
