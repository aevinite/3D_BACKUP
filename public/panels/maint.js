// maint.js — the shared staff control injected into every panel
// (manager/editor/kitchen/tablet) top bar.
//
// For a LOGGED-IN USER it shows a "⚙️ Settings" button that opens a profile
// drawer: edit name/phone, change your own password (if your admin allows it),
// set/change a PIN, take the guest menu offline, and log out. On a user's FIRST
// login it force-opens and requires name + phone before you can continue.
//
// For the ADMIN (super-access, no per-user profile) it shows the original
// "🟢 Menu live" toggle only — the admin manages everything from /admin.
//
// Pure vanilla JS, served statically (no build step). Talks to /api/panel-profile,
// /api/panel-logout and /api/maintenance.
(function () {
  // ── per-device id (unchanged): rides on every request so the Operation log
  //    can name which physical device acted. Cookie "lfh_panel_device". ──────
  (function ensureDeviceId() {
    try {
      if (!/(?:^|;\s*)lfh_panel_device=/.test(document.cookie)) {
        const rand = (self.crypto && self.crypto.randomUUID)
          ? self.crypto.randomUUID().replace(/-/g, "").slice(0, 8)
          : Math.random().toString(16).slice(2, 10);
        document.cookie = "lfh_panel_device=" + rand + "; path=/; max-age=31536000; samesite=lax";
      }
    } catch { /* cookies blocked — log just won't show a device id */ }
  })();

  // ── shared maintenance (menu live/offline) state + actions ─────────────────
  let maintOn = false;
  async function fetchMaint() {
    try { const r = await fetch("/api/maintenance", { cache: "no-store" }); maintOn = (await r.json()).maintenance === true; } catch {}
    return maintOn;
  }
  async function setMaint(turnOn) {
    await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: turnOn }) });
    maintOn = turnOn;
  }

  // ── small DOM helpers ──────────────────────────────────────────────────────
  const topbar = () => document.querySelector(".topbar .top-actions") || document.querySelector(".topbar");
  function el(tag, props, kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === "style") Object.assign(n.style, props[k]);
      else if (k.startsWith("on") && typeof props[k] === "function") n.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (k === "html") n.innerHTML = props[k];
      else n.setAttribute(k, props[k]);
    }
    (kids || []).forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }

  // ── styles for the drawer (scoped class names so they can't clash) ─────────
  function injectStyles() {
    if (document.getElementById("lfh-set-style")) return;
    const css = `
    .lfh-ov{position:fixed;inset:0;background:rgba(4,8,18,.6);backdrop-filter:blur(4px);z-index:99998;display:flex;justify-content:flex-end}
    .lfh-dw{width:min(92vw,420px);height:100%;overflow:auto;background:#0f1830;color:#e7eefc;box-shadow:-20px 0 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif;animation:lfhslide .18s ease}
    @keyframes lfhslide{from{transform:translateX(30px);opacity:.4}to{transform:none;opacity:1}}
    .lfh-dw h2{font-size:16px;margin:0}
    .lfh-sec{padding:16px 18px;border-bottom:1px solid #1d2944}
    .lfh-sec h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#7e93bd;margin:0 0 10px}
    .lfh-lab{display:block;font-size:12px;color:#8aa0c9;margin:0 0 4px}
    .lfh-in{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;border:1px solid #2a3a5f;background:#0a1326;color:#eaf1ff;font-size:14px;margin:0 0 10px}
    .lfh-bt{padding:9px 13px;border:0;border-radius:9px;font-weight:600;font-size:13px;cursor:pointer;color:#fff}
    .lfh-msg{font-size:12px;margin:2px 0 8px}
    .lfh-note{font-size:12px;color:#8aa0c9}`;
    document.head.appendChild(el("style", { id: "lfh-set-style", html: css }));
  }

  let profile = null; // {username, role, name, phone, hasPin, needsProfile, canSelfReset}
  let overlay = null;

  function closeDrawer() {
    // Block closing during first-login until name + phone are filled.
    if (profile && profile.needsProfile) { alert("Please add your name and phone to continue."); return; }
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function setMsg(node, text, good) { node.textContent = text || ""; node.style.color = good ? "#86efac" : "#fca5a5"; }

  function openDrawer() {
    injectStyles();
    if (overlay) overlay.remove();
    const roleLabel = { manager: "Manager", editor: "Manager", kitchen: "Kitchen", tablet: "Tablet (waiter)" }[profile.role] || profile.role;

    // — header —
    const closeBtn = el("button", { class: "lfh-bt", style: { background: "#243049" }, onClick: closeDrawer, html: "✕" });
    const header = el("div", { class: "lfh-sec", style: { display: "flex", alignItems: "center", gap: "10px", position: "sticky", top: "0", background: "#0f1830", zIndex: "1" } }, [
      el("div", { style: { fontSize: "22px" } }, ["👤"]),
      el("div", { style: { flex: "1" } }, [
        el("h2", null, [profile.name || profile.username]),
        el("div", { class: "lfh-note" }, ["@" + profile.username + " · " + roleLabel]),
      ]),
      closeBtn,
    ]);

    const sections = [header];

    // — first-login banner —
    if (profile.needsProfile) {
      sections.push(el("div", { class: "lfh-sec", style: { background: "#1e2a16", borderBottom: "1px solid #2f4020" } }, [
        el("div", { style: { color: "#bef264", fontSize: "13px" } }, ["👋 Welcome! Please add your name and phone number to continue."]),
      ]));
    }

    // — details (name / phone) —
    const nameIn = el("input", { class: "lfh-in", value: profile.name || "", placeholder: "Your full name" });
    const phoneIn = el("input", { class: "lfh-in", value: profile.phone || "", placeholder: "Your phone number", inputmode: "tel" });
    const detMsg = el("div", { class: "lfh-msg" });
    const saveDet = el("button", { class: "lfh-bt", style: { background: "#22c55e" }, onClick: async () => {
      const name = nameIn.value.trim(), phone = phoneIn.value.trim();
      if (!name || !phone) { setMsg(detMsg, "Both name and phone are required.", false); return; }
      saveDet.disabled = true;
      try {
        const r = await fetch("/api/panel-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }) });
        const j = await r.json();
        if (!r.ok) { setMsg(detMsg, j.error || "Could not save.", false); return; }
        profile.name = name; profile.phone = phone; profile.needsProfile = false;
        setMsg(detMsg, "Saved.", true);
        const sb = document.getElementById("staffSettingsBtn"); if (sb) sb.textContent = "⚙️ Settings";
      } catch { setMsg(detMsg, "Network error.", false); }
      finally { saveDet.disabled = false; }
    } }, ["Save details"]);
    sections.push(el("div", { class: "lfh-sec" }, [
      el("h3", null, ["Your details"]),
      el("label", { class: "lfh-lab" }, ["Name"]), nameIn,
      el("label", { class: "lfh-lab" }, ["Phone"]), phoneIn,
      detMsg, saveDet,
    ]));

    // — password (only if allowed) —
    if (profile.canSelfReset) {
      const curIn = el("input", { class: "lfh-in", type: "password", placeholder: "Current password", autocomplete: "current-password" });
      const newIn = el("input", { class: "lfh-in", type: "password", placeholder: "New password (min 6)", autocomplete: "new-password" });
      const pwMsg = el("div", { class: "lfh-msg" });
      const savePw = el("button", { class: "lfh-bt", style: { background: "#3b82f6" }, onClick: async () => {
        if (!curIn.value || !newIn.value) { setMsg(pwMsg, "Fill both fields.", false); return; }
        savePw.disabled = true;
        try {
          const r = await fetch("/api/panel-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: curIn.value, newPassword: newIn.value }) });
          const j = await r.json();
          if (!r.ok) { setMsg(pwMsg, j.error || "Could not change.", false); return; }
          setMsg(pwMsg, "Password changed — signing you out…", true);
          setTimeout(() => { location.href = "/login"; }, 900);
        } catch { setMsg(pwMsg, "Network error.", false); }
        finally { savePw.disabled = false; }
      } }, ["Change password"]);
      sections.push(el("div", { class: "lfh-sec" }, [
        el("h3", null, ["Change password"]),
        curIn, newIn, pwMsg, savePw,
      ]));
    } else {
      sections.push(el("div", { class: "lfh-sec" }, [
        el("h3", null, ["Password"]),
        el("div", { class: "lfh-note" }, ["Your admin manages your password. Ask them to reset it if needed."]),
      ]));
    }

    // — PIN —
    const pinIn = el("input", { class: "lfh-in", type: "password", placeholder: "4–8 digit PIN", inputmode: "numeric", maxlength: "8" });
    const pinMsg = el("div", { class: "lfh-msg" });
    const savePin = el("button", { class: "lfh-bt", style: { background: "#8b5cf6" }, onClick: async () => {
      if (!/^\d{4,8}$/.test(pinIn.value)) { setMsg(pinMsg, "PIN must be 4–8 digits.", false); return; }
      savePin.disabled = true;
      try {
        const r = await fetch("/api/panel-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pinIn.value }) });
        const j = await r.json();
        if (!r.ok) { setMsg(pinMsg, j.error || "Could not save.", false); return; }
        profile.hasPin = true; pinIn.value = ""; setMsg(pinMsg, "PIN saved.", true);
      } catch { setMsg(pinMsg, "Network error.", false); }
      finally { savePin.disabled = false; }
    } }, [profile.hasPin ? "Change PIN" : "Set PIN"]);
    sections.push(el("div", { class: "lfh-sec" }, [
      el("h3", null, [profile.hasPin ? "Change your PIN" : "Set a PIN"]),
      el("div", { class: "lfh-note", style: { margin: "0 0 8px" } }, ["A personal PIN for sensitive actions (used for things like reverting a bill)."]),
      pinIn, pinMsg, savePin,
    ]));

    // — guest menu live/offline —
    const maintBtn = el("button", { class: "lfh-bt", style: { background: "#243049" } }, ["…"]);
    const renderMaint = () => {
      maintBtn.textContent = maintOn ? "🔴 Bring menu back online" : "🟢 Take guest menu offline";
      maintBtn.style.background = maintOn ? "#7f1d1d" : "#243049";
    };
    maintBtn.addEventListener("click", async () => {
      const turnOn = !maintOn;
      const msg = turnOn ? "Take the guest menu OFFLINE (“we’ll be right back”)? Guests can’t browse or order until it’s back." : "Bring the guest menu back ONLINE?";
      if (!confirm(msg)) return;
      try { await setMaint(turnOn); renderMaint(); } catch (e) { alert("Couldn't change it: " + (e && e.message)); }
    });
    fetchMaint().then(renderMaint);
    sections.push(el("div", { class: "lfh-sec" }, [
      el("h3", null, ["Guest menu"]),
      maintBtn,
    ]));

    // — log out —
    sections.push(el("div", { class: "lfh-sec" }, [
      el("button", { class: "lfh-bt", style: { background: "#991b1b", width: "100%" }, onClick: () => { location.href = "/api/panel-logout"; } }, ["Log out"]),
    ]));

    const drawer = el("div", { class: "lfh-dw" }, sections);
    overlay = el("div", { class: "lfh-ov", onClick: (e) => { if (e.target === overlay) closeDrawer(); } }, [drawer]);
    document.body.appendChild(overlay);
  }

  // ── admin super-access: just the original menu toggle in the top bar ───────
  function buildAdminToggle() {
    const bar = topbar();
    if (!bar || document.getElementById("maintToggle")) return;
    const btn = el("button", { id: "maintToggle", class: "btn", style: { marginLeft: "auto" } }, ["…"]);
    const render = () => {
      btn.textContent = maintOn ? "🔴 Menu offline" : "🟢 Menu live";
      btn.style.color = maintOn ? "#ef4444" : "";
      btn.title = maintOn ? "Guest menu is OFFLINE — click to bring it back" : "Guest menu is live — click to take it offline";
    };
    btn.onclick = async () => {
      const turnOn = !maintOn;
      const msg = turnOn ? "Take the guest menu OFFLINE (“we’ll be right back”)?" : "Bring the guest menu back ONLINE?";
      if (!confirm(msg)) return;
      try { await setMaint(turnOn); render(); } catch (e) { alert("Couldn't change it: " + (e && e.message)); }
    };
    bar.appendChild(btn);
    fetchMaint().then(render);
    setInterval(() => fetchMaint().then(render), 5000);
  }

  // ── user: the ⚙️ Settings button in the top bar ────────────────────────────
  function buildSettingsButton() {
    const bar = topbar();
    if (!bar || document.getElementById("staffSettingsBtn")) return;
    const btn = el("button", { id: "staffSettingsBtn", class: "btn", style: { marginLeft: "auto" }, onClick: openDrawer },
      [profile && profile.needsProfile ? "⚙️ Finish setup" : "⚙️ Settings"]);
    bar.appendChild(btn);
  }

  async function init() {
    let res = null;
    try { res = await fetch("/api/panel-profile", { cache: "no-store" }); } catch {}
    if (res && res.ok) {
      profile = await res.json();
      buildSettingsButton();
      if (profile.needsProfile) openDrawer(); // force first-login capture
    } else {
      // 401 → admin super-access (no per-user profile) — original toggle only.
      buildAdminToggle();
    }
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
