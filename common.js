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
