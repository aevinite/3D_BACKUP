// admin/ui/app.js — the control room's brain.
// The switcher swaps between the HOME cockpit and an embedded panel (iframe).
// Click a panel tab to open it; click the active panel tab (or "Admin") to come
// back home. The cockpit polls a tiny overview every ~2s and owns the
// maintenance switch.

const $ = (s) => document.querySelector(s);
let panels = {};      // { menu:{label,url,up}, ... } from /api/panels
let current = "home"; // which tab is active

const toast = (msg, ok = true) => {
  const t = document.createElement("div");
  t.className = "toast" + (ok ? "" : " bad");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 4000);
};
const confirmDialog = (text) => new Promise((resolve) => {
  $("#confirmText").textContent = text;
  $("#confirmOverlay").hidden = false;
  $("#confirmYes").onclick = () => { $("#confirmOverlay").hidden = true; resolve(true); };
  $("#confirmNo").onclick = () => { $("#confirmOverlay").hidden = true; resolve(false); };
});

// ── the switcher ─────────────────────────────────────────────────────────────
function show(panel) {
  current = panel;
  document.querySelectorAll(".sw").forEach((b) => b.classList.toggle("active", b.dataset.panel === panel));
  const frame = $("#frame"), home = $("#home");
  if (panel === "home") {
    frame.hidden = true; frame.src = "about:blank"; // unload the panel so its polling stops
    home.hidden = false;
    refresh();
  } else {
    home.hidden = true;
    frame.hidden = false;
    const p = panels[panel];
    if (p && frame.dataset.panel !== panel) { frame.src = p.url; frame.dataset.panel = panel; }
  }
}
document.querySelectorAll(".sw").forEach((b) => (b.onclick = () => {
  // Tapping the ACTIVE panel tab again brings you home (toggle behaviour).
  if (b.dataset.panel === current && current !== "home") show("home");
  else show(b.dataset.panel);
}));

// ── the cockpit ──────────────────────────────────────────────────────────────
async function loadPanels() {
  try { panels = await (await fetch("/api/panels")).json(); } catch { panels = {}; }
  // health dots in the switcher
  for (const k of ["menu", "editor", "kitchen", "tablet"]) {
    const dot = $("#dot-" + k);
    if (dot) dot.className = "dot " + (panels[k] && panels[k].up ? "up" : "down");
  }
  // launch cards on the home screen
  $("#launch").innerHTML = Object.entries(panels).map(([k, p]) =>
    `<button class="launch-btn" data-open="${k}"><span class="lb-emoji">${({menu:"🍽️",editor:"✏️",kitchen:"🍳",tablet:"🧑‍🍳"})[k]}</span>
       <span class="lb-name">${p.label}</span>
       <span class="lb-status ${p.up ? "up" : "down"}">${p.up ? "running" : "offline"}</span></button>`).join("");
  document.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => show(b.dataset.open)));
}

async function refresh() {
  if (current !== "home") return; // only poll while the cockpit is showing
  let o;
  try { o = await (await fetch("/api/overview")).json(); } catch { return; }
  $("#s-tables").textContent = o.openTables;
  $("#s-active").textContent = o.activeOrders;
  $("#s-unpaid").textContent = o.unpaidOrders;
  $("#s-rev").textContent = "₹" + (o.revenueToday || 0).toLocaleString("en-IN");
  // maintenance toggle reflects the live state
  const tg = $("#maint-toggle");
  tg.textContent = o.maintenance ? "ON" : "OFF";
  tg.classList.toggle("on", o.maintenance);
  tg.setAttribute("aria-pressed", o.maintenance ? "true" : "false");
  $("#maint-card").classList.toggle("is-on", o.maintenance);
  $("#maint-desc").textContent = o.maintenance
    ? "🔴 LIVE: guests currently see the maintenance screen. Turn OFF to reopen the menu."
    : "When ON, guests see a \"we'll be right back\" screen instead of the menu. Staff panels keep working.";
  // restaurant meta
  const feats = o.features || {};
  const offFeats = Object.entries(feats).filter(([, v]) => v === false).map(([k]) => k);
  $("#meta-grid").innerHTML = `
    <div><small>Dining sessions</small><b>${o.sessionsEnabled ? "ON" : "OFF"}</b></div>
    <div><small>Tables</small><b>${o.tableCount || "—"}</b></div>
    <div><small>Orders today</small><b>${o.ordersToday}</b></div>
    <div><small>Features off</small><b>${offFeats.length ? offFeats.join(", ") : "none (all on)"}</b></div>`;
}

// maintenance switch — two-step confirm (it takes the whole menu offline)
$("#maint-toggle").onclick = async () => {
  const turningOn = $("#maint-toggle").textContent === "OFF";
  const msg = turningOn
    ? "Turn ON maintenance mode? Guests will immediately see the \"we'll be right back\" screen instead of the menu."
    : "Turn OFF maintenance mode and reopen the menu to guests?";
  if (!(await confirmDialog(msg))) return;
  try {
    await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: turningOn }) });
    toast(turningOn ? "Maintenance ON — menu is offline for guests" : "Maintenance OFF — menu reopened");
    refresh();
  } catch (e) { toast("Failed: " + e.message, false); }
};

loadPanels();
show("home");
setInterval(loadPanels, 5000); // panel health
setInterval(refresh, 2000);    // cockpit numbers (only polls while home is shown)
