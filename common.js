// Shared by every page: API calls (sending to the sign-in page when the session has ended) and the user bar.
"use strict";

const $ = id => document.getElementById(id);
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clock = sec => `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function toLogin() {
  location.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
}

async function api(url, options = {}) {
  const r = await fetch(url, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (r.status === 401 && !url.includes("auth/")) { toLogin(); throw new Error("Signed out"); }
  if (!r.ok) {
    let message = r.statusText;
    try { const p = await r.json(); message = p.detail || p.title || message; } catch { }
    throw new Error(message);
  }
  if (r.status === 204) return null;
  return (r.headers.get("content-type") || "").includes("json") ? r.json() : r.text();
}

// The features this installation is licensed for ({ liveDisplay, evaluation, instruction }); set by requireUser().
let features = { liveDisplay: true, evaluation: true, instruction: true };
const inSim = f => f.liveDisplay || f.evaluation;
// Each page names the feature it belongs to in <body data-feature>: "insim", "evaluation" or "instruction" (none: platform).
const pageAllowed = (page, f) => !page || (page === "insim" ? inSim(f) : !!f[page]);
const homePage = f => inSim(f) ? "./" : f.instruction ? "airbrake.html" : "admin.html";

/**
 * Returns the signed-in user, or goes to the sign-in page. Fills #userbar when the page has one, with links to the
 * licensed features only; a page whose feature isn't licensed goes to the home page instead.
 */
async function requireUser() {
  const status = await api("api/auth/status");
  if (!status.user) { toLogin(); throw new Error("Signed out"); }
  features = status.features || features;
  if (!pageAllowed(document.body.dataset.feature, features)) { location.replace(homePage(features)); throw new Error("Not licensed"); }
  document.body.classList.toggle("no-live-display", !features.liveDisplay);
  document.body.classList.toggle("no-evaluation", !features.evaluation);
  const u = status.user, bar = $("userbar");
  const links = [
    inSim(features) && '<a href="./">Live</a>',
    features.evaluation && '<a href="trips.html">Trips</a>',
    features.instruction && '<a href="airbrake.html">Brake Pipe Propagation Simulator</a><a href="locomotive.html">Locomotive and Car Air Rack</a><a href="rules.html">Rules</a>',
    u.canManageUsers && '<a href="admin.html">Admin</a>'
  ].filter(Boolean).join("");
  if (bar) bar.innerHTML = `
    <span class="who">${esc(u.displayName)} <span class="rr">${esc(u.railroadCode || "System")}</span></span>
    ${links}
    <a href="#" id="signOut">Sign out</a>`;
  if ($("signOut")) $("signOut").onclick = async e => { e.preventDefault(); await api("api/auth/logout", { method: "POST" }); location.href = "login.html"; };
  return u;
}

// A press-and-hold button (bail off): on() while held by mouse, finger or space bar, off() once when let go. The pointer is
// captured so a finger drifting off the button doesn't let go early, and touch-action:none stops the page from turning the
// hold into a scroll (which cancels it) or a long-press menu.
function holdButton(el, on, off) {
  let held = false;
  const press = e => { e.preventDefault(); if (held) return; held = true; el.classList.add("down"); on(); };
  const release = () => { if (!held) return; held = false; el.classList.remove("down"); off(); };
  el.style.touchAction = "none";
  el.addEventListener("pointerdown", e => { if (e.button > 0) return; el.setPointerCapture?.(e.pointerId); press(e); });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) el.addEventListener(ev, release);
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) press(e); });
  el.addEventListener("keyup", e => { if (e.key === " " || e.key === "Enter") release(); });
}

// The automatic brake handle as one slider, 0 (release) to 100 (emergency), with the 26L's stops marked. Between minimum
// and full service is the service zone; past full service the handle carries on into an over-reduction (down to 50 psi,
// LocoTuning.OverReductionMaxPsi) before the suppression, handle off and emergency stops. Release, minimum, suppression,
// handle off and emergency are detents: let go near one and the handle drops into it.
const AUTO = { min: 8, full: 52, over: 72, supp: 80, off: 89, minPsi: 6, fullPsi: 26, overPsi: 50 };
const AUTO_MARKS = [[0, "Rel", "Release"], [AUTO.min, "Min", "Minimum"], [AUTO.full, "Full", "Full service"],
  [AUTO.supp, "Sup", "Suppression"], [AUTO.off, "Off", "Handle off"], [100, "Emer", "Emergency"]];

function autoFromHandle(x) {
  if (x < 4) return { automatic: "Release", at: 0 };
  if (x < AUTO.min + 1) return { automatic: "Minimum", at: AUTO.min };
  if (Math.abs(x - AUTO.full) < 1) return { automatic: "FullService", at: AUTO.full, psi: AUTO.fullPsi };
  if (x < AUTO.over + 4) {
    x = Math.min(x, AUTO.over);
    const psi = x <= AUTO.full ? AUTO.minPsi + (x - AUTO.min) / (AUTO.full - AUTO.min) * (AUTO.fullPsi - AUTO.minPsi)
      : AUTO.fullPsi + (x - AUTO.full) / (AUTO.over - AUTO.full) * (AUTO.overPsi - AUTO.fullPsi);
    return { automatic: "Service", serviceFraction: (psi - AUTO.minPsi) / (AUTO.fullPsi - AUTO.minPsi), psi, at: x };
  }
  if (x < 85) return { automatic: "Suppression", at: AUTO.supp };
  if (x < 95) return { automatic: "HandleOff", at: AUTO.off };
  return { automatic: "Emergency", at: 100 };
}

function handleFromView(automatic, psi) {
  switch (automatic) {
    case "Release": return 0;
    case "Minimum": return AUTO.min;
    case "FullService": return AUTO.full;
    case "Suppression": return AUTO.supp;
    case "HandleOff": return AUTO.off;
    case "Emergency": return 100;
  }
  return psi <= AUTO.fullPsi ? AUTO.min + (psi - AUTO.minPsi) / (AUTO.fullPsi - AUTO.minPsi) * (AUTO.full - AUTO.min)
    : AUTO.full + (psi - AUTO.fullPsi) / (AUTO.overPsi - AUTO.fullPsi) * (AUTO.over - AUTO.full);
}

const autoText = h => h.automatic === "Service"
  ? (h.psi > AUTO.fullPsi + 0.5 ? `Over-reduction, ${Math.round(h.psi)} psi` : `Service, ${Math.round(h.psi)} psi`)
  : h.automatic === "FullService" ? `Full service, ${AUTO.fullPsi} psi` : ({ HandleOff: "Handle off" }[h.automatic] || h.automatic);

/** Builds the handle in <paramref name="el"/>; send(control) posts a move. Returns update(view) for the page's refresh. */
function autoHandle(el, send) {
  // Where a mark sits over the slider: the thumb (16 px) travels one thumb short of the track.
  const at = p => `calc(${p}% + ${8 - p * 0.16}px)`;
  const band = (from, to, cls) => `<span class="band ${cls}" style="left:${at(from)};width:calc(${to - from}% - ${(to - from) * 0.16}px)"></span>`;
  el.classList.add("autoh");
  el.innerHTML = `<div class="head"><span>Automatic</span><span class="out muted"></span></div>
    <input type="range" min="0" max="100" step="0.5" value="0" aria-label="Automatic brake handle">
    <div class="marks">${band(AUTO.min, AUTO.full, "svc")}${band(AUTO.full, AUTO.over, "over")}${band(95, 100, "emer")}
      ${AUTO_MARKS.map(([p, s, name], i) => `<span class="mark${i % 2 ? " low" : ""}" data-p="${p}" title="${name}" style="left:${at(p)}">${s}</span>`).join("")}</div>`;
  const input = el.querySelector("input"), out = el.querySelector(".out");
  let busy = 0;   // while dragging, and a moment after a move, the page's refresh doesn't fight the hand
  const show = h => { out.textContent = autoText(h); out.classList.toggle("warn", h.psi > AUTO.fullPsi + 0.5 || h.automatic === "Emergency"); };
  const move = x => {
    const h = autoFromHandle(x);
    input.value = h.at;
    show(h);
    busy = Date.now() + 1500;
    send({ automatic: h.automatic, serviceFraction: h.serviceFraction ?? 0 });
  };
  input.addEventListener("pointerdown", () => busy = Infinity);
  input.oninput = () => { busy = Infinity; show(autoFromHandle(+input.value)); };
  input.onchange = () => move(+input.value);
  for (const m of el.querySelectorAll(".mark")) m.onclick = () => move(+m.dataset.p);
  return v => {
    if (Date.now() < busy) return;
    input.value = handleFromView(v.automatic, v.reductionPsi);
    show({ automatic: v.automatic, psi: v.reductionPsi });
  };
}
