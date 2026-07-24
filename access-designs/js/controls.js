/* =============================================================================
   controls.js — every interactive control, written ONCE.
   -----------------------------------------------------------------------------
   The five layouts differ in how they ARRANGE permissions. They must not differ
   in how a permission BEHAVES, or the owner would be judging five different
   products instead of five views of one. So the stepper, the [Owner can… |
   Manager can…] sub-tabs, the chips with their M/O cross-badges, the red
   "a manager can't exceed the owner" warning, the waiter rung and the (i)
   screenshot popover all live here and are reused verbatim.
============================================================================= */

import {
  state, PERM_BY_ID, GROUP_BY_ID, lad, gateOn, summary, conflicts, maxReach,
  setLevel, setMaster, setSub, setGate, setSwitch, getSwitch, setWaiter, setLimit,
  holdersOf, emit, onChange,
} from "./data.js";
import { icon, mockShot } from "./icons.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Which side-tab each power is showing, and which powers are expanded.
   Kept here so switching layout does not lose your place. */
export const sideOf = new Map();
export const openSet = new Set();

/* ------------------------------------------------------------------ (i) --- */

export function infoBtn(permId, subId) {
  return `<button class="info" data-act="info" data-perm="${permId}"${subId ? ` data-sub="${subId}"` : ""}
    aria-label="What does this do?">${icon("info")}</button>`;
}

function openInfo(btn) {
  const perm = PERM_BY_ID[btn.dataset.perm];
  const subId = btn.dataset.sub;
  const sub = subId && perm.sub ? perm.sub.find((s) => s.id === subId) : null;
  const title = sub ? sub.name : perm.name;
  const what = sub ? sub.what : perm.what;
  const adminOnly = sub ? sub.adminOnly : perm.adminOnly;
  const locked = sub ? sub.locked : false;
  const pop = document.getElementById("infopop");

  pop.innerHTML = `
    <button class="close" data-act="closeinfo" aria-label="Close">${icon("x", "ico ico-sm")}</button>
    <h4>${esc(title)}
      ${adminOnly ? `<span class="tag-admin">${icon("shield", "ico ico-sm")}Admin only</span>` : ""}
      ${locked ? `<span class="tag-admin tag-lock">${icon("lock", "ico ico-sm")}Never delegated</span>` : ""}
    </h4>
    <p>${esc(what)}</p>
    ${sub ? `<p style="margin-top:8px;color:var(--tx3);font-size:12.2px">Part of <b style="color:var(--tx2)">${esc(perm.name)}</b></p>` : ""}
    <button class="shotbtn" data-act="shot" data-key="${perm.shot}" data-note="${esc(perm.shotNote || "")}">
      ${icon("image")} Show me where this is in the app
      <span class="k">loads on tap</span>
    </button>
    <div class="shotslot"></div>`;

  pop.dataset.open = "1";
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(Math.max(12, r.left - w / 2 + 11), innerWidth - w - 12);
  let top = r.bottom + 10;
  if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 10);
  pop.style.left = left + "px";
  pop.style.top = top + "px";
}

function revealShot(btn) {
  // Lazy on purpose: a panel with 60 permissions must never ship 60 screenshots.
  const slot = btn.parentElement.querySelector(".shotslot");
  slot.innerHTML = `<div class="shotwrap">
      ${mockShot(btn.dataset.key, btn.dataset.note)}
      <div class="shotcap">${icon("maximize", "ico ico-sm")} Tap the image to enlarge · the ring marks the control</div>
    </div>`;
  slot.querySelector(".mockshot").addEventListener("click", () => {
    const lb = document.getElementById("lightbox");
    lb.querySelector(".inner").innerHTML =
      mockShot(btn.dataset.key, btn.dataset.note) + `<div class="cap">${esc(btn.dataset.note)} — the ringed control is what this permission switches</div>`;
    lb.dataset.open = "1";
  });
  btn.remove();
}

export const closeInfo = () => { const p = document.getElementById("infopop"); if (p) p.dataset.open = "0"; };

/* -------------------------------------------------------------- summary --- */

export function pill(perm) {
  const s = summary(perm);
  return `<span class="pill pill--${s.tone}"><i class="led"></i>${esc(s.label)}${s.detail ? `<span class="det">${s.detail}</span>` : ""}</span>`;
}

/* ------------------------------------------------------- a simple switch --- */

export function switchRow(permId, subId, name, desc, on, opts = {}) {
  const target = subId || permId;
  const d = opts.disabled ? "disabled" : "";
  return `<div class="swrow ${on ? "" : "is-off"}">
    <button class="swmain" data-act="switch" data-id="${target}" role="switch" aria-checked="${on}" ${d}>
      <span class="nm">${esc(name)}${opts.adminOnly ? ` <span class="tag-admin">${icon("shield", "ico ico-sm")}Admin only</span>` : ""}</span>
      ${desc ? `<span class="ds">${esc(desc)}</span>` : ""}
    </button>
    ${infoBtn(permId, subId)}
    <button class="swtoggle" data-act="switch" data-id="${target}" tabindex="-1" aria-hidden="true" ${d}>
      <span class="sw" ${on ? 'aria-checked="true"' : ""}></span>
    </button>
  </div>`;
}

export function renderSwitch(perm) {
  const on = getSwitch(perm.id);
  const blocked = perm.requires && !getSwitch(perm.requires);
  const desc = blocked ? `Needs “${PERM_BY_ID[perm.requires].name}” to be on first.` : perm.what;
  const subs = (perm.sub || []).map((s) =>
    `<div class="subswitch">${switchRow(perm.id, s.id, s.name, "", getSwitch(s.id))}</div>`).join("");
  return `<div class="swblock">
    ${switchRow(perm.id, null, perm.name, desc, on, { adminOnly: perm.adminOnly, disabled: blocked })}
    ${on ? subs : ""}
  </div>`;
}

/* --------------------------------------------- the reach control (Owner → …) */

function reachControl(perm, l) {
  const max = maxReach(perm);           // 2 = manager, 3 = tablet
  const steps = [[1, "Owner", "crown"], [2, "+ Manager", "users"]];
  if (max >= 3) steps.push([3, "+ Tablet", "user"]);
  return `<div class="reach" role="radiogroup" aria-label="How far ${esc(perm.name)} reaches"
      style="--cols:${steps.length}">
    ${steps.map(([v, lbl, ic]) => `<button class="rstep" data-act="level" data-id="${perm.id}" data-v="${v}"
      data-v="${v}" role="radio" aria-checked="${l.level === v}">${icon(ic, "ico ico-sm")}${lbl}</button>`).join("")}
  </div>`;
}

/* ------------------------------------------------------ the waiter rung --- */

function renderWaiterRung(perm, l) {
  // Only shown once the reach includes the tablet (level 3). At that point the
  // tablet IS on — the only remaining question is whether it needs a PIN. So no
  // "Off" here (owner's model: to switch waiters off, lower the reach instead).
  if (!perm.waiter || l.level < 3) return "";
  const v = l.waiter === "pin" ? "pin" : "on";
  const opts = [["on", "Straight on", "check"], ["pin", "On, ask for a PIN", "key"]];
  return `<div class="waiterrow">
    <span class="lbl">${icon("user")} Every waiter, by default
      <small>This is the restaurant-wide default. Change it for one person on the Per person tab.</small></span>
    <div class="tri" role="radiogroup" aria-label="Waiter default for ${esc(perm.name)}">
      ${opts.map(([val, lbl, ic]) => `<button data-act="waiter" data-id="${perm.id}" data-v="${val}"
        role="radio" aria-checked="${v === val}">${icon(ic, "ico ico-sm")}${lbl}</button>`).join("")}
    </div>
  </div>`;
}

/* --------------------------------------------------- "Who has this →" ----- */

function renderWho(perm) {
  const n = holdersOf(perm.id).length;
  return `<button class="wholink" data-act="who" data-id="${perm.id}">
    ${icon("users", "ico ico-sm")} Who actually has this right now? <span class="n">${n}</span> ${icon("arrowR", "ico ico-sm")}
  </button>`;
}

/* ------------------------------------------------------- the full ladder --- */

export function renderLadder(perm) {
  const l = lad(perm.id);
  const gated = perm.gate && !gateOn(perm);
  const side = sideOf.get(perm.id) || "owner";
  const conf = conflicts(perm);

  const gateBar = perm.gate ? `<div class="gatebar">
      <span class="lbl">Admin allows this restaurant to have “${esc(perm.name)}”
        <small>${gateOn(perm) ? "Allowed. The owner decides who uses it below." : "Not allowed — nothing below applies, and the server refuses it too."}</small></span>
      <button class="sw" data-act="gate" data-gate="${perm.gate}" role="switch"
        aria-checked="${gateOn(perm)}" aria-label="Admin allows ${esc(perm.name)}"></button>
    </div>` : "";

  if (gated) {
    return gateBar + `<div class="pbody-in" style="padding:16px">
      <div class="hint">${icon("shield")}<span>Switched off for this restaurant. Nobody sees it and the server refuses it — switch “Admin allows” on to open up the settings below.</span></div>
    </div>`;
  }

  // When off, the body is just the explanation — the master toggle in the header
  // is what turns it on (→ Owner). No 3-segment stepper any more.
  if (l.level === 0) {
    return gateBar + `<div class="pbody-in">
      <div class="hint" style="margin-bottom:0">${icon("info")}<span>Off — nobody has this. Flip the switch above to give it to the <b>owner</b>, then widen the reach to the manager or waiters below.</span></div>
    </div>`;
  }

  const nOwner = perm.sub ? perm.sub.filter((s) => l.owner[s.id]).length : 0;
  const nMgr = perm.sub ? perm.sub.filter((s) => l.manager[s.id]).length : 0;
  const canMgr = l.level >= 2;

  const tabs = `<div class="sides" role="tablist">
    <button class="side" data-side="owner" data-act="side" data-id="${perm.id}" role="tab"
      aria-selected="${side === "owner"}">${icon("crown", "ico ico-sm")} Owner can…
      ${perm.sub ? `<span class="cnt">${nOwner}/${perm.sub.length}</span>` : ""}</button>
    <button class="side" data-side="manager" data-act="side" data-id="${perm.id}" role="tab"
      aria-selected="${side === "manager"}" ${canMgr ? "" : "disabled"}>${icon("users", "ico ico-sm")} Manager can…
      ${perm.sub ? `<span class="cnt">${canMgr ? `${nMgr}/${perm.sub.length}` : "—"}</span>` : ""}</button>
  </div>`;

  const shown = side === "manager" && canMgr ? "manager" : "owner";

  let chips = "";
  if (perm.sub) {
    chips = `<div class="chips" data-side="${shown}">` + perm.sub.map((s) => {
      const on = !!l[shown][s.id];
      const other = shown === "owner" ? !!l.manager[s.id] : !!l.owner[s.id];
      const showBadge = shown === "owner" ? (other && canMgr) : other;
      const badgeCls = shown === "owner" ? "m" : "o";
      const badgeTxt = shown === "owner" ? "M" : "O";
      const badgeTip = shown === "owner" ? "Also on for the manager" : "Also on for the owner";
      // admin-only sub-options are never available on the manager side
      const disabled = (s.locked) || (s.adminOnly && shown === "manager");
      const isConflict = shown === "manager" && on && !l.owner[s.id];
      return `<div class="chipwrap ${isConflict ? "is-conflict" : ""} ${disabled ? "is-disabled" : ""}" data-on="${on ? 1 : 0}">
        <button class="chip" data-act="sub" data-id="${perm.id}" data-side="${shown}" data-sub="${s.id}"
          role="checkbox" aria-checked="${on}" ${disabled ? "disabled" : ""}>
          <span class="box">${icon("check")}</span>
          <span>${esc(s.name)}</span>
          ${s.adminOnly ? `<span class="tag-admin">${icon("shield", "ico ico-sm")}Admin</span>` : ""}
          ${s.locked ? `<span class="tag-admin tag-lock">${icon("lock", "ico ico-sm")}Locked</span>` : ""}
        </button>
        ${showBadge ? `<span class="xbadge xbadge--${badgeCls}" title="${badgeTip}">${badgeTxt}</span>` : ""}
        ${infoBtn(perm.id, s.id)}
      </div>`;
    }).join("") + `</div>`;
  }

  const hint = shown === "owner"
    ? `${icon("crown")}<span>Tick what the <b>owner</b> may do. A small gold <b>M</b> on a chip means the manager has that one too.</span>`
    : `${icon("users")}<span>Tick what the <b>manager</b> may do. A green <b>O</b> means the owner has it as well — a manager can never hold something the owner does not.</span>`;

  let limit = "";
  if (perm.limit) {
    const cur = (l.limit || {})[shown] ?? perm.limit.options[0];
    limit = `<div class="limit">
      <span class="lbl">${perm.limit.label} — ${shown === "owner" ? "owner" : "manager"}
        <small>Anything above this is refused, not just hidden.</small></span>
      <div class="segs" role="radiogroup" aria-label="${esc(perm.limit.label)}">
        ${perm.limit.options.map((o) => `<button class="seg" data-act="limit" data-id="${perm.id}" data-side="${shown}"
          data-v="${o}" role="radio" aria-checked="${cur === o}">${o}${perm.limit.unit}</button>`).join("")}
      </div></div>`;
  }

  const conflict = conf.length ? `<div class="conflict">${icon("alert")}
      <span><b>The manager is set to do something the owner cannot:</b> ${conf.map(esc).join(", ")}.
      A manager can never exceed the owner — either give it to the owner too, or untick it for the manager.</span>
      <button data-act="fixconflict" data-id="${perm.id}">Fix it</button>
    </div>` : "";

  const reachHint = perm.sub ? "" :
    `<div class="hint" style="margin:-2px 0 12px">${icon("info")}<span>${esc(perm.name)} has no extra options — just choose how far it reaches.</span></div>`;

  return gateBar + `<div class="pbody-in">
    ${reachControl(perm, l)}
    <div style="height:14px"></div>
    ${reachHint}
    ${perm.sub ? tabs : ""}
    ${perm.sub ? `<div class="hint">${hint}</div>` : ""}
    ${chips}
    ${limit}
    ${renderWaiterRung(perm, l)}
    ${conflict}
    ${renderWho(perm)}
  </div>`;
}

/* Dispatch: gives any layout the right control for any permission. */
export function renderFull(perm) {
  if (perm.kind === "switch") return `<div style="padding:8px">${renderSwitch(perm)}</div>`;
  return renderLadder(perm);
}

/* A complete, self-contained expandable card — used by the layouts that edit
   in place rather than in the drawer. The header carries the MASTER TOGGLE
   (owner's model: toggle on → Owner + open; toggle off → close + reset). */
export function permCard(perm, opts = {}) {
  const open = openSet.has(perm.id);
  const g = GROUP_BY_ID[perm.group];
  const l = lad(perm.id);
  const gated = perm.gate && !gateOn(perm);
  const on = l.level >= 1;
  const reachTxt = !on ? "Off" : l.level === 1 ? "Owner only" : l.level === 2 ? "Owner + Manager" : "Owner + Mgr + Tablet";
  return `<article class="pcard ${open ? "is-open" : ""} ${gated ? "is-gated" : ""} ${on ? "is-on" : ""}" data-perm="${perm.id}" id="card-${perm.id}">
    <div class="phead2">
      <button class="phbtn" data-act="toggle" data-id="${perm.id}" aria-expanded="${open}">
        ${opts.icon !== false ? `<span class="gicon" style="--h:${g.hue}">${icon(g.icon)}</span>` : ""}
        <span class="body">
          <span class="nm">${esc(perm.name)}
            ${perm.adminOnly ? `<span class="tag-admin">${icon("shield", "ico ico-sm")}Admin only</span>` : ""}
          </span>
          ${opts.blurb === false ? "" : `<span class="ds">${esc(perm.what)}</span>`}
        </span>
      </button>
      <span class="phctl">
        ${gated ? "" : `<span class="reachtag ${on ? "on" : ""}">${esc(reachTxt)}</span>
        <button class="sw" data-act="master" data-id="${perm.id}" role="switch" aria-checked="${on}"
          aria-label="Turn ${esc(perm.name)} on"></button>`}
        <button class="chevbtn" data-act="toggle" data-id="${perm.id}" aria-label="Expand">${icon("chevron", "ico chev")}</button>
      </span>
    </div>
    ${open ? `<div class="pbody">${renderFull(perm)}</div>` : ""}
  </article>`;
}

/* ------------------------------------------------------ the shared drawer --- */

export function openDrawer(permId) {
  const perm = PERM_BY_ID[permId];
  const g = GROUP_BY_ID[perm.group];
  const d = document.getElementById("drawer");
  d.dataset.perm = permId;
  d.querySelector(".dhead").innerHTML = `
    <span class="gicon gicon-lg" style="--h:${g.hue}">${icon(g.icon, "ico ico-lg")}</span>
    <span style="flex:1;min-width:0">
      <span class="grp">${esc(g.name)}</span>
      <h3>${esc(perm.name)}</h3>
    </span>
    <button class="close" data-act="closedrawer" aria-label="Close">${icon("x")}</button>`;
  paintDrawer();
  d.dataset.open = "1";
  document.getElementById("scrim").dataset.open = "1";
}

function paintDrawer() {
  const d = document.getElementById("drawer");
  if (d.dataset.open !== "1" && !d.dataset.perm) return;
  const perm = PERM_BY_ID[d.dataset.perm];
  if (!perm) return;
  const l = lad(perm.id);
  const on = perm.kind !== "switch" && l.level >= 1;
  const masterRow = perm.kind === "switch" ? "" : `<div class="drawer-master ${on ? "is-on" : ""}">
      <span class="lbl">${on ? "This power is on" : "This power is off"}
        <small>${on ? "Choose how far it reaches below." : "Turn it on to give it to the owner, then widen the reach."}</small></span>
      <button class="sw" data-act="master" data-id="${perm.id}" role="switch" aria-checked="${on}" aria-label="Turn ${esc(perm.name)} on"></button>
    </div>`;
  d.querySelector(".dbody").innerHTML =
    `<p style="margin:0 0 16px;font-size:13.4px;line-height:1.55;color:var(--tx2)">${esc(perm.what)}</p>` +
    masterRow + renderFull(perm);
}

export function closeDrawer() {
  document.getElementById("drawer").dataset.open = "0";
  document.getElementById("scrim").dataset.open = "0";
  document.getElementById("drawer").dataset.perm = "";
}

/* --------------------------------------------------------- event wiring --- */

let jumpToPerson = null;
export const setJumpHandler = (fn) => { jumpToPerson = fn; };

export function bindControls() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) {
      if (!e.target.closest("#infopop")) closeInfo();
      return;
    }
    const a = btn.dataset.act;
    const id = btn.dataset.id;

    switch (a) {
      case "info": e.stopPropagation(); openInfo(btn); return;
      case "closeinfo": closeInfo(); return;
      case "shot": revealShot(btn); return;
      case "switch": setSwitch(id, !getSwitch(id)); break;
      case "gate": setGate(btn.dataset.gate, !state.r.gates[btn.dataset.gate]); break;
      case "level": setLevel(id, +btn.dataset.v); break;
      case "master": {
        const turningOn = !(lad(id).level >= 1);
        // set open-state BEFORE setMaster (which emits and re-renders)
        if (turningOn) openSet.add(id); else openSet.delete(id);
        setMaster(id, turningOn);
        break;
      }
      case "side": sideOf.set(id, btn.dataset.side); emit(); break;
      case "sub": {
        const l = lad(id);
        setSub(id, btn.dataset.side, btn.dataset.sub, !l[btn.dataset.side][btn.dataset.sub]);
        break;
      }
      case "limit": setLimit(id, btn.dataset.side, +btn.dataset.v); break;
      case "waiter": setWaiter(id, btn.dataset.v); break;
      case "fixconflict": {
        // The safe repair: lift the owner up to cover the manager, never silently
        // strip the manager (the owner asked for BOTH sides to be preserved).
        const perm = PERM_BY_ID[id]; const l = lad(id);
        perm.sub.forEach((s) => { if (l.manager[s.id]) l.owner[s.id] = true; });
        emit();
        break;
      }
      case "toggle": openSet.has(id) ? openSet.delete(id) : openSet.add(id); emit(); break;
      case "opendrawer": openDrawer(id); return;
      case "closedrawer": closeDrawer(); return;
      case "who": if (jumpToPerson) jumpToPerson(id); return;
      default: return;
    }
    closeInfo();
  });

  document.getElementById("scrim").addEventListener("click", closeDrawer);
  document.getElementById("lightbox").addEventListener("click", (e) => {
    if (e.target.closest(".mockshot") && !e.target.closest(".close")) return;
    e.currentTarget.dataset.open = "0";
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const lb = document.getElementById("lightbox");
    if (lb.dataset.open === "1") { lb.dataset.open = "0"; return; }
    if (document.getElementById("infopop").dataset.open === "1") { closeInfo(); return; }
    if (document.getElementById("drawer").dataset.open === "1") closeDrawer();
  });
  addEventListener("scroll", closeInfo, true);

  onChange(paintDrawer);
}
