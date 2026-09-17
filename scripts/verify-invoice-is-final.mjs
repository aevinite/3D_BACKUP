// verify-invoice-is-final — A TAX INVOICE, ONCE ISSUED, IS NEVER DELETED, EDITED OR RENUMBERED.
//
// WHY THIS EXISTS (T33, sweep #9, 2026-09-18). docs/COMPLIANCE-GUARDRAILS.md §3.0(2) makes three
// promises about an issued invoice, and only ONE of them was enforced. Driven against a settled,
// invoiced bill on the dev stack, each in its own transaction:
//
//     DELETE FROM sessions WHERE id = <it>                  → refused (mig 190) ✓
//     UPDATE sessions SET invoice_no = NULL WHERE id = <it>  → ok  ← erased a tax invoice number
//     UPDATE sessions SET invoice_no = 99999 …               → ok  ← renumbered it
//     UPDATE sessions SET invoice_at = NULL …                → ok  ← erased the date it was issued
//     UPDATE orders SET total = 0 WHERE session_id = <it>    → ok  ← rewrote the money on the sale
//
// `lfh_block_issued_delete` is a DELETE trigger, so "never deleted" held and "never edited, never
// renumbered" did not. Migration 332's signed chain made such an edit PROVABLE after the fact;
// nothing made it IMPOSSIBLE. Migration 398 closed it with two BEFORE UPDATE triggers, and this
// guard is what notices if either is dropped, narrowed, or routed around.
//
// It also watches the state that started this: fifteen bills were invoiced, had every order
// cancelled afterwards, and carried no void mark and no credit note — paperwork saying a sale
// happened with nothing saying it was undone. 398 credited all fifteen. The count must stay at zero.
//
// FOUR HALVES:
//   A  SOURCE   — migration 398 still declares both triggers and still keys its one-time credit run.
//   B  LIVE     — both triggers are installed on the right tables and scoped to the right columns.
//   C  DRIVEN   — the refusals actually fire, and the LEGITIMATE flows still pass. Everything runs
//                 inside BEGIN … ROLLBACK, so nothing is committed.
//   D  STATE    — no invoiced bill is sitting fully cancelled with no correction recorded.
//
// Exit 1 = an issued invoice could be edited again, or a bill is uncorrected. Exit 2 = could not run.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (good, msg) => { console.log(`${good ? "✓" : "✗"} ${msg}`); if (!good) bad++; };
const head = (t) => console.log(`\n── ${t}`);
const MIG = "398_an_issued_invoice_is_final_and_a_cancelled_one_is_corrected.sql";

// ── A · the migration still says it ───────────────────────────────────────────────────────────
head("A · migration 398 declares both rules, and its one-time correction is keyed");
{
  const p = join(root, "supabase", "migrations", MIG);
  if (!existsSync(p)) ok(false, `${MIG} is missing from supabase/migrations`);
  else {
    const raw = readFileSync(p, "utf8");
    // STRIP COMMENTS BEFORE LOOKING FOR SQL. This file's header QUOTES the probes it was written
    // from — "DELETE FROM sessions WHERE id = <one of them> → refused" — so a scan of the raw text
    // finds a DELETE the migration does not contain. That is the third time in one day a guard of
    // mine has read its own explanation as code (verify:t24-money-rules, verify:rid-required half D,
    // and here), which is exactly the fault item 4 was about. Comments are documentation; only the
    // statements are the rule.
    const src = raw.replace(/--[^\n]*/g, " ");
    ok(/trg_invoice_identity_is_final/.test(src), "it declares trg_invoice_identity_is_final on sessions");
    ok(/trg_invoiced_money_is_final/.test(src), "it declares trg_invoiced_money_is_final on orders");
    ok(/lfh_already_applied\('398_credit_uncorrected_cancelled_invoices'\)/.test(src),
      "the credit-note run is wrapped in the one-time ledger — a re-seed must not issue fifteen SECOND tax documents");
    ok(/lfh_issue_credit_note/.test(src) && !/DELETE\s+FROM\s+(sessions|orders|credit_notes|invoice_events)/i.test(src),
      "it CORRECTS with a credit note and deletes nothing — a sale can be cancelled, never made to disappear");
    ok(/payment_status|paid_at|tip|khata/.test(raw),
      "it names the settlement columns it deliberately leaves writable, so the next reader does not widen the lock by accident");
  }
}

// ── the database, with a deadline and backoff (busy is treated like offline) ───────────────────
const envPath = join(root, ".env.local");
let q = null;
if (!existsSync(envPath)) console.log("\n⏭  the live halves need .env.local — half A already read the folder, which is the source of truth for both databases.");
else {
  const env = Object.fromEntries(readFileSync(envPath, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  if (!env.SUPABASE_ACCESS_TOKEN || !env.NEXT_PUBLIC_SUPABASE_URL) console.log("\n⏭  no SUPABASE_ACCESS_TOKEN — half A stands.");
  else {
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    const spin = (ms) => { const t = Date.now() + ms; while (Date.now() < t) { /* no timers */ } };
    q = (sql, readOnly = true) => {
      let last = "";
      for (let i = 0; i < 5; i++) {
        try {
          const out = execFileSync("curl", ["-4", "-s", "--max-time", "180", "-X", "POST",
            `https://api.supabase.com/v1/projects/${ref}/database/query`,
            "-H", `Authorization: Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
            "-H", "Content-Type: application/json", "--data-binary", "@-"],
            { input: JSON.stringify(readOnly ? { query: sql, read_only: true } : { query: sql }), encoding: "utf8", maxBuffer: 1 << 26 });
          const j = JSON.parse(out);
          if (!Array.isArray(j)) { last = String((j && j.message) || out).slice(0, 200); break; }
          return j;
        } catch (e) { last = String(e?.message || e).slice(0, 120); spin(2 ** i * 800); }
      }
      throw Object.assign(new Error(last || "unreachable"), { unreachable: true });
    };
  }
}

if (q) try {
  // ── B · both triggers installed, scoped to the right columns ────────────────────────────────
  head("B · both rules are installed in the database, on the right columns");
  const trg = q(`select t.tgname, c.relname tbl, pg_get_triggerdef(t.oid) d
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where not t.tgisinternal
                    and t.tgname in ('trg_invoice_identity_is_final','trg_invoiced_money_is_final')`);
  const idn = trg.find((x) => x.tgname === "trg_invoice_identity_is_final");
  const mny = trg.find((x) => x.tgname === "trg_invoiced_money_is_final");
  ok(!!idn && idn.tbl === "sessions" && /BEFORE UPDATE OF invoice_no, invoice_at/i.test(idn.d),
    idn ? `the identity rule is BEFORE UPDATE OF invoice_no, invoice_at on sessions` : "the identity rule is NOT installed");
  ok(!!mny && mny.tbl === "orders" && /BEFORE UPDATE OF total/i.test(mny.d) && /discount/i.test(mny.d),
    mny ? "the money rule is BEFORE UPDATE OF the value columns on orders" : "the money rule is NOT installed");
  ok(!!mny && !/payment_status|paid_at|\btip\b|khata/i.test(mny.d),
    "…and it does NOT fire on the settlement columns — a bill being paid, split or put on khata after its invoice is the normal life of a sale");
  ok(!!idn && !!mny && trg.every((x) => /EXECUTE FUNCTION lfh_invoice/i.test(x.d) || /EXECUTE FUNCTION lfh_invoiced/i.test(x.d)),
    "both point at their own function, so neither has been re-pointed at something else");

  // ── C · driven, inside BEGIN … ROLLBACK ─────────────────────────────────────────────────────
  head("C · the refusals fire, and the legitimate flows still pass (driven, then rolled back)");
  const RID = q(`select id from restaurants where slug = 'french-house' and deleted_at is null limit 1`)[0]?.id;
  if (!RID) ok(false, "French House was not found, so the driven half could not run");
  else {
    const r = q(`
BEGIN;
CREATE OR REPLACE FUNCTION t_inv_try(p_sql text) RETURNS text LANGUAGE plpgsql AS $t$
BEGIN EXECUTE p_sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || left(SQLERRM, 120); END $t$;
CREATE TEMP TABLE kv (k text PRIMARY KEY, v text) ON COMMIT DROP;
WITH w AS (INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
           VALUES ('VIF1','open','waiter','${RID}') RETURNING id)
  INSERT INTO kv SELECT 'sid', (SELECT id::text FROM w);
WITH w AS (INSERT INTO orders (table_number, items, subtotal, tax, total, taxable_base, nontax_amount, status, session_id, restaurant_id)
           VALUES ('VIF1', jsonb_build_array(jsonb_build_object('title','probe','qty',1,'unit_price',200)),
                   200, 10, 210, 200, 0, 'served', (SELECT v FROM kv WHERE k='sid')::uuid, '${RID}') RETURNING id)
  INSERT INTO kv SELECT 'oid', (SELECT id::text FROM w);
INSERT INTO kv SELECT 'issued', t_inv_try('SELECT lfh_generate_invoice(''' || (SELECT v FROM kv WHERE k='sid') || ''')');
SELECT (SELECT v FROM kv WHERE k='issued')                                                                                  AS issued,
  t_inv_try('UPDATE sessions SET invoice_no = NULL WHERE id = ''' || (SELECT v FROM kv WHERE k='sid') || '''')               AS erase_no,
  t_inv_try('UPDATE sessions SET invoice_no = 99999 WHERE id = ''' || (SELECT v FROM kv WHERE k='sid') || '''')              AS renumber,
  t_inv_try('UPDATE sessions SET invoice_at = NULL WHERE id = ''' || (SELECT v FROM kv WHERE k='sid') || '''')               AS erase_at,
  t_inv_try('UPDATE orders SET total = 0 WHERE id = ''' || (SELECT v FROM kv WHERE k='oid') || '''')                         AS rewrite_money,
  t_inv_try('UPDATE orders SET discount = 999 WHERE id = ''' || (SELECT v FROM kv WHERE k='oid') || '''')                    AS late_discount,
  t_inv_try('UPDATE orders SET payment_status = ''paid'', paid_at = now() WHERE id = ''' || (SELECT v FROM kv WHERE k='oid') || '''') AS settle,
  t_inv_try('UPDATE orders SET tip = 50 WHERE id = ''' || (SELECT v FROM kv WHERE k='oid') || '''')                          AS add_tip,
  t_inv_try('UPDATE sessions SET deleted_at = now(), delete_reason = ''support'' WHERE id = ''' || (SELECT v FROM kv WHERE k='sid') || '''') AS soft_delete,
  t_inv_try('SELECT lfh_void_invoice(''' || (SELECT v FROM kv WHERE k='sid') || ''', ''guest disputed it'')')                AS void_it,
  t_inv_try('UPDATE orders SET total = 150 WHERE id = ''' || (SELECT v FROM kv WHERE k='oid') || '''')                       AS edit_after_void;
ROLLBACK;`, false)[0];
    ok(r.issued === "ok", `issuing an invoice still works (${r.issued})`);
    for (const [label, val] of [["erasing the number", r.erase_no], ["renumbering it", r.renumber],
                                ["erasing its date", r.erase_at], ["rewriting the money", r.rewrite_money],
                                ["adding a discount afterwards", r.late_discount]])
      ok(val !== "ok", `${label} is REFUSED — ${String(val).slice(0, 90)}`);
    for (const [label, val] of [["settling it", r.settle], ["adding a tip", r.add_tip],
                                ["soft-deleting it", r.soft_delete], ["voiding an OPEN invoice", r.void_it],
                                ["editing the money AFTER voiding", r.edit_after_void]])
      ok(val === "ok", `${label} still works — the lock has a legitimate key, it is not a trap`);
  }

  // ── D · the state that started this stays empty ─────────────────────────────────────────────
  head("D · no invoiced bill is sitting fully cancelled with nothing recording the correction");
  const s = q(`select
      (select count(*)::int from sessions s
        where s.invoice_no is not null and s.deleted_at is null and not s.invoice_voided and s.void_at is null
          and not exists (select 1 from orders o where o.session_id = s.id and o.deleted_at is null and o.status <> 'cancelled')
          and not exists (select 1 from credit_notes c where c.session_id = s.id))              as uncorrected,
      (select count(*)::int from credit_notes where reason like '%migration 398%')              as credited_by_398,
      (select count(*)::int from sessions where invoice_no is not null)                         as invoices_on_record`)[0];
  ok(Number(s.uncorrected) === 0,
    `${s.uncorrected} invoiced bills are fully cancelled with no void mark and no credit note `
    + `(migration 398 credited ${s.credited_by_398} of them; ${s.invoices_on_record} invoices are still on record, because none was removed)`);
} catch (e) {
  if (e?.unreachable) console.log(`\n⏭  skipped the live halves: could not reach the database (${e.message}). Half A stands.`);
  else throw e;
}

console.log(bad === 0
  ? "\n✅ an issued invoice cannot be deleted, edited or renumbered, and every cancelled one carries its correction."
  : `\n❌ ${bad} problem(s) — an issued tax invoice is not final.`);
process.exit(bad === 0 ? 0 : 1);
