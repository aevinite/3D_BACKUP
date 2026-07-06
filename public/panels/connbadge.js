// connbadge.js — the shared "connection status" light + "waiting to sync" list for
// the staff panels (manager/kitchen/tablet). Injects a small pill into the top bar,
// top-right:
//
//   🟢 Live         — websocket subscribed, updates flowing.
//   🟡 Reconnecting — the device has internet but the live socket dropped.
//   🔴 Offline      — the device has NO internet (navigator.onLine === false).
//
// When there are actions saved on-device that haven't reached the server yet (the
// panel was offline), the pill shows a count ("🔴 Offline · 3 waiting" /
// "🟡 2 syncing") and becomes clickable: tapping it opens a drawer listing exactly
// what's still waiting to upload and anything that couldn't sync. State comes from
// LFH_RT (realtime.js) + navigator online/offline, and LFH_OUTBOX (outbox.js).
(function () {
  const STATES = {
    online:  { dot: "#22c55e", label: "Live",         title: "Connected — live updates are flowing." },
    weak:    { dot: "#f59e0b", label: "Reconnecting", title: "You're online, but the live connection dropped — reconnecting…" },
    offline: { dot: "#ef4444", label: "Offline",      title: "No internet. Changes you make are saved on this device and will sync when you're back online." },
  };

  function injectStyles() {
    if (document.getElementById("lfh-conn-style")) return;
    const css = `
    .lfh-conn{display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 9px;border-radius:999px;
      font:600 12px/1 system-ui,sans-serif;white-space:nowrap;user-select:none;
      background:var(--panel-2,rgba(127,127,127,.12));border:1px solid var(--line,rgba(127,127,127,.25));
      color:var(--text,#334155);transition:background .2s,border-color .2s,color .2s}
    .lfh-conn.is-click{cursor:pointer}
    .lfh-conn.is-click:hover{filter:brightness(1.06)}
    .lfh-conn .lfh-conn-dot{width:9px;height:9px;border-radius:999px;flex:0 0 auto;position:relative}
    .lfh-conn .lfh-conn-dot::after{content:"";position:absolute;inset:-3px;border-radius:999px;
      background:inherit;opacity:.35;animation:lfhConnPulse 1.8s ease-out infinite}
    .lfh-conn.is-offline .lfh-conn-dot::after{animation:none;opacity:0}
    .lfh-conn .lfh-conn-n{font-weight:800;opacity:.9}
    .lfh-conn .lfh-conn-warn{color:#ef4444;font-weight:800}
    @keyframes lfhConnPulse{0%{transform:scale(.7);opacity:.5}70%{transform:scale(1.9);opacity:0}100%{opacity:0}}
    @media (max-width:560px){.lfh-conn .lfh-conn-txt{display:none}.lfh-conn{padding:6px 9px}}
    @media (prefers-reduced-motion:reduce){.lfh-conn .lfh-conn-dot::after{animation:none}}
    /* drawer */
    .lfh-sync-ov{position:fixed;inset:0;background:rgba(4,8,18,.55);backdrop-filter:blur(4px);z-index:99997;display:flex;justify-content:flex-end}
    .lfh-sync-dw{width:min(92vw,420px);height:100%;overflow:auto;background:var(--panel,#0f1830);color:var(--text,#e7eefc);
      box-shadow:-20px 0 60px rgba(0,0,0,.5);font-family:system-ui,sans-serif;animation:lfhSyncSlide .2s cubic-bezier(.16,1,.3,1)}
    @keyframes lfhSyncSlide{from{transform:translateX(40px);opacity:.2}to{transform:none;opacity:1}}
    .lfh-sync-hd{position:sticky;top:0;background:var(--panel,#0f1830);padding:16px 18px;border-bottom:1px solid var(--line,#1d2944);display:flex;align-items:center;gap:10px}
    .lfh-sync-hd h2{font-size:15px;margin:0;font-weight:800;flex:1}
    .lfh-sync-x{margin-left:auto;padding:7px 11px;border:0;border-radius:9px;background:var(--line,#243049);color:var(--text,#e7eefc);font-weight:700;cursor:pointer}
    .lfh-sync-sec{padding:14px 18px;border-bottom:1px solid var(--line,#1d2944)}
    .lfh-sync-sec h3{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#7e93bd);margin:0 0 10px}
    .lfh-sync-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line,#1d2944)}
    .lfh-sync-row:last-child{border-bottom:0}
    .lfh-sync-row .t{flex:1;min-width:0}
    .lfh-sync-row .t b{display:block;font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lfh-sync-row .t small{font-size:11.5px;color:var(--muted,#8aa0c9)}
    .lfh-sync-row .t .e{color:#fca5a5}
    .lfh-sync-pill{font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:999px;flex:0 0 auto}
    .lfh-sync-btn{padding:6px 10px;border:0;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;color:#0b1220}
    .lfh-sync-empty{padding:26px 18px;text-align:center;color:var(--muted,#8aa0c9);font-size:13px}`;
    const s = document.createElement("style"); s.id = "lfh-conn-style"; s.textContent = css;
    document.head.appendChild(s);
  }

  let badge = null, dotEl = null, txtEl = null, nEl = null;
  let outbox = { queued: [], failed: [], count: 0 };

  function mount() {
    if (badge) return badge;
    injectStyles();
    const legacy = document.getElementById("conn");
    if (legacy && legacy.classList.contains("conn")) legacy.style.display = "none";

    badge = document.createElement("div");
    badge.className = "lfh-conn"; badge.id = "lfhConnBadge";
    dotEl = document.createElement("span"); dotEl.className = "lfh-conn-dot";
    txtEl = document.createElement("span"); txtEl.className = "lfh-conn-txt";
    nEl = document.createElement("span"); nEl.className = "lfh-conn-n";
    badge.appendChild(dotEl); badge.appendChild(txtEl); badge.appendChild(nEl);
    badge.addEventListener("click", () => { if (badge.classList.contains("is-click")) openDrawer(); });

    const host = document.querySelector(".topbar .top-actions") || document.querySelector(".topbar");
    if (!host) return null;
    host.insertBefore(badge, host.firstChild);
    return badge;
  }

  function connState() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    const s = (window.LFH_RT && window.LFH_RT.getStatus && window.LFH_RT.getStatus()) || "weak";
    return STATES[s] ? s : "weak";
  }

  function render() {
    if (!mount()) return;
    const key = connState();
    const st = STATES[key];
    dotEl.style.background = st.dot;
    txtEl.textContent = st.label;
    badge.classList.toggle("is-offline", key === "offline");

    const waiting = outbox.queued.length, failedN = outbox.failed.length;
    let extra = "";
    if (failedN) extra = failedN + " failed";
    else if (waiting) extra = waiting + (key === "offline" ? " waiting" : " syncing");
    nEl.textContent = extra ? "· " + extra : "";
    nEl.className = "lfh-conn-n" + (failedN ? " lfh-conn-warn" : "");

    const clickable = (waiting + failedN) > 0;
    badge.classList.toggle("is-click", clickable);
    badge.title = extra
      ? (failedN ? failedN + " change(s) couldn't sync — tap to review." : waiting + " change(s) waiting to sync — tap to see.")
      : st.title;
    badge.setAttribute("aria-label", "Connection: " + st.label + (extra ? ", " + extra : ""));
  }

  // ── "waiting to sync" drawer ────────────────────────────────────────────────
  let overlay = null, backOff = null;
  function fmtAgo(ts) { const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : Math.floor(m / 60) + "h ago"; }
  function el(tag, cls, txt) { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }

  function closeDrawer() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (backOff) { try { backOff(); } catch (e) {} backOff = null; }
  }

  function openDrawer() {
    if (overlay) overlay.remove();
    const dw = el("div", "lfh-sync-dw");

    const hd = el("div", "lfh-sync-hd");
    hd.appendChild(el("h2", null, "Waiting to sync"));
    const x = el("button", "lfh-sync-x", "✕"); x.addEventListener("click", closeDrawer);
    hd.appendChild(x);
    dw.appendChild(hd);

    const off = navigator.onLine === false;
    const status = el("div", "lfh-sync-sec");
    status.style.color = off ? "#fca5a5" : "#86efac";
    status.style.fontSize = "13px"; status.style.fontWeight = "700";
    status.textContent = off
      ? "📴 You're offline. These changes are safe on this device and will send automatically when you're back online."
      : "🟢 You're online — anything below is syncing now.";
    dw.appendChild(status);

    if (outbox.failed.length) {
      const sec = el("div", "lfh-sync-sec");
      const h = el("h3", null, "Couldn't sync — needs attention");
      sec.appendChild(h);
      outbox.failed.forEach((it) => {
        const row = el("div", "lfh-sync-row");
        const t = el("div", "t");
        t.appendChild(el("b", null, it.label || "Action"));
        t.appendChild(el("small", "e", (it.error || "Failed") + " · " + fmtAgo(it.at)));
        row.appendChild(t);
        const retry = el("button", "lfh-sync-btn", "Retry"); retry.style.background = "#f59e0b";
        retry.addEventListener("click", () => { window.LFH_OUTBOX && window.LFH_OUTBOX.retryFailed(); });
        const dis = el("button", "lfh-sync-btn", "Dismiss"); dis.style.background = "#64748b"; dis.style.color = "#fff";
        dis.addEventListener("click", () => { window.LFH_OUTBOX && window.LFH_OUTBOX.dismiss(it.id); });
        row.appendChild(retry); row.appendChild(dis);
        sec.appendChild(row);
      });
      dw.appendChild(sec);
    }

    if (outbox.queued.length) {
      const sec = el("div", "lfh-sync-sec");
      sec.appendChild(el("h3", null, "Waiting to send (" + outbox.queued.length + ")"));
      outbox.queued.forEach((it) => {
        const row = el("div", "lfh-sync-row");
        const t = el("div", "t");
        t.appendChild(el("b", null, it.label || "Action"));
        t.appendChild(el("small", null, fmtAgo(it.at)));
        row.appendChild(t);
        const pill = el("span", "lfh-sync-pill", off ? "Waiting" : "Sending…");
        pill.style.background = off ? "rgba(239,68,68,.18)" : "rgba(34,197,94,.18)";
        pill.style.color = off ? "#fca5a5" : "#86efac";
        row.appendChild(pill);
        sec.appendChild(row);
      });
      dw.appendChild(sec);
    }

    if (!outbox.queued.length && !outbox.failed.length) {
      dw.appendChild(el("div", "lfh-sync-empty", "✓ Everything is synced. Nothing waiting."));
    }

    overlay = el("div", "lfh-sync-ov");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDrawer(); });
    overlay.appendChild(dw);
    document.body.appendChild(overlay);
    // Hardware BACK closes the drawer instead of leaving the panel.
    if (window.LFH_BACK && window.LFH_BACK.layer) backOff = window.LFH_BACK.layer("outbox-sync", closeDrawer);
  }

  function boot() {
    render();
    if (window.LFH_RT && window.LFH_RT.onStatus) window.LFH_RT.onStatus(render);
    window.addEventListener("online", render);
    window.addEventListener("offline", render);
    if (window.LFH_OUTBOX && window.LFH_OUTBOX.onChange) {
      window.LFH_OUTBOX.onChange((snap) => { outbox = snap; render(); if (overlay) openDrawer(); });
    }
    setInterval(render, 10000);
  }

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
