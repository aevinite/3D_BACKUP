// Round 4 (owner, 2026-10-10: "do all the things you have listed") — items 10–16, checked from the real
// files with the in-memory database. APPEND ONLY; ids are permanent.
import { suite } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const t = suite("round 4 (items 10–16)", 166001, 200);
const src = (p) => readFileSync(join(root, p), "utf8");
const DB = await import("@/lib/dbRefusal.ts");
const PAY = await import("@/lib/payments.ts");
const TT = await import("@/lib/tableTags.ts");

// ── item 11: a bill is paid by a method the app knows ──
{ const mig = existsSync(join(root, "supabase/migrations/417_a_bill_is_paid_by_a_method_the_app_knows.sql")) ? src("supabase/migrations/417_a_bill_is_paid_by_a_method_the_app_knows.sql") : "";
  const lists = [...mig.matchAll(/payment_method (?:NOT )?IN \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort().join("|"));
  const app = [...PAY.PAYMENT_METHODS, "Split", TT.ON_THE_HOUSE_METHOD].sort().join("|");
  t("item 11: migration 417 adds orders_payment_method_is_known, NOT VALID first, validated only when no row breaks it", /ADD CONSTRAINT orders_payment_method_is_known/.test(mig) && /NOT VALID;/.test(mig) && /IF NOT EXISTS \(\s*SELECT 1 FROM public\.orders[\s\S]*?VALIDATE CONSTRAINT orders_payment_method_is_known/.test(mig));
  t("item 11: …its list is EXACTLY the app's — PAYMENT_METHODS + 'Split' (Pay in parts) + ON_THE_HOUSE_METHOD — in both places it is written", lists.length === 2 && lists.every((l) => l === app), `${lists.join(" / ")} vs ${app}`);
  t("item 11: …and it rewrites no data (no UPDATE or DELETE outside comments)", !/\b(UPDATE|DELETE)\b/i.test(mig.replace(/--.*$/gm, "")));
  t("item 11: a refused method reads as a sentence that says what to pick", /pick UPI, cash, card or other/.test(DB.refusalMessage({ code: "23514", message: 'new row for relation "orders" violates check constraint "orders_payment_method_is_known"' })));
  t("item 11: the Pay in parts and on-the-house spellings the app writes are the ones the rule allows", /payment_method: "Split"/.test(src("lib/paySplit.ts")) && TT.ON_THE_HOUSE_METHOD === "On the house"); }
