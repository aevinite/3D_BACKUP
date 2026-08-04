/* ══════════════════════════════════════════════════════════════════════════════
   MY PROFILE & PAY — the staff member's own page inside their panel (mig 220).
   Shared by the WAITER tablet and the MANAGER panel: one implementation, loaded like
   maint.js / backstack.js, so the two can never drift apart.

   window.LFH_ME.open()   — full-screen overlay
   window.LFH_ME.available() — has the server said this person has a profile?

   What it shows (all from /api/panel-profile, which is scoped to the cookie's user, so a
   person can only ever see and edit THEMSELVES):
     • their own details — the ones only they know (address, emergency contact, birthday).
       NOT their ID-on-file, job or salary: those are the owner's to set, and nobody should
       be able to give themselves a raise.
     • their own pay — salary, what was paid this month, their payment history, any advance
       still to recover. The owner can switch this off per person (can_see_own_pay).
     • their job as read-only facts (joined, designation, shift, weekly off).
   Nothing is compulsory: the header shows "5 of 8 filled" and every field can be left blank.
   Registered with LFH_BACK so the phone's back button closes THIS layer, not the site.
   ══════════════════════════════════════════════════════════════════════════════ */
(function () {
  var el = null, off = null, me = null, saving = false;

  var money = function (n) { return "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN"); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var dateIN = function (d) {
    if (!d) return "—";
    var x = new Date(String(d).length <= 10 ? d + "T00:00:00" : d);
    return isNaN(x) ? "—" : x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };
  var monthIN = function (d) {
    if (!d) return "—";
    var x = new Date(d + "T00:00:00");
    return isNaN(x) ? "—" : x.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };
  var KIND = { salary: "Salary", advance: "Advance", bonus: "Bonus", overtime: "Overtime", reimbursement: "Reimbursement", deduction: "Advance recovered" };
  var MODE = { cash: "Cash", upi: "UPI", bank: "Bank transfer" };
  var PAYT = { monthly: "per month", daily: "per day", hourly: "per hour", per_shift: "per shift" };

  // The fields a person may fill in about themselves (the server whitelists the same set —
  // SELF_PROFILE_FIELDS in lib/staffProfileShared.ts — so a tampered form can't widen it).
  var FIELDS = [
    ["full_name", "Full name", "text"],
    ["dob", "Date of birth", "date"],
    ["alt_phone", "Second phone number", "tel"],
    ["email", "Email", "email"],
    ["address", "Where you live", "textarea"],
    ["city", "City", "text"],
    ["pincode", "Pincode", "text"],
    ["emg_name", "Emergency contact · name", "text"],
    ["emg_relation", "Emergency contact · relation", "text"],
    ["emg_phone", "Emergency contact · phone", "tel"],
    ["upi_id", "Your UPI id (to receive salary)", "text"],
  ];

  function close() {
    if (el) { el.remove(); el = null; }
    if (off) { off(); off = null; }
  }

  async function load() {
    // Shared single-flight with maint.js, which reads this same endpoint at boot (see the helper at
    // the top of maint.js). It only coalesces CONCURRENT reads and drops the entry the moment it
    // settles, so the re-read after a save below is still a real, fresh request.
    if (window.LFH_PROFILE_GET) {
      me = (await window.LFH_PROFILE_GET()).json;
    } else {
      var r = await fetch("/api/panel-profile", { cache: "no-store" });
      me = await r.json();
    }
    return me;
  }

  function row(icon, title, sub, right) {
    return '<div class="me-row"><i class="fas ' + icon + '" aria-hidden="true"></i>' +
      '<span class="me-rt"><b>' + esc(title) + '</b>' + (sub ? '<small>' + sub + "</small>" : "") + "</span>" +
      (right ? '<span class="me-rr">' + right + "</span>" : "") + "</div>";
  }

  function render() {
    var body = el && el.querySelector("#meBody");
    if (!body) return;
    if (!me || me.error || me.staff === false) {
      body.innerHTML = '<div class="me-empty">You are not signed in as a staff member, so there is no profile to show.</div>';
      return;
    }
    if (!me.profileModule) {
      body.innerHTML = '<div class="me-empty">Staff profiles are not switched on for this restaurant.</div>';
      return;
    }
    var p = me.profile || {}, c = me.completeness || { filled: 0, total: 0 }, job = me.job || {};
    var pct = Math.round((c.filled / Math.max(1, c.total)) * 100);
    var h = "";

    // ── who you are + how complete the record is ─────────────────────────────
    h += '<div class="me-card me-hero">' +
      '<div class="me-av">' + esc((me.name || me.username || "?").trim().charAt(0).toUpperCase()) + "</div>" +
      "<div><b>" + esc(me.name || me.username) + "</b>" +
      '<div class="me-mut">' + esc(me.role === "tablet" ? "waiter" : me.role) + " · " + esc(me.username) +
      (job.joined_on ? " · joined " + dateIN(job.joined_on) : "") + "</div></div></div>";
    h += '<div class="me-card me-prog"><div class="me-bar"><i style="width:' + pct + '%"></i></div>' +
      "<div><b>" + c.filled + " of " + c.total + " details filled</b>" +
      '<div class="me-mut">' + (c.filled >= c.total ? "All done — thank you." : "Nothing here is compulsory. Fill what you can; you can finish later.") +
      "</div></div></div>";

    // ── your money (only if the owner allows this person to see it) ───────────
    if (me.canSeeOwnPay && me.pay) {
      var s = me.paySummary || {};
      h += '<div class="me-sect">My pay</div>';
      h += '<div class="me-card">';
      h += row("fa-indian-rupee-sign", money(s.thisMonth) + " paid this month",
        me.pay.pay_amount ? esc(money(me.pay.pay_amount) + " " + (PAYT[me.pay.pay_type] || "")) : "no rate set yet");
      if (s.advanceOutstanding) h += row("fa-hand-holding-dollar", money(s.advanceOutstanding) + " advance pending", "will be taken from a later salary");
      if (s.lastPaidOn) h += row("fa-calendar-check", "Last paid " + dateIN(s.lastPaidOn), "");
      (me.pay.pay_extras || []).forEach(function (x) {
        h += row(x.kind === "deduction" ? "fa-minus" : "fa-plus",
          esc(x.label) + " · " + money(x.amount), x.kind === "deduction" ? "taken off every cycle" : "added every cycle");
      });
      h += "</div>";
      var pays = me.payments || [];
      h += '<div class="me-sect">Every payment (' + pays.length + ")</div><div class=\"me-card\">";
      if (!pays.length) h += '<div class="me-empty">Nothing recorded yet.</div>';
      pays.forEach(function (x) {
        var strike = x.voided_at ? ' style="text-decoration:line-through;opacity:.6"' : "";
        h += '<div class="me-row"' + strike + '><i class="fas fa-receipt" aria-hidden="true"></i>' +
          '<span class="me-rt"><b>' + money(x.amount) + " · " + esc(KIND[x.kind] || x.kind) + "</b>" +
          "<small>" + dateIN(x.paid_on) + " · " + esc(MODE[x.mode] || x.mode) +
          (x.for_period ? " · for " + monthIN(x.for_period) : "") +
          (x.voided_at ? " · cancelled: " + esc(x.void_reason || "") : "") + "</small></span></div>";
      });
      h += "</div>";
    }

    // ── your job, as set by the owner (read-only on purpose) ─────────────────
    if (job.designation || job.shift_label || (job.weekly_off || []).length) {
      h += '<div class="me-sect">My job <span class="me-mut">· set by the owner</span></div><div class="me-card">';
      if (job.designation) h += row("fa-briefcase", esc(job.designation), "");
      if (job.shift_label) h += row("fa-clock", esc(job.shift_label) + " shift", "");
      if ((job.weekly_off || []).length) h += row("fa-bed", "Weekly off: " + job.weekly_off.map(function (d) { return d.charAt(0).toUpperCase() + d.slice(1); }).join(", "), "");
      h += "</div>";
    }

    // ── your details, editable ───────────────────────────────────────────────
    h += '<div class="me-sect">My details <span class="me-mut">· only your owner sees these</span></div>';
    h += '<form class="me-card me-form" id="meForm">';
    h += '<label class="me-f"><span>Phone number</span><input name="phone" value="' + esc(me.phone || "") + '" inputmode="tel" placeholder="not added"></label>';
    FIELDS.forEach(function (f) {
      var v = esc(p[f[0]] || "");
      if (f[2] === "textarea") {
        h += '<label class="me-f"><span>' + esc(f[1]) + "</span><textarea name=\"" + f[0] + '" rows="2" placeholder="not added">' + v + "</textarea></label>";
      } else {
        h += '<label class="me-f"><span>' + esc(f[1]) + '</span><input name="' + f[0] + '" type="' + f[2] + '" value="' + v +
          '" placeholder="not added"' + (f[2] === "tel" ? ' inputmode="tel"' : "") + "></label>";
      }
    });
    h += '<button class="me-save" type="submit">Save my details</button>';
    h += '<div class="me-mut" style="text-align:center">Your salary, job and ID are set by the owner — ask them to change those.</div>';
    h += "</form>";

    body.innerHTML = h;
    var form = body.querySelector("#meForm");
    if (form) form.onsubmit = function (ev) { ev.preventDefault(); save(form); };
  }

  async function save(form) {
    if (saving) return;
    saving = true;
    var btn = form.querySelector(".me-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    var fd = new FormData(form), profile = {}, phone = String(fd.get("phone") || "").trim();
    FIELDS.forEach(function (f) { profile[f[0]] = String(fd.get(f[0]) || "").trim(); });
    try {
      // Phone lives on the account row, the rest in the profile — two small writes, and the
      // phone one is skipped when it hasn't changed.
      if (phone !== String(me.phone || "")) {
        var r1 = await fetch("/api/panel-profile", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone }),
        });
        var d1 = await r1.json().catch(function () { return {}; });
        if (!r1.ok) throw new Error(d1.error || "Couldn't save your phone number.");
      }
      var r2 = await fetch("/api/panel-profile", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: profile }),
      });
      var d2 = await r2.json().catch(function () { return {}; });
      if (!r2.ok) throw new Error(d2.error || "Couldn't save your details.");
      if (btn) btn.textContent = "Saved ✓";
      await load();
      render();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Save my details"; }
      alert(e && e.message ? e.message : "Couldn't save. Please try again.");
    } finally { saving = false; }
  }

  async function open() {
    close();
    el = document.createElement("div");
    el.className = "me-wrap";
    el.innerHTML =
      '<div class="me-top"><button class="me-back" type="button" id="meBack">← Back</button>' +
      '<b>My profile &amp; pay</b></div>' +
      '<div id="meBody" class="me-body"><div class="me-empty">Loading…</div></div>';
    document.body.appendChild(el);
    el.querySelector("#meBack").onclick = close;
    // The phone's back button must close THIS layer, never leave the site (the app's rule).
    if (window.LFH_BACK) off = window.LFH_BACK.layer("my-profile", close);
    try { await load(); } catch (e) { /* offline: render says so below */ }
    render();
  }

  // Cheap pre-check so a panel can hide its "My profile" button when the restaurant
  // doesn't have the feature (no dead UI). Cached after the first answer.
  var availability = null;
  async function available() {
    if (availability !== null) return availability;
    try {
      var j = await load();
      availability = !!(j && !j.error && j.profileModule);
    } catch { availability = false; }
    return availability;
  }

  window.LFH_ME = { open: open, close: close, available: available };

  // The MANAGER panel has no drawer row to hang this off, so the script wires its own
  // topbar button (#myProfileBtn) and reveals it only when the feature is really there.
  // .hidden alone loses to a display rule in this codebase, so clear both.
  function wireManagerButton() {
    var btn = document.getElementById("myProfileBtn");
    if (!btn) return;
    btn.onclick = function () { open(); };
    available().then(function (yes) {
      if (yes) { btn.hidden = false; btn.style.display = ""; }
    });
  }
  // Run NOW if the document is already parsed. Waiting only on DOMContentLoaded left the
  // button hidden at tablet width, where the panel iframe re-mounts and this script loads
  // AFTER that event has already fired — so the listener never ran (2026-07-31 sweep, pass 2).
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireManagerButton);
  else wireManagerButton();

  // Styles ride with the script so a panel only has to add the <script> tag.
  var css = document.createElement("style");
  css.textContent = [
    ".me-wrap{position:fixed;inset:0;z-index:130;background:var(--bg,#0b0e14);display:flex;flex-direction:column}",
    ".me-top{display:flex;align-items:center;gap:12px;padding:calc(12px + var(--sat,0px)) 16px 12px;border-bottom:1px solid var(--line,#222);background:var(--panel,#11151c)}",
    ".me-top b{font-size:16px}",
    ".me-back{min-height:40px;padding:0 12px;border-radius:9px;border:1px solid var(--line,#222);background:var(--panel,#11151c);color:inherit;font:inherit;font-weight:700;cursor:pointer}",
    ".me-body{flex:1;overflow-y:auto;padding:14px 14px calc(24px + var(--sab,0px));max-width:640px;width:100%;margin:0 auto;box-sizing:border-box}",
    ".me-card{background:var(--panel,#11151c);border:1px solid var(--line,#222);border-radius:14px;padding:6px 12px;margin-bottom:12px}",
    ".me-hero{display:flex;align-items:center;gap:12px;padding:14px 12px}",
    ".me-av{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:var(--accent,#e3c06f);color:#1a1205;font-weight:800;font-size:22px;flex:0 0 auto}",
    ".me-prog{display:flex;align-items:center;gap:12px;padding:12px}",
    ".me-bar{width:64px;height:8px;border-radius:99px;background:rgba(128,128,128,.25);overflow:hidden;flex:0 0 auto}",
    ".me-bar i{display:block;height:100%;background:var(--accent,#e3c06f)}",
    ".me-mut{color:var(--muted,#8b94a7);font-size:12px;font-weight:500}",
    ".me-sect{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#8b94a7);margin:16px 4px 8px}",
    ".me-row{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 0;border-bottom:1px solid var(--line,#222)}",
    ".me-card .me-row:last-child{border-bottom:0}",
    ".me-row i{width:20px;text-align:center;color:var(--muted,#8b94a7)}",
    ".me-rt{min-width:0;flex:1}.me-rt b{display:block;font-size:13.5px}.me-rt small{display:block;color:var(--muted,#8b94a7);font-size:11.5px}",
    ".me-rr{margin-left:auto;color:var(--muted,#8b94a7);font-size:12px}",
    ".me-empty{padding:18px 4px;text-align:center;color:var(--muted,#8b94a7);font-size:13px}",
    ".me-form{display:flex;flex-direction:column;gap:12px;padding:14px 12px}",
    ".me-f{display:flex;flex-direction:column;gap:5px}",
    ".me-f span{font-size:11.5px;font-weight:700;color:var(--muted,#8b94a7)}",
    ".me-f input,.me-f textarea{width:100%;box-sizing:border-box;min-height:46px;padding:11px 12px;border-radius:10px;border:1px solid var(--line,#222);background:var(--bg,#0b0e14);color:inherit;font:inherit;font-size:15px}",
    ".me-save{min-height:50px;border-radius:12px;border:none;background:var(--accent,#e3c06f);color:#1a1205;font:inherit;font-size:15px;font-weight:800;cursor:pointer}",
    ".me-save:disabled{opacity:.6}",
  ].join("");
  document.head.appendChild(css);
})();
