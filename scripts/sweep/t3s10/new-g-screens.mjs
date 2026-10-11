// Block G — JUDGMENT: is this how a real restaurant needs it to work? Each row states the judgment in
// its `what` and asserts the code behaviour the judgment depends on, so it can still fail.
import { check, SRC, CODE, FILES } from "./lib.mjs";

const HOW = "SRC + judgment — the behaviour the judgment stands on";
check("P172540", FILES.chef, "a refused call tells the diner the ONE thing that works — ask a person — never 'try again'", HOW, () => {
  const b = SRC.chef.slice(SRC.chef.indexOf('res.reason === "rate_limited"'), SRC.chef.indexOf('} else if (res.ok'));
  return /member of staff/.test(b) && !/try again/i.test(b);
});
check("P172541", FILES.chef, "a successful call names WHAT was asked for, so a diner who tapped 'Water' sees 'Water' (not a generic tick)", HOW, () => /subtitle: `\$\{reason\} · staff notified`/.test(CODE.chef));
check("P172542", FILES.chef, "a duplicate tap within seconds is reassured ('Already sent'), not reported as a fresh call", HOW, () => /message: "Already sent"/.test(CODE.chef));
check("P172543", FILES.cart, "a sold-out dish stops the order with the dish NAMED, so the table decides — nothing is quietly dropped from their food", HOW, () => /message: `Sold out: \$\{names\}`/.test(CODE.cart) && /if \(soldLines\.length\) \{[\s\S]{0,400}return;/.test(CODE.cart));
check("P172544", FILES.cart, "a busy restaurant keeps the diner's order (saved, sent by itself) instead of making them rebuild it", HOW, () => /the kitchen is very busy; it goes through by itself/.test(CODE.cart));
check("P172545", FILES.cart, "the 'gate didn't answer' sentence sends the diner to Live status, not to order again (which could double the food)", HOW, () => /check Live status before ordering again/.test(CODE.cart));
check("P172546", FILES.mini, "the basket pill tells a screen reader the count AND the money, not just 'button'", HOW, () => /aria-label=\{`View bill — \$\{count\} item\$\{count !== 1 \? "s" : ""\}, \$\{price\}`\}/.test(CODE.mini));
check("P172547", FILES.confirm, "Cancel in the dish popup closes it without touching the basket", HOW, () => /className="order-confirm-cancel" onClick=\{\(\) => setOpen\(false\)\}/.test(CODE.confirm));
check("P172548", FILES.tracker, "a finished order stays on the strip for the rest of the meal (owner, 2026-06-14) — the diner's only record of it", HOW, () => !/SERVED_LINGER_MS\)\s*\.filter|filter\([^)]*isFinal/.test(CODE.status) && /return true;/.test(CODE.status));
check("P172549", FILES.chip, "the saved-orders list says plainly that it lives on THIS phone only", HOW, () => /Saved on this phone only\./.test(CODE.chip));
check("P172550", FILES.bell, "with waiter calls switched off BOTH the bell and the popup are gone — a stray event cannot open it", HOW, () => /if \(!features\.waiter_calls\) return null;/.test(CODE.bell) && /if \(!features\.waiter_calls\) return null;/.test(CODE.chef));
