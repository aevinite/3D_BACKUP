/* =============================================================================
   app.js — the shell: the five-way switcher, the breadcrumb, the two top tabs,
   and the wiring for the layout-specific interactions.
============================================================================= */

import {
  state, RESTAURANTS, GROUPS, PERM_BY_ID, allConflicts, onChange, emit, sortedPeople,
  setOverride, ROLE_LABEL,
} from "./data.js";
import { icon } from "./icons.js";
import { bindControls, setJumpHandler, openSet, closeInfo } from "./controls.js";
import {
  layoutRail, layoutBento, layoutNews, layoutMason, layoutMatrix, layoutPerson,
  openSections, masonFilter, activeGroup, setActiveGroup,
} from "./layouts.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const LAYOUTS = [
  { id: "rail", n: "1", name: "Rail + accordion", note: "Quiet index on the left, one area open at a time. Reads like a settings app." },
  { id: "bento", n: "2", name: "Bento", note: "Everything at once, tile size tells you what matters. Nothing more than one tap deep." },
  { id: "news", n: "3", name: "Editorial", note: "A broadsheet of policy — columns, rules, serif headlines. Made to be read, not scanned." },
  { id: "mason", n: "4", name: "Card wall", note: "No sections at all. Filter to what you care about; cards open in place." },
  { id: "matrix", n: "5", name: "Command centre", note: "Every rung as a column. Audit the whole restaurant in one screen." },
];

const RENDER = { rail: layoutRail, bento: layoutBento, news: layoutNews, mason: layoutMason, matrix: layoutMatrix };

/* ------------------------------------------------------------- switcher --- */

function paintSwitcher() {
  const r = state.r;
  document.getElementById("switcher").innerHTML = `<div class="sw-in">
    <div class="sw-brand"><span class="dot"></span><span>Access panel<small>5 design directions</small></span></div>
    <div class="sw-tabs" role="tablist" aria-label="Design">
      ${LAYOUTS.map((l) => `<button class="sw-tab" data-act="layout" data-id="${l.id}" role="tab"
        aria-selected="${state.layout === l.id}"><span class="n">${l.n}</span>${esc(l.name)}</button>`).join("")}
    </div>
    <div class="sw-right">
      <span class="sw-note">${esc(LAYOUTS.find((l) => l.id === state.layout).note)}</span>
      <label class="rpick">
        <span class="av" style="background:${r.accent}">${esc(r.initials)}</span>
        <select id="rsel" aria-label="Restaurant">
          ${RESTAURANTS.map((x, i) => `<option value="${i}" ${i === state.restaurantIndex ? "selected" : ""}>${esc(x.name)}</option>`).join("")}
        </select>
      </label>
    </div>
  </div>`;
  document.getElementById("rsel").addEventListener("change", (e) => {
    state.restaurantIndex = +e.target.value;
    state.personId = null; state.personFilter = null;
    openSet.clear();
    emit();
  });
}

/* ------------------------------------------------------------ the page ---- */

function paint() {
  const r = state.r;
  const conf = allConflicts();

  const warn = conf.length && state.tab === "general" ? `<div class="warnbar">${icon("alert")}
    <span><b>${conf.length} ${conf.length === 1 ? "power has" : "powers have"} a manager set above the owner.</b>
    A manager can never hold something the owner does not — ${conf.map((c) => esc(c.name)).join(", ")}.
    Open ${conf.length === 1 ? "it" : "them"} and either give the owner the same option, or untick it for the manager.</span>
    </div>` : "";

  document.getElementById("page").innerHTML = `
    <nav class="crumb" aria-label="Breadcrumb">
      <a href="#" data-act="nav">Dashboard</a><span class="sep">${icon("chevronR", "ico ico-sm")}</span>
      <a href="#" data-act="nav">Restaurants</a><span class="sep">${icon("chevronR", "ico ico-sm")}</span>
      <a href="#" data-act="nav">${esc(r.name)}</a><span class="sep">${icon("chevronR", "ico ico-sm")}</span>
      <span class="cur">Access</span>
    </nav>
    <button class="backbtn" data-act="nav">${icon("arrowL", "ico ico-sm")} Back to ${esc(r.name)}</button>
    <header class="phead">
      <div>
        <h1>Access &amp; permissions</h1>
        <div class="sub">${esc(r.name)} · ${esc(r.kind)} · ${r.people.length} people</div>
      </div>
      <div class="spacer"></div>
      <div class="mtabs" role="tablist">
        <button class="mtab" data-act="tab" data-v="general" role="tab" aria-selected="${state.tab === "general"}">
          ${icon("shield", "ico ico-sm")} General</button>
        <button class="mtab" data-act="tab" data-v="person" role="tab" aria-selected="${state.tab === "person"}">
          ${icon("users", "ico ico-sm")} Per person</button>
      </div>
    </header>
    ${warn}
    ${state.tab === "general" ? RENDER[state.layout]() : layoutPerson()}`;

  if (state.tab === "general" && (state.layout === "rail" || state.layout === "matrix")) observeSections();
}

/* Scroll-spy: keeps the rail / mini-nav in step with what you are looking at. */
let io = null;
function observeSections() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    const hit = entries.filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!hit) return;
    const g = hit.target.dataset.g || hit.target.id.replace("sect-", "");
    if (g === activeGroup) return;
    setActiveGroup(g);
    document.querySelectorAll("[data-act='railjump']").forEach((b) => {
      b.setAttribute("aria-current", String(b.dataset.g === g));
    });
  }, { rootMargin: "-88px 0px -60% 0px", threshold: 0 });
  document.querySelectorAll("[id^='sect-']").forEach((el) => io.observe(el));
}

/* ------------------------------------------------------- layout wiring ---- */

function bindShell() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;

    if (a === "layout") {
      state.layout = b.dataset.id;
      closeInfo(); scrollTo({ top: 0, behavior: "instant" });
      paintSwitcher(); paint(); return;
    }
    if (a === "tab") { state.tab = b.dataset.v; if (state.tab === "general") state.personFilter = null; paint(); return; }
    if (a === "nav") { e.preventDefault(); flash("This is where the panel returns to — the restaurant you came from, not the dashboard."); return; }
    if (a === "sect") {
      const g = b.dataset.g;
      openSections.has(g) ? openSections.delete(g) : openSections.add(g);
      paint(); return;
    }
    if (a === "railjump") {
      const g = b.dataset.g;
      openSections.add(g); setActiveGroup(g); paint();
      requestAnimationFrame(() => {
        const el = document.getElementById("sect-" + g);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    if (a === "mfilter") {
      const g = b.dataset.g;
      if (g === "__all") masonFilter.clear();
      else masonFilter.has(g) ? masonFilter.delete(g) : masonFilter.add(g);
      paint(); return;
    }
    if (a === "person") { state.personId = b.dataset.id; state.personFilter = null; paint(); return; }
    if (a === "ov") {
      const p = state.r.people.find((x) => x.id === b.dataset.p);
      setOverride(p, b.dataset.id, b.dataset.v); return;
    }
    if (a === "resetov") {
      const p = state.r.people.find((x) => x.id === b.dataset.p);
      p.overrides = {}; emit(); return;
    }
    if (a === "clearfilter") { state.personFilter = null; paint(); return; }
  });
}

/* "Who has this →" — jump to Per person filtered to that capability. */
setJumpHandler((permId) => {
  state.tab = "person";
  state.personFilter = permId;
  const holders = sortedPeople().filter((p) => (p.overrides[permId] || "default") !== "default");
  state.personId = (holders[0] || sortedPeople()[0]).id;
  paint();
  scrollTo({ top: 0, behavior: "smooth" });
});

/* a tiny toast so the mock's non-wired bits explain themselves */
function flash(msg) {
  let t = document.getElementById("flash");
  if (!t) {
    t = document.createElement("div"); t.id = "flash";
    t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1200;background:var(--s3);border:1px solid var(--line2);color:var(--tx);padding:12px 18px;border-radius:12px;font-size:13.5px;box-shadow:var(--shadow-3);max-width:min(520px,92vw);text-align:center";
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.opacity = "0"; }, 3800);
  t.style.transition = "opacity 300ms";
}

/* ---------------------------------------------------------------- boot ---- */

bindControls();
bindShell();
onChange(paint);
paintSwitcher();
paint();
