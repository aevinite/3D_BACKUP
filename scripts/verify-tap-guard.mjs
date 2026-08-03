// Guards the "a tap must never vanish in silence" rule in the staff panels.
//
// WHY THIS EXISTS. On 2026-07-29 the owner closed two tables on AV live and the third
// refused. Nothing was broken about the table: the manager panel's confirm box ignores
// clicks for its first 350ms (so the tail of a double-tap can't answer a question nobody
// read), and "Close anyway" is a CHAINED dialog — it only appears once the server's refusal
// lands, so it materialises under a finger already tapping, in the same screen position.
// A normal tap 200-300ms later was discarded with no message, no shake, nothing. The box
// just sat there and the table stayed open. Fixed in PR #554; three sibling paths that could
// swallow a tap the same way were fixed the next day.
//
// A dropped tap is indistinguishable from a dead button, so it costs real service time and
// it is invisible in logs. These checks are STATIC (fast, no browser, no DB) and each one
// maps to a specific bug that actually happened.
//
//   node scripts/verify-tap-guard.mjs            # check this checkout
//   node scripts/verify-tap-guard.mjs <root>     # check another checkout (worktree)
//   node scripts/verify-tap-guard.mjs --hook     # Claude Code PostToolUse mode (reads stdin)
//
// --hook reads the tool-call JSON on stdin, does nothing unless a staff-panel file was just
// edited, and exits 2 with the failures so the editing session is told immediately. It derives
// the checkout root from the edited file's path, so it is correct inside a git worktree.
//
// Add a check here whenever you add a dialog/overlay that answers a user's tap.
import fs from "node:fs";
import path from "node:path";

const HOOK = process.argv.includes("--hook");
const PANEL_FILE = /[/\\]public[/\\]panels[/\\][^/\\]+[/\\](app\.js|style\.css|index\.html)$/;

// In --hook mode: read stdin, bail out quietly unless a panel file was edited.
let ROOT = process.argv[2] && process.argv[2] !== "--hook" ? process.argv[2] : process.cwd();
if (HOOK) {
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch { process.exit(0); }
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const file = payload?.tool_input?.file_path || payload?.tool_response?.filePath || "";
  if (!PANEL_FILE.test(file)) process.exit(0);            // not our business
  const cut = file.replace(/\\/g, "/").indexOf("/public/panels/");
  ROOT = cut > 0 ? file.slice(0, cut) : ROOT;
}
// A missing file means this checkout predates the panels (or is mid-rebase) — a guard must
// never break someone's edit, so in --hook mode we go quiet instead of throwing.
const read = (p) => {
  try { return fs.readFileSync(path.join(ROOT, p), "utf8"); }
  catch (e) { if (HOOK) process.exit(0); throw e; }
};
const EDITOR = "public/panels/editor/app.js";
const TABLET = "public/panels/tablet/app.js";

const fails = [];
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); if (!ok) fails.push(`${name}\n    ${detail}`); };

// ── 1. The manager's speed-click guard must HOLD an early tap, not drop it ──────────────
{
  const src = read(EDITOR);
  check(
    "manager: one shared tapGuard() owns the speed-click window",
    /function tapGuard\s*\(/.test(src),
    `${EDITOR} no longer defines tapGuard(). The confirm/prompt dialogs must share ONE guard so a\n    fix to one can't miss the other.`,
  );
  // The regressive shape: a button handler gated on a bare settled() check, which silently
  // discards the click. Buttons must go through guard.act() (holds it, then fires).
  const badGate = src.match(/\.(confirm-ok|confirm-cancel)"\s*\)\s*\.onclick\s*=\s*\(\)\s*=>\s*\{?\s*if \(settled\(\)\)/g);
  check(
    "manager: no dialog button silently drops a click on `if (settled())`",
    !badGate,
    `Found ${badGate ? badGate.length : 0} handler(s) shaped "onclick = () => { if (settled()) ... }" in ${EDITOR}.\n    That is the exact line that ate the owner's "Close anyway" tap. Route the button through\n    guard.act(fn) instead — it holds an early tap and fires it when the window closes.`,
  );
  check(
    "manager: an early tap that IS refused is shown (confirm-nudge)",
    /confirm-nudge/.test(src) && /confirm-nudge/.test(read("public/panels/editor/style.css")),
    "The .confirm-nudge shake must exist in BOTH app.js and style.css: a tap the guard refuses has to\n    be visible, or it is a silent drop again.",
  );
  check(
    "manager: a held tap is shown as pending (confirm-armed)",
    /confirm-armed/.test(src) && /confirm-armed/.test(read("public/panels/editor/style.css")),
    "The .confirm-armed state must exist in BOTH app.js and style.css so a held tap looks like it landed.",
  );
}

// ── 2. Every .confirm-overlay look-alike must stamp data-closing when it closes ─────────
// confirmDialog refuses to open while an UNANSWERED .confirm-overlay is in the DOM. Any
// dialog wearing that class which closes without the stamp leaves a ~200ms window in which
// the next confirm is silently answered "no". logDetailDialog did exactly that.
{
  const src = read(EDITOR);
  const builders = [...src.matchAll(/wrap\.className\s*=\s*"confirm-overlay/g)].map((m) => m.index);
  const missing = [];
  for (const at of builders) {
    const line = src.slice(0, at).split("\n").length;
    const body = src.slice(at, at + 4000);           // the dialog's own body, incl. its close()
    const closeFn = body.match(/const close\s*=\s*[^;]*?\{[\s\S]{0,400}?\}/);
    if (!closeFn || !/data-closing/.test(closeFn[0])) missing.push(line);
  }
  check(
    "manager: every .confirm-overlay dialog stamps data-closing on close",
    missing.length === 0,
    `Dialog(s) built at ${EDITOR}:${missing.join(", ")} close without setAttribute("data-closing").\n    While such an overlay lingers (200ms fade), the next confirmDialog() resolves false with nothing\n    on screen — the user's tap disappears.`,
  );
  check(
    "manager: a suppressed confirm shakes the dialog that is blocking it",
    /blocking[\s\S]{0,200}confirm-nudge/.test(src),
    "confirmDialog() suppresses a second confirm by resolving false. It must first shake the dialog that\n    is blocking, so the dropped tap is explained instead of silent.",
  );
}

// ── 3. The tablet's shared confirm must never leave a promise unresolved ────────────────
// #confirmOverlay is ONE element whose Yes/No handlers are reassigned per call. Without a
// re-entry guard, a second call replaced the first call's handlers and the first promise
// never settled — the waiter's action died mid-await.
{
  const src = read(TABLET);
  check(
    "tablet: confirmDialog refuses re-entry instead of orphaning the first promise",
    /confirmOpen/.test(src) && /if \(confirmOpen\)[\s\S]{0,200}resolve\(false\)/.test(src),
    `${TABLET}: confirmDialog() must guard re-entry (confirmOpen) and answer the second call, or the\n    FIRST caller awaits forever and its action vanishes.`,
  );
  check(
    "tablet: the re-entry guard clears when the dialog finishes",
    /confirmOpen = false/.test(src),
    `${TABLET}: nothing resets confirmOpen — after one dialog, every later confirm would be refused\n    and every one of those actions would silently do nothing.`,
  );
  check(
    "tablet: a refused second question is shown (cf-nudge)",
    /cf-nudge/.test(src) && /cf-nudge/.test(read("public/panels/tablet/style.css")),
    "The .cf-nudge shake must exist in BOTH the tablet app.js and style.css.",
  );
}

// ── a button you cannot see is a button you cannot tap ─────────────────────────────────
// 2026-08-03: adding − Discount to the order builder's footer pushed "Place order →" 74px off
// the right edge of a 360px phone. Nothing caught it — the live check asserted the FOOTER was
// on screen, not the BUTTON inside it — and it took a screenshot to see. The footer is a fixed
// row of controls that grows every time a feature is added to it, so the rule is that it must
// WRAP on a phone and the primary action must not be the thing that gets squeezed.
{
  const css = read("public/panels/editor/style.css");
  // the phone block that owns this footer
  const phone = (css.match(/@media \(max-width: 760px\) \{[\s\S]*?\n\}/g) || []).join("\n");
  check(
    "the order footer wraps on a phone, so a new control can't push the send button off screen",
    /\.to-foot\s*\{[^}]*flex-wrap:\s*wrap/.test(phone),
    "public/panels/editor/style.css: inside @media (max-width:760px), .to-foot must set\n    `flex-wrap: wrap`. Without it the footer is one un-wrapping row and every control added to\n    it (total, − Discount, the N-item toggle, Place order) steals width from the primary button\n    until it is clipped — measured at 74px off-screen on a 360px phone.",
  );
  check(
    "the send button takes its own full-width line on a phone",
    /\.to-foot \.to-send[^{]*\{[^}]*flex:\s*1 1 100%/.test(phone),
    "public/panels/editor/style.css: inside @media (max-width:760px), .to-foot .to-send must be\n    `flex: 1 1 100%`. Shrinking the primary action to make room is backwards — the smallest\n    screen would get the smallest target. Give it a line of its own instead.",
  );
}

// ── EVERY IMPORTANT ACTION IS EXACTLY TWO STEPS (owner, 2026-08-03) ────────────────────
// "Two steps for an important thing — closing a table, settling a bill, placing an order.
//  And if it already has a two, we don't need the third one."
// A one-tap close/settle/issue is a mis-tap waiting to happen on a tablet carried through a
// busy room; a THIRD ask is just as bad, because a question nobody reads is a question that
// gets dismissed. So each action below must have exactly one gate — a confirm, a picker, a
// method sheet or a PIN — and this checks the shape of the code that opens it.
{
  const src = read(TABLET);
  // the source of ONE function, from its name to the next top-level `function` / `async function`
  const fnBody = (name) => {
    const at = src.search(new RegExp(`\\n(?:async )?function ${name}\\s*\\(`));
    if (at < 0) return "";
    const rest = src.slice(at + 1);
    const end = rest.search(/\n(?:async )?function [A-Za-z_]/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  // 1 · Closing a table asks before it closes — through ONE shared path.
  // There are two doors now (the popup's ✕ Close table and a finished tile's ⏻), and the flow
  // behind them carries both the optimistic local drop AND the reason-code "close anyway"
  // ladder. Two copies of that would be two places to forget the reason codes — which is
  // exactly how a paid-but-unserved table once dead-ended with no "close anyway" at all. So
  // the check is: the shared function confirms, and every door routes through it.
  // POSITIONAL, not just "a confirm appears somewhere in there": the function ALSO contains
  // the second-chance "Close anyway" dialog, so a text match was satisfied by that one and
  // passed a body whose FIRST confirm had been deleted (proven while writing this).
  const closeFn = fnBody("closeTableAndFree");
  const firstAsk = closeFn.search(/await confirmDialog\(/);
  const firstPost = closeFn.search(/api\("POST",\s*`\/sessions\/\$\{s\.id\}\/close`/);
  check(
    "tablet: the shared close path asks a confirm BEFORE it posts the close",
    firstAsk >= 0 && firstPost >= 0 && firstAsk < firstPost,
    `${TABLET}: closeTableAndFree() must await confirmDialog() BEFORE POSTing /sessions/:id/close\n    (found ask at ${firstAsk}, post at ${firstPost}). A single tap freeing an occupied table is\n    the mis-tap this rule exists for — and note the function's own "Close anyway" dialog comes\n    AFTER the post, so only the order of the two proves anything.`,
  );
  check(
    "tablet: every way of closing a table goes through that ONE path",
    /#closeTable[\s\S]{0,200}?closeTableAndFree\(/.test(src)
      && /tclose\[data-quick='close'\][\s\S]{0,200}?closeTableAndFree\(/.test(src)
      && (src.match(/sessions\/\$\{s\.id\}\/close/g) || []).length <= 2,   // the try + the forced retry, both inside closeTableAndFree
    `${TABLET}: the popup's #closeTable AND the finished tile's .tclose must both call\n    closeTableAndFree(). A second inline close would be a second place to forget the\n    reason-code ladder ('unpaid' | 'cooking' | 'both') that offers "Close anyway".`,
  );
  // 2 · Settling a bill goes through the payment-method sheet (that sheet IS step 2 — so
  //     there must be no extra confirmDialog before it).
  const payFn = fnBody("payBillWithMethod");
  check(
    "tablet: settling a bill opens the payment sheet as its second step",
    /openPaymentMethodModal\(/.test(payFn),
    `${TABLET}: payBillWithMethod() must open openPaymentMethodModal() — picking HOW they paid is\n    the deliberate second step of settling a bill.`,
  );
  check(
    "tablet: settling a bill does NOT also ask a confirm (no third step)",
    !/confirmDialog\(/.test(payFn),
    `${TABLET}: payBillWithMethod() calls confirmDialog() as well as the payment sheet. That is a\n    THIRD step on the most repeated money action of a service — the owner banned it explicitly.`,
  );
  // 3 · Placing an order: the per-table flow confirms; the ⚡ quick-order flow's second step
  //     is the table picker, so it must NOT also confirm.
  const sendFn = fnBody("sendOrder");
  check(
    "tablet: placing an order for a table asks a confirm",
    /confirmDialog\(`Send \$\{count\}/.test(sendFn),
    `${TABLET}: sendOrder() must confirm before sending a table's order to the kitchen.`,
  );
  check(
    "tablet: a ⚡ quick order's second step is the table picker, not a confirm",
    /state\.quick && dest == null[\s\S]{0,120}openQuickDest\(\)/.test(sendFn)
      && /dest == null && !\(await confirmDialog\(/.test(sendFn),
    `${TABLET}: sendOrder(dest) must (a) open the table picker when a quick order has no table yet,\n    and (b) skip the confirm once the picker answered — picking the table IS the second step.\n    Asking again makes it three.`,
  );
  // 4 · Issuing an invoice has a second step in every configuration.
  const invFn = fnBody("genInvoice");
  check(
    "tablet: generating an invoice always has a second step",
    /willAskCustomer/.test(invFn) && /willAskPin/.test(invFn) && /confirmDialog\(/.test(invFn),
    `${TABLET}: genInvoice() must fall back to a confirm when neither the customer sheet nor a\n    manager PIN will run — otherwise one stray tap issues a real invoice number.`,
  );
  check(
    "tablet: the invoice confirm does not stack on top of the customer sheet",
    /if \(!willAskCustomer && !willAskPin\)/.test(invFn),
    `${TABLET}: the invoice confirm must be gated on !willAskCustomer && !willAskPin, or a\n    restaurant that captures the customer gets asked twice.`,
  );
}

// ── report ─────────────────────────────────────────────────────────────────────────────
// --hook stays SILENT on success (a passing guard must not add noise to every panel edit)
// and exits 2 on failure, which is how a PostToolUse hook tells the session it broke something.
if (!HOOK) for (const c of checks) console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} tap-guard checks FAILED:\n\n  - ${fails.join("\n\n  - ")}\n`);
  console.error("A tap that disappears reads as a broken button. Hold it, or show it being refused.");
  console.error("Background: scripts/verify-tap-guard.mjs header, and PR #554.");
  process.exit(HOOK ? 2 : 1);
}
if (!HOOK) console.log(`\nAll ${checks.length} checks passed — no user tap can be dropped in silence.`);
