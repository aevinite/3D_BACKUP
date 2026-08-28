/* billcustomer.js — "who is this bill for?" (owner, 2026-07-30)
 *
 * A bill can't be generated without a mobile number and a name. The sheet asks for the
 * MOBILE first: while it is being typed we look the number up, and the moment it is
 * recognised the name fills itself in ("Returning customer"). An unknown number shows a
 * small green "New customer" and the name is typed once — from then on that number
 * always brings its name back.
 *
 * Speed is the whole point (this happens at the till during a rush), so the lookup has
 * three layers and only the last one touches the network:
 *   1. an on-device map of every number this panel has already seen — instant, free;
 *   2. a per-prefix result cache, so backspacing/retyping never repeats a request;
 *   3. one small debounced request (>= 4 digits) ASKING for 6 rows of phone + name + visits,
 *      prefix-anchored on the (restaurant_id, phone) index.
 *
 * ⚠ THAT ROW CAP IS NOT ENFORCED TODAY, and this comment used to claim it was (T8 sweep #7,
 * 2026-08-22). "lfh_customer_phone_search" (migration 227) ends "... LIMIT GREATEST(1, LEAST(
 * COALESCE(p_limit, 6), 20))" AFTER a "json_agg", and in SQL a LIMIT applies once the aggregate
 * has already collapsed to one row — so it caps the one row and the array inside it is unbounded.
 * Measured on the dev database: p_limit=1 came back with 3 rows. On a mature restaurant a
 * four-digit prefix would download every matching customer, on the till's hot path, while a
 * waiter types — and this sheet then renders only the first four of them (see showMatches).
 * The fix is in the migration, not here, so it is written up as a handoff in
 * .claude/sweep/T8-findings.md. Until it lands, read this layer as "one request per new prefix",
 * not "one small request".
 * Requests are fired while typing and the stale ones are dropped by sequence number, so
 * the answer for the digits currently on screen is the only one that can land.
 *
 * Used by the manager panel and the waiter tablet. The server enforces the same rule
 * (lib/billCustomer.ts) — this sheet is the friendly half, not the guard.
 */
(function () {
  const MIN_LOOKUP = 6;      // digits before we ask the server anything
  const DEBOUNCE_MS = 140;   // keystrokes settle fast enough to feel instant
  /* HOW MANY ROWS THE SERVER SENDS IS THE SERVER'S BUSINESS. The sheet only ever displays four
     suggestions, and the server asks the database for more than that on purpose: an answer is only
     reusable for LONGER numbers when it was not truncated (see narrowLocally), so a small answer is
     a truncated answer is another request. One slightly bigger answer replaces several small ones.
     This side deliberately holds NO number for that cap. It reads the server's own "whole" flag,
     because a constant here and a constant there drift the moment either moves — and the failure
     that causes is silent and expensive: the sheet would narrow from a truncated list and tell a
     waiter "New customer" about a regular. Measured while building this, with the two out of step
     by six rows: the guest's name never appeared at all. */
  const known = new Map();   // "9825012345" -> { name, visits }
  const prefixCache = new Map(); // "982501" -> { rows, whole } — see narrowLocally()

  /* NARROW WITHOUT ASKING (owner, 2026-08-28: "if you write the 10th number it will instantly
     search for your name … even a second shouldn't take, and it should make load on database very
     less").

     The trick is that a prefix answer often contains its own future. If the server returned FEWER
     rows than we asked for, then that answer is the WHOLE set of customers whose number starts
     with that prefix — nobody was left out. So every longer number starting with it can be
     answered by filtering that list on this device: no request, no wait, no database at all.

     In practice a waiter types six digits, we ask once, and digits 7 8 9 10 cost nothing — the
     name appears the instant the tenth digit lands. Only a prefix that came back FULL (the server
     had to truncate) can still be hiding someone, so only that one is asked about again. */
  function narrowLocally(raw) {
    for (var n = raw.length; n >= MIN_LOOKUP; n--) {
      const hit = prefixCache.get(raw.slice(0, n));
      if (!hit || !hit.whole) continue;
      return hit.rows.filter((r) => String(r.phone || "").replace(/\D/g, "").startsWith(raw));
    }
    return null;
  }

  const digits = (s) => String(s || "").replace(/\D/g, "");
  // "+91 98250 12345", "098250 12345" and "9825012345" are one person — mirrors
  // lfh_phone10() in migration 227 so the client and the database agree.
  function norm(s) {
    const d = digits(s);
    if (d.length === 10) return d;
    if (d.length === 12 && d.slice(0, 2) === "91") return d.slice(-10);
    if (d.length === 11 && d[0] === "0") return d.slice(-10);
    if (d.length === 13 && d.slice(0, 3) === "091") return d.slice(-10);
    return d;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pretty = (p) => { const d = norm(p); return d.length === 10 ? d.slice(0, 5) + " " + d.slice(5) : d; };

  /** Remember what the server (or a bill we just saved) told us, so it costs nothing next time. */
  function remember(rows) {
    for (const r of rows || []) {
      const k = norm(r.phone);
      if (k) known.set(k, { name: r.name || "", visits: Number(r.visits) || 0 });
    }
  }

  /**
   * ask({ api, required, print, title, prefill }) → Promise<{ phone, name } | null>
   *  api      — the panel's own api(method, path) helper (carries its auth + action id)
   *  required — true when this restaurant refuses a bill without the details
   *  print    — whether these lines will appear on the printed bill (shown as a hint)
   *  prefill  — { phone, name } this BILL already carries (owner, 2026-07-30: reopening a
   *             bill and re-issuing its invoice brings back that session's own customer,
   *             filled in and editable — nobody retypes it, and it never leaks between tables)
   */
  function ask(opts) {
    const o = opts || {};
    const api = o.api;
    const required = o.required !== false;
    return new Promise((resolve) => {
      document.querySelector(".bcust-overlay")?.remove();
      const wrap = document.createElement("div");
      wrap.className = "sx-modal-overlay bcust-overlay";
      // A NICER ASK (owner, 2026-08-01: "make this UI better"). It was two bare inputs stacked with
      // a lot of dead space and a washed-out primary button, and the browser's autofill badge landed
      // on top of the phone field. Now: an icon-led header with a one-line reason, each field in its
      // own labelled block with the country prefix shown so the box reads as a phone box, a live
      // digit counter that turns green at 10, room reserved for the "we know this number" line so
      // nothing jumps, and a primary button that looks disabled when it is and solid when it is not.
      wrap.innerHTML = `
        <div class="sx-modal bcust-modal">
          <div class="bcust-head">
            <div class="bcust-ico" aria-hidden="true">🧾</div>
            <div class="bcust-htxt">
              <h3>${esc(o.title || "Who is this bill for?")}</h3>
              <p>Mobile first — if they have eaten here before, the name fills itself in.${o.print === false ? " Saved, but <b>not printed</b> on the bill." : ""}</p>
              <p class="bcust-why">The number is kept only to recognise a returning guest and for their bill history — so repeat customers can be rewarded later. It is never shared or used for marketing.</p>
            </div>
            <button class="tbl-modal-close bcust-x" aria-label="Close">✕</button>
          </div>
          <div class="bcust-body">
            <label class="bcust-field">
              <span class="bcust-lbl">Mobile number${required ? ' <i class="bcust-req">required</i>' : ' <i class="bcust-opt">optional</i>'}</span>
              <span class="bcust-inwrap">
                <span class="bcust-prefix">+91</span>
                <input id="bcPhone" class="bc-phone" type="tel" inputmode="numeric" autocomplete="off"
                       maxlength="17" placeholder="98765 43210">
                <span class="bcust-count" aria-hidden="true">0/10</span>
              </span>
            </label>
            <div class="bc-status" role="status"></div>
            <div class="bc-matches" style="display:none"></div>
            <label class="bcust-field">
              <span class="bcust-lbl">Name${required ? ' <i class="bcust-req">required</i>' : ' <i class="bcust-opt">optional</i>'}</span>
              <span class="bcust-inwrap">
                <input id="bcName" class="bc-name" type="text" autocomplete="off" maxlength="80"
                       placeholder="Who the bill is made out to">
              </span>
            </label>
          </div>
          <div class="bcust-foot">
            <button type="button" class="btn bc-cancel">Cancel</button>
            <button type="button" class="btn primary bc-go" aria-disabled="true">Generate bill</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);

      const phoneEl = wrap.querySelector(".bc-phone");
      const nameEl = wrap.querySelector(".bc-name");
      const statusEl = wrap.querySelector(".bc-status");
      const matchEl = wrap.querySelector(".bc-matches");
      const goBtn = wrap.querySelector(".bc-go");
      const countEl = wrap.querySelector(".bcust-count");
      const paintCount = () => {
        const n = String(phoneEl.value || "").replace(/\D/g, "").length;
        if (countEl) { countEl.textContent = `${n}/10`; countEl.classList.toggle("ok", n === 10); }
      };
      phoneEl.addEventListener("input", paintCount);
      paintCount();
      /* THE COUNTER MUST NEVER CONTRADICT THE BOX BESIDE IT (T8 sweep #7, 2026-08-22).
         paintCount() only ran on the "input" event, and assigning ".value" from script does not
         fire one — so on the two paths where the number arrives WITHOUT being typed the counter
         kept whatever it last said. Measured on a 360px phone:

           a reopened bill (prefill)  box "98250 12345"  counter "0/10", not green
           tapping a suggestion       box "98250 11111"  counter  "5/10", not green

         The counter exists to tell a waiter at the till "you have all ten digits", and on both of
         those paths it said the opposite while the Generate button was live — so the sheet gave
         two answers at once and the honest reading is "retype it". The reopen path is not an edge
         either: it is the case the prefill feature was built for (owner, 2026-07-30 — reopening a
         bill brings back that session's own customer so nobody retypes it).

         Every write to the box now goes through setPhone(), so a third path cannot miss it. */
      const setPhone = (v) => { phoneEl.value = v; paintCount(); };

      let done = false;
      // hardware BACK closes just this sheet (panel rule: every overlay is a back step)
      const offBack = window.LFH_BACK ? window.LFH_BACK.layer("bill-customer", () => finish(null)) : null;
      function finish(val) {
        if (done) return;
        done = true;
        if (offBack) offBack();
        wrap.remove();
        resolve(val);
      }
      wrap.__lfhClose = () => finish(null);
      wrap.querySelector(".tbl-modal-close").onclick = () => finish(null);
      wrap.querySelector(".bc-cancel").onclick = () => finish(null);
      wrap.onclick = (e) => { if (e.target === wrap) finish(null); };

      // nameTouched: once the waiter edits the name themselves we stop overwriting it
      // with a looked-up one (their correction wins).
      let nameTouched = false;
      nameEl.addEventListener("input", () => {
        nameTouched = true;
        sync();   // clears a standing refusal the moment the sheet is satisfiable (see `refusing`)
      });

      /* A TAP ON "GENERATE BILL" MUST NEVER DIE IN SILENCE (T8 sweep, 2026-08-17).
         The button used to carry the real 'disabled' attribute, and a disabled button emits no
         click at all — so the careful handler below, the one that says WHICH box is missing and
         puts the cursor in it, could never run. Exactly when a waiter needs telling (nine digits
         typed, or a number with no name), tapping the primary button did nothing whatsoever: no
         message, no focus, no toast. That is the panel's own "a tap must never vanish in silence"
         rule, broken by the very attribute meant to be helpful.
         So the button now only LOOKS not-ready and stays tappable. The look is the three
         declarations '.bcust-foot .btn.primary:disabled' applies in the panel stylesheet, mirrored
         inline, plus killing the ready-state glow that ':not(:disabled)' would otherwise paint on a
         button that is not ready. 'aria-disabled' keeps the state honest for a screen reader
         without swallowing the event. */
      function setReady(ok) {
        goBtn.setAttribute("aria-disabled", ok ? "false" : "true");
        goBtn.style.opacity = ok ? "" : ".45";
        goBtn.style.cursor = ok ? "" : "not-allowed";
        goBtn.style.filter = ok ? "" : "grayscale(.4)";
        goBtn.style.boxShadow = ok ? "" : "none";
      }
      /* ONCE THE SHEET HAS SAID WHICH BOX IS MISSING, A LOOKUP MAY NOT PAINT OVER IT
         (T8 sweep #7, 2026-08-22). The status line has two jobs — the lookup's "New customer" /
         "Returning customer", and the refusal that says WHICH box is missing — and the second was
         being wiped by the first about a third of a second later. Every single time, at every
         latency:

           waiter types the 10th digit and taps Generate with no name
           → "Enter the customer's name" in red          (the tap refused visibly, correctly)
           → …and the lookup that the last keystroke scheduled lands
           → "New customer" in GREEN                     (the reason is gone)

         Measured at server lags of 0, 80, 250 and 600ms — it is not a race that sometimes bites,
         because the last keystroke ALWAYS schedules a lookup that lands after the tap. And what
         replaces the refusal is reassuring, so the sheet ends up looking fine while the button is
         still refusing: the panel's "a tap must never vanish in silence" rule, undone one beat
         after it was honoured.

         So a refusal holds the line until the thing it named is actually supplied. sync() is where
         that is decided, because it already knows whether the sheet is satisfiable — and it runs on
         every keystroke AND after a lookup fills the name in, so the message clears from either. */
      let refusing = false;
      function sync() {
        const p = norm(phoneEl.value);
        const ok = p.length === 10 && nameEl.value.trim().length > 0;
        const live = required ? ok : (p.length === 0 || p.length === 10);
        if (refusing && live) { refusing = false; statusEl.style.color = ""; statusEl.textContent = ""; }
        setReady(live);
      }
      sync();   // paint the not-ready look before the waiter's first keystroke

      function showKnown(hit, p) {
        // The NAME is still filled in while a refusal stands — that is how the refusal gets
        // answered. Only the message is held back (see `refusing` above).
        if (!refusing) {
          statusEl.style.color = "#16a34a";
          const visits = hit.visits > 1 ? ` · ${hit.visits} visits` : "";
          statusEl.innerHTML = `✓ Returning customer${esc(visits)}`;
        }
        if (!nameTouched && hit.name) nameEl.value = hit.name;
        sync();
      }
      function showNew() {
        if (!refusing) {
          statusEl.style.color = "#16a34a";
          statusEl.textContent = "New customer";
        }
        sync();
      }
      function showTyping() {
        if (!refusing) { statusEl.style.color = ""; statusEl.textContent = ""; }
        matchEl.style.display = "none";
        sync();
      }

      // Suggestions for a PARTIAL number: tap one to fill it in. Keeps the waiter from
      // having to remember the whole number when the guest half-remembers it.
      function showMatches(rows, p) {
        const list = (rows || []).filter((r) => norm(r.phone) !== p);
        if (!list.length) { matchEl.style.display = "none"; return; }
        matchEl.style.display = "";
        // A ROW HERE PUTS A NAMED PERSON ON A TAX INVOICE, so it has to be a comfortable target.
        // Measured at 29px on a 360px phone (T8 sweep, 2026-08-17) — under the ~44px a thumb needs,
        // and a mis-tap does not just annoy, it bills the wrong customer. min-height, not padding,
        // so a two-line name still grows instead of being squeezed.
        matchEl.innerHTML = list.slice(0, 4).map((r) =>
          `<button type="button" class="btn small bc-pick" data-p="${esc(norm(r.phone))}" data-n="${esc(r.name || "")}"
             style="display:flex;align-items:center;width:100%;text-align:left;margin:4px 0;min-height:44px">${esc(r.name || "No name")} <span class="muted">&nbsp;· ${esc(pretty(r.phone))}</span></button>`).join("");
        matchEl.querySelectorAll(".bc-pick").forEach((b) => {
          b.onclick = () => {
            setPhone(pretty(b.dataset.p));
            if (!nameTouched) nameEl.value = b.dataset.n || "";
            matchEl.style.display = "none";
            known.set(b.dataset.p, { name: b.dataset.n || "", visits: 0 });
            lookup(true);
          };
        });
      }

      /* ONE QUESTION AT A TIME (owner, 2026-08-28 — "less load on the database").
         Typing is faster than a round trip to Mumbai, so a request for "982501" was still in the
         air when "9825012" fired the next one, and so on: five questions for one ten-digit number,
         four of whose answers were thrown away on arrival. While a question is out about a PREFIX
         of what is now in the box, the answer coming back can only be a superset of what we want —
         so there is nothing to gain by asking again, and the one already in flight is re-used the
         moment it lands. */
      let seq = 0, timer = null, inflight = null;
      async function lookup(immediate) {
        const p = norm(phoneEl.value);
        const raw = digits(phoneEl.value);
        if (raw.length < MIN_LOOKUP) { showTyping(); return; }

        // layer 1 — already on this device: no request at all
        if (p.length === 10 && known.has(p)) { showKnown(known.get(p), p); return; }
        // layer 2 — this prefix, or any shorter one whose answer was complete, already on the device
        const cached = narrowLocally(raw);
        if (cached) {
          remember(cached);
          const exact = cached.find((r) => norm(r.phone) === p);
          if (p.length === 10) { exact ? showKnown(known.get(p) || { name: exact.name, visits: exact.visits }, p) : showNew(); }
          else if (!refusing) statusEl.textContent = "";
          showMatches(cached, p);
          return;
        }
        // layer 3 — one small request AT A TIME; a late answer for older digits is dropped
        if (inflight && raw.startsWith(inflight)) return;   // the answer already on its way covers us
        const mine = ++seq;
        clearTimeout(timer);
        const run = async () => {
          const asked = raw;
          inflight = asked;
          try {
            const res = await api("GET", "/customer-search?q=" + encodeURIComponent(asked));
            if (done) return;
            const rows = (res && res.matches) || [];
            // `whole` = the server did NOT have to truncate, so this answer is every customer whose
            // number starts with `asked`, and every longer number can be narrowed from it on-device.
            // `whole !== true` means either the server truncated, or it is old enough not to say —
            // both mean "ask again for a longer number", which is exactly what this did before.
            // Cached even when the digits have moved on: the answer is still true about `asked`,
            // and throwing it away is what made the next keystroke ask the same question again.
            prefixCache.set(asked, { rows: rows, whole: res && res.whole === true });
            remember(rows);
            if (mine !== seq) return;                       // stale: cached, but never painted
            const exact = rows.find((r) => norm(r.phone) === p);
            if (p.length === 10) { exact ? showKnown({ name: exact.name, visits: exact.visits }, p) : showNew(); }
            showMatches(rows, p);
          } catch { /* offline or slow — the sheet still works, just no auto-fill */
          } finally {
            if (inflight === asked) inflight = null;
            // the box moved on while we were waiting — answer where it is NOW, from the cache when
            // that answer covers it, and only otherwise with a fresh question
            if (!done && digits(phoneEl.value) !== asked) lookup(true);
          }
        };
        if (immediate) run(); else timer = setTimeout(run, DEBOUNCE_MS);
      }

      phoneEl.addEventListener("input", () => {
        // keep the box readable as they type ("98250 12345")
        //
        // …WITHOUT THROWING THE CARET TO THE END (T8 sweep, 2026-08-17). Reassigning `.value` moves
        // the cursor to the end of the box, so a waiter who spotted a wrong third digit, clicked
        // there and typed found the cursor had jumped and the next keystroke landed at the far end
        // of the number. At the till, mid-rush, that means retyping all ten digits. So: count the
        // DIGITS before the caret, rewrite the box, then put the caret back after that many digits.
        // Counting digits rather than characters is what survives the reformat — the space this
        // adds and removes is not a digit. Typing straight through at the end is unchanged: every
        // digit is before the caret, so it lands at the end exactly as it always did.
        const caret = phoneEl.selectionStart;
        const before = caret == null ? null : digits(String(phoneEl.value).slice(0, caret)).length;
        const d = digits(phoneEl.value).slice(0, 13);
        const next = d.length > 5 && d.length <= 10 ? d.slice(0, 5) + " " + d.slice(5) : d;
        if (next !== phoneEl.value) {
          phoneEl.value = next;
          paintCount();   // the listener above counted the PRE-format value; recount the box as it now reads
          if (before != null) {
            let pos = 0, seen = 0;
            while (pos < next.length && seen < before) { if (next.charCodeAt(pos) >= 48 && next.charCodeAt(pos) <= 57) seen++; pos++; }
            // A field that refuses a selection (some mobile keyboards mid-composition) simply keeps
            // the browser's own caret — never let this throw and kill the keystroke.
            try { phoneEl.setSelectionRange(pos, pos); } catch { /* leave the caret where it is */ }
          }
        }
        sync();
        // A COMPLETE NUMBER IS ASKED ABOUT AT ONCE, never after a wait (owner, 2026-08-28). The
        // debounce exists so a half-typed number does not fire a request per keystroke; the tenth
        // digit is not a keystroke on the way to somewhere, it is the answer, and waiting 140ms
        // before starting is 140ms the waiter spends looking at a box that knows nothing.
        lookup(norm(phoneEl.value).length === 10);
      });
      phoneEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameEl.focus(); } });
      // Enter always goes through the button, so an incomplete sheet REFUSES VISIBLY rather than
      // doing nothing — the same reason the button no longer carries `disabled` (see setReady).
      nameEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); goBtn.click(); } });

      goBtn.onclick = () => {
        const phone = norm(phoneEl.value), name = nameEl.value.trim();
        // The button LOOKS not-ready while either box is short, but it is still tappable, and a tap
        // must NEVER die in silence (panel rule): say which box is missing and put the cursor in it.
        // The half-typed number is refused on the optional path too — this handler is now the only
        // thing standing between a mis-tap and a five-digit "mobile number" saved against a bill.
        const shortPhone = phone.length > 0 && phone.length !== 10;
        if (required ? (phone.length !== 10 || !name) : shortPhone) {
          const miss = phone.length !== 10 ? phoneEl : nameEl;
          refusing = true;   // holds until sync() sees the sheet satisfied — see `refusing` above
          statusEl.style.color = "#dc2626";
          statusEl.textContent = phone.length !== 10 ? "Enter the full 10-digit mobile number" : "Enter the customer's name";
          miss.focus();
          return;
        }
        if (phone && name) known.set(phone, { name, visits: (known.get(phone)?.visits || 0) });
        finish({ phone, name });
      };

      // A bill that already has a customer (re-issuing after a reopen) opens filled in and
      // confirmed, so the waiter just taps Generate — or edits it if the guest changed.
      const pre = o.prefill || null;
      if (pre && (pre.phone || pre.name)) {
        if (pre.phone) setPhone(pretty(pre.phone));
        if (pre.name) { nameEl.value = pre.name; known.set(norm(pre.phone), { name: pre.name, visits: known.get(norm(pre.phone))?.visits || 0 }); }
        sync();
        if (norm(pre.phone).length === 10) lookup(true);   // shows "Returning customer · N visits"
      }
      setTimeout(() => (pre && pre.phone ? nameEl : phoneEl).focus(), 60);
    });
  }

  window.LFH_BILLCUST = { ask, remember, norm, pretty };
})();
