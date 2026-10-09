// lib/payments.ts
import { suite } from "./lib.mjs";
const t = suite("lib/payments.ts", 168261, 10);
const P = await import("@/lib/payments.ts");
t("PAYMENT_METHODS is exactly UPI, Cash, Card, Other — in that order", P.PAYMENT_METHODS.join() === "UPI,Cash,Card,Other");
t("…'Pay later' is NOT a whole-bill method (money nobody collected is never 'paid')", !P.PAYMENT_METHODS.includes("Pay later"));
t("…'Split' is NOT a method a person picks (it is stamped by the split settle only)", !P.PAYMENT_METHODS.includes("Split"));
t("…there are no duplicates or blank entries", new Set(P.PAYMENT_METHODS).size === 4 && P.PAYMENT_METHODS.every((m) => m.trim() === m && m));
