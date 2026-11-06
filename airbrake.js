// The air brake simulator page: live train, brake valve, instructor panels and the test trainer.
"use strict";

let view = null, trainer = null, procedures = [], selectedCar = null, lastTrainerKey = "";
const DEFECTS = [["NotApplied", "Not applied"], ["NotReleased", "Not released"], ["PistonTravel", "Piston travel"],
  ["AirLeak", "Air leak"], ["AngleCockClosed", "Angle cock closed"], ["RetainerSet", "Retainer set"], ["LocoSetup", "Set up wrong"]];
const post = (url, body) => api("api/airbrake/" + url, { method: "POST", body: body || {} }).catch(e => { alert(e.message); throw e; });

// ---- live -----------------------------------------------------------------------------------------------------

const conn = new signalR.HubConnectionBuilder().withUrl("hub/train").withAutomaticReconnect([0, 1000, 2000, 5000, 5000]).build();
conn.on("airbrake", v => { view = v; render(); });
conn.on("trainer", t => { trainer = t; renderTrainer(); });

function psi(v) { return v == null ? "--" : `${Math.round(v)}<small> psi</small>`; }

function render() {
  const v = view;
  if (!v) return;
  $("status").textContent = v.paused ? "Paused" : `Running ${v.speedFactor}x`;
  $("mr").innerHTML = psi(v.mainReservoirPsi); $("er").innerHTML = psi(v.equalizingPsi); $("bp").innerHTML = psi(v.brakePipePsi);
  $("bc").innerHTML = psi(v.locoCylinderPsi); $("flow").innerHTML = `${Math.round(v.flowScfm)}<small> cfm</small>`;
  $("eot").innerHTML = v.eotPsi == null ? "no comm" : psi(v.eotPsi); $("eotTile").classList.toggle("warnt", v.eotPsi == null);
  $("auto").textContent = label(v.automatic) + (v.reductionPsi > 0 && v.automatic !== "Emergency" ? ` (${Math.round(v.reductionPsi)})` : "");
  $("cut").textContent = { Out: "OUT", Frt: "FRT", Pass: "PASS" }[v.cutOut] ?? "--"; $("cutTile").classList.toggle("warnt", !v.cutIn);
  $("pcs").textContent = v.pcsOpen ? "OPEN" : "Closed"; $("pcsTile").classList.toggle("alarm", v.pcsOpen);
  $("speed").innerHTML = `${v.speedMph.toFixed(0)}<small> mph</small>`;
  $("time").textContent = clock(v.time);
  $("trainInfo").textContent = `${v.units.length} units, ${Math.round(v.lengthFt).toLocaleString()} ft, ${Math.round(v.tons).toLocaleString()} tons, leakage ${v.trainLeakageScfm.toFixed(1)} cfm`
    + `, ${v.ambientF.toFixed(0)} °F` + (v.cylinderLeakageScfm >= 0.05 ? `, cylinder leakage ${v.cylinderLeakageScfm.toFixed(1)} cfm` : "")
    + (v.units.some(u => u.bcm) ? `, BCM drawing ${v.bcmScfm.toFixed(1)} cfm` : "");
  renderDp(v);
  if (document.activeElement !== $("cutSel")) $("cutSel").value = v.cutOut;
  $("bail").classList.toggle("on", v.bailOff);
  showHandle(v);
  document.querySelectorAll("#speeds button").forEach(b => b.classList.toggle("on", +b.dataset.s === v.speedFactor));
  $("pause").classList.toggle("on", v.paused);
  if (document.activeElement !== $("feed")) $("feed").value = v.feedValvePsi;
  fillSetup(v.setup);
  fillCars();
  drawGraph(); drawCars(); showCar();
}

const label = a => ({ FullService: "Full service", HandleOff: "Handle off" }[a] || a);

function setupCanvas(c) {
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function drawGraph() {
  const { g, w, h } = setupCanvas($("graph")), u = view.units, padL = 38, padR = 10, padT = 10, padB = 24;
  const max = Math.max(100, Math.ceil(Math.max(...u.map(x => x.auxPsi), view.mainReservoirPsi > 0 ? 0 : 0) / 10) * 10);
  const X = i => padL + (w - padL - padR) * (u.length === 1 ? 0 : i / (u.length - 1)), Y = p => padT + (h - padT - padB) * (1 - p / max);
  g.font = "11px Segoe UI"; g.fillStyle = "#8a8a8a"; g.strokeStyle = "#2c2c2c"; g.lineWidth = 1;
  for (let p = 0; p <= max; p += 20) { g.beginPath(); g.moveTo(padL, Y(p)); g.lineTo(w - padR, Y(p)); g.stroke(); g.fillText(p, 8, Y(p) + 4); }
  g.fillText("head end", padL, h - 6); g.textAlign = "right"; g.fillText("rear", w - padR, h - 6); g.textAlign = "left";
  // locomotives shaded
  const locos = u.filter(x => x.loco).length;
  if (locos) { g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(padL, padT, X(locos - 0.5) - padL, h - padT - padB); }
  const line = (key, color, width) => {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    u.forEach((x, i) => { const y = Y(x[key]); i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); }); g.stroke();
  };
  line("emergencyPsi", "#b38be8", 1.5); line("auxPsi", "#81c784", 1.5); line("cylinderPsi", "#ffa726", 2); line("brakePipePsi", "#4fc3f7", 2.5);
  if (selectedCar != null) { g.strokeStyle = "rgba(255,255,255,.35)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(selectedCar), padT); g.lineTo(X(selectedCar), h - padB); g.stroke(); g.setLineDash([]); }
}

function drawCars() {
  const { g, w, h } = setupCanvas($("cars")), u = view.units, total = u.reduce((s, x) => s + x.lengthFt, 0), pad = 6;
  let x = pad; const scale = (w - 2 * pad) / total;
  u.forEach((c, i) => {
    const cw = Math.max(1, c.lengthFt * scale - 1.5);
    const applied = c.pistonOut, f = Math.min(1, c.cylinderPsi / 60);
    g.fillStyle = c.cutOut ? "#555" : applied ? `rgba(255,${Math.round(167 - 90 * f)},38,${0.55 + 0.45 * f})` : (c.loco ? "#2f5d7a" : "#3a3f45");
    g.fillRect(x, 18, cw, 30);
    if (c.angleCockBehindClosed) { g.fillStyle = "#ff5a4f"; g.fillRect(x + cw - 2, 10, 3, 46); }
    if (c.leakScfm >= 5) { g.fillStyle = "#4fc3f7"; g.beginPath(); g.arc(x + cw / 2, 58, 3, 0, 7); g.fill(); }
    if (i === selectedCar) { g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(x - 1, 16, cw + 2, 34); }
    c._x0 = x; c._x1 = x + cw; x += c.lengthFt * scale;
  });
  g.fillStyle = "#8a8a8a"; g.font = "11px Segoe UI"; g.fillText("head end", pad, 12); g.textAlign = "right"; g.fillText(`rear - EOT ${view.eotPsi ?? "--"} psi`, w - pad, 12); g.textAlign = "left";
}

$("cars").onclick = e => {
  if (!view) return;
  const r = $("cars").getBoundingClientRect(), x = e.clientX - r.left;
  const i = view.units.findIndex(c => x >= c._x0 - 1 && x <= c._x1 + 1);
  if (i >= 0) { selectedCar = i; $("fcar").value = i; render(); }
};

function showCar() {
  if (selectedCar == null || !view.units[selectedCar]) return;
  const c = view.units[selectedCar];
  const faults = [c.cutOut && "cut out", c.leakScfm >= 1 && `leak ${c.leakScfm.toFixed(0)} cfm`, c.angleCockBehindClosed && "angle cock behind closed",
    c.hoseRestriction > 1 && "restricted hose behind", c.sticking && "sticking", c.extraApplyPsi > 0 && "insensitive", c.retainer !== "Exhaust" && `retainer ${c.retainer}`].filter(Boolean);
  $("carInfo").innerHTML = `<b>${selectedCar + 1}. ${esc(c.id)}</b> ${esc(c.kind)}${c.loco ? "" : c.loaded ? ", loaded" : ", empty"} &nbsp;
    BP ${c.brakePipePsi} · Aux ${c.auxPsi} · Emerg ${c.emergencyPsi} · Cyl ${c.cylinderPsi} psi · valve ${esc(c.valve)}${c.loco ? "" : ` · travel ${c.pistonTravelIn} in`}
    ${faults.length ? `<span style="color:var(--warn)"> · ${esc(faults.join(", "))}</span>` : ""}`;
}

let carsFilled = 0;
function fillCars() {
  if (carsFilled === view.units.length) return;
  carsFilled = view.units.length;
  $("fcar").innerHTML = view.units.map((c, i) => `<option value="${i}">${i + 1}. ${esc(c.id)}${c.loco ? " (loco)" : ""}</option>`).join("");
}

// ---- brake valve ------------------------------------------------------------------------------------------------

const showHandle = autoHandle($("autoHandle"), c => post("control", c));
$("ind").onchange = () => post("control", { independent: +$("ind").value / 100 });
holdButton($("bail"), () => post("control", { bailOff: true }), () => post("control", { bailOff: false }));
$("cutSel").onchange = () => post("control", { cutOut: $("cutSel").value });
$("feed").onchange = () => post("control", { feedValvePsi: +$("feed").value });
$("eotEmg").onclick = () => post("control", { eotEmergency: true });

// ---- instructor --------------------------------------------------------------------------------------------------

// The form follows the running train: filled whenever a different train starts (not while a field is being edited).
let formSetupKey = "";
function fillSetup(s) {
  const key = JSON.stringify(s);
  if (!s || key === formSetupKey || ["locos", "ncars", "loaded", "leak", "dp", "ambient", "bcm", "seals", "sealLeak"].includes(document.activeElement?.id)) return;
  formSetupKey = key;
  $("locos").value = s.locomotives; $("ncars").value = s.cars; $("loaded").value = s.loadedShare;
  $("leak").value = s.trainLeakageScfm; $("charged").checked = s.startCharged;
  $("dp").value = (s.remotes || []).map(r => `${r.afterCar >= s.cars ? "rear" : r.afterCar}:${r.units}`).join(", ");
  $("ambient").value = s.ambientF ?? 60; $("bcm").value = Math.round((s.bcmShare || 0) * 100);
  $("seals").value = Math.round((s.badCylinderSealShare || 0) * 100); $("sealLeak").value = s.badSealLeakScfm ?? 0.2;
  showRemotes();
}

const setupFromForm = () => ({ locomotives: +$("locos").value, cars: +$("ncars").value, loadedShare: +$("loaded").value,
  trainLeakageScfm: +$("leak").value, startCharged: $("charged").checked, feedValvePsi: +$("feed").value || 90, seed: Math.floor(Math.random() * 100000),
  remotes: parseRemotes($("dp").value, +$("ncars").value), ambientF: +$("ambient").value, bcmShare: Math.min(100, Math.max(0, +$("bcm").value)) / 100,
  badCylinderSealShare: Math.min(100, Math.max(0, +$("seals").value)) / 100, badSealLeakScfm: Math.max(0, +$("sealLeak").value) });

// "50:2, rear:1" -> a 2-unit remote after car 50 and a 1-unit remote on the rear. Either order works ("2:50" too): a remote
// is at most MAX_DP_UNITS units, so the bigger number is the car. A bare number ("50") is one unit after that car.
const MAX_DP_UNITS = 4;
const parseRemotes = (text, cars) => text.split(",").map(s => s.trim()).filter(Boolean).map(s => {
  const parts = s.split(/[:x@]/).map(x => x.trim()).filter(Boolean);
  const num = p => /^rear$/i.test(p) ? cars : parseInt(p);
  let [a, b] = [num(parts[0]), parts.length > 1 ? num(parts[1]) : 1];
  if (/^rear$/i.test(parts[1] || "") || (a <= MAX_DP_UNITS && b > MAX_DP_UNITS)) [a, b] = [b, a];
  return { afterCar: Math.min(cars, Math.max(1, a || 1)), units: Math.min(MAX_DP_UNITS, Math.max(1, b || 1)) };
});
const describeRemotes = (remotes, cars) => remotes.length
  ? remotes.map((r, i) => `Remote ${i + 1}: ${r.units} unit${r.units > 1 ? "s" : ""} ${r.afterCar >= cars ? "on the rear" : `after car ${r.afterCar}`}`).join(" · ")
  : "Head-end power only";
const showRemotes = () => { $("dpText").textContent = describeRemotes(parseRemotes($("dp").value, +$("ncars").value), +$("ncars").value); };
$("dp").oninput = $("ncars").oninput = showRemotes;

// DP remotes: mode and radio, and what each remote's brake valve is doing where it stands.
function renderDp(v) {
  $("dpPanel").hidden = !v.remotes.length;
  // Rebuilt only when a mode or the radio changes, so a click isn't lost to a redraw; the gauges update in place.
  const key = JSON.stringify(v.remotes.map(r => [r.number, r.mode, r.commLost, r.cutOutOnCommLoss]));
  if (key !== renderDp.key) {
    renderDp.key = key;
    $("dpPanel").innerHTML = v.remotes.map(r => `<div class="row"><b>DP remote ${r.number}</b> <span class="muted">unit ${r.unitIndex + 1}</span>
      <span class="pos">${["Sync", "Isolate"].map(m => `<button data-dp="${r.number}" data-mode="${m}" class="${r.mode === m ? "on" : ""}">${m.toUpperCase()}</button>`).join("")}</span>
      <span class="muted" id="dpInfo${r.number}"></span>${r.commLost
        ? `<span style="color:var(--warn)">NO COMM${r.cutOutOnCommLoss ? " - remote brake valve cut out" : ""}</span>` : ""}</div>`).join("");
    $("dpPanel").querySelectorAll("button[data-dp]").forEach(b => b.onclick = () => post("dp", { remote: +b.dataset.dp, mode: b.dataset.mode }));
  }
  for (const r of v.remotes) $(`dpInfo${r.number}`).textContent = `BP ${r.brakePipePsi.toFixed(0)} · ER ${r.equalizingPsi.toFixed(0)} · flow ${r.flowScfm.toFixed(0)} cfm`;
}
$("startSim").onclick = async () => { carsFilled = 0; selectedCar = null; await post("start", setupFromForm()); loadFaults(); };
$("stopSim").onclick = () => post("stop");
$("chargeSim").onclick = () => post("charge");
document.querySelectorAll("#speeds button").forEach(b => b.onclick = () => post("speed", { factor: +b.dataset.s }));
$("pause").onclick = () => post("speed", { paused: !view?.paused });
const fault = on => post("fault", { type: $("ftype").value, unit: +$("fcar").value, value: $("fval").value === "" ? null : +$("fval").value, on })
  .then(loadFaults);
$("fon").onclick = () => fault(true);
$("foff").onclick = () => fault(false);

async function loadFaults() {
  const s = await api("api/airbrake");
  $("flog").innerHTML = (s.faults || []).slice().reverse().map(f => `<div>${esc(f)}</div>`).join("") || '<div class="muted">No faults set.</div>';
  $("standNote").textContent = s.stands ? "- SimHogger stand connected" : "- no stand connected (use these controls)";
}

// ---- trainer -----------------------------------------------------------------------------------------------------

async function loadProcedures() {
  procedures = await api("api/airbrake/procedures");
  $("proc").innerHTML = procedures.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("");
  $("proc").onchange = () => { const p = procedures.find(x => x.id === $("proc").value); $("procInfo").textContent = p ? `${p.rule} · ${p.steps} steps` : ""; };
  $("proc").onchange();
}

$("startTrainer").onclick = async () => {
  carsFilled = 0; selectedCar = null;
  trainer = await post("trainer/start", { procedureId: $("proc").value, mode: $("mode").value, studentName: $("student").value,
    studentNumber: $("studentNo").value, randomFaults: $("mode").value === "Learn" ? 0 : +$("rnd").value });
  lastTrainerKey = ""; renderTrainer(); loadFaults();
};

function renderTrainer() {
  const t = trainer;
  $("trainerStart").hidden = !!t && !t.result?.finished;
  $("trainerRun").hidden = !t;
  if (!t) return;
  const s = t.step;
  // Re-render only when something the student sees changes (keeps typed answers in place).
  const key = JSON.stringify([t.stepIndex, t.feedback, t.checks, t.timingStartedAt, Object.keys(t.inspected), t.marks, t.result?.finished, selectedCar]);
  if (key === lastTrainerKey) { if (t.timingStartedAt != null && $("timer")) $("timer").textContent = `${Math.floor(t.timingElapsed)} s`; return; }
  lastTrainerKey = key;
  let html = `<div class="progress">${esc(t.procedureTitle)} · ${esc(t.rule)} · ${esc(t.mode)} · ${esc(t.studentName)} · step ${Math.min(t.stepIndex + 1, t.stepCount)} of ${t.stepCount}</div>`;
  if (t.result && t.result.finished) {
    const r = t.result;
    html += `<div class="row" style="margin-top:8px"><span class="big ${r.failed ? "fail" : "pass"}">${r.score}</span><span class="${r.failed ? "fail" : "pass"}">${r.failed ? "FAIL" : "PASS"}</span></div>
      <table class="result"><tr><th>Step</th><th>Points</th><th>Detail</th></tr>${r.steps.map(x =>
        `<tr><td>${esc(x.title)}</td><td class="${x.passed ? "pass" : "fail"}">${x.earned}/${x.possible}</td><td>${esc(x.detail)}</td></tr>`).join("")}</table>
      ${r.faults.length ? `<div class="muted" style="margin-top:6px">Faults in the train: ${esc(r.faults.join("; "))}</div>` : ""}
      <div class="row"><button id="tEnd">Close</button></div>`;
    $("trainerRun").innerHTML = html;
    $("tEnd").onclick = async () => { await post("trainer/end"); trainer = null; renderTrainer(); };
    return;
  }
  html += `<div class="step"><h3>${esc(s.title)}</h3><div class="instr">${esc(s.instruction)}</div>`;
  if (s.explain) html += `<div class="explain">${esc(s.explain)}</div>`;
  if (t.checks.length) html += `<ul class="checks">${t.checks.map(c => `<li class="${c.met ? "met" : ""}">${esc(c.message.replace(/^(The |Put |Apply |Cut |Keep )/, m => m))}</li>`).join("")}</ul>`;
  html += `<div class="row" style="margin-top:10px">`;
  if (s.kind === "Action") html += `<button class="primary" id="tDone">Done</button>`;
  if (s.kind === "Reading") html += `<label>${esc(s.reading.prompt)} (${esc(s.reading.unit)}) <input type="number" id="tVal" style="width:90px"></label><button class="primary" id="tAns">Enter</button>`;
  if (s.kind === "Timed") html += t.timingStartedAt == null
    ? `<button class="primary" id="tTime">Start timing</button>`
    : `<span>Timing: <b id="timer">${Math.floor(t.timingElapsed)} s</b></span><label>${esc(s.timed.reading.prompt)} (${esc(s.timed.reading.unit)}) <input type="number" step="0.1" id="tVal" style="width:80px"></label><button class="primary" id="tAns">Enter</button>`;
  if (s.kind === "Decision") html += `<button id="dPass">Train passes</button><button id="dRep">Passes after repairs / set-outs</button><button id="dFail" class="danger">Train fails</button>`;
  if (s.kind === "Question") html += s.question.choices.length
    ? s.question.choices.map((c, i) => `<button class="qc" data-c="${i}">${esc(c)}</button>`).join("")
    : `<label>Answer${s.question.unit ? ` (${esc(s.question.unit)})` : ""} <input type="number" step="any" id="tVal" style="width:90px"></label><button class="primary" id="tQNum">Enter</button>`;
  if (s.kind === "Walk") html += `<button class="primary" id="tWalk">Finished walking</button><span class="muted">${Object.keys(t.inspected).length} of ${t.carsToInspect.length} inspected</span>`;
  if (t.mode !== "Test") html += `<button id="tHint">Hint</button>`;
  html += `<button id="tQuit">End session</button></div>`;
  if (s.kind === "Walk") {
    html += `<div class="walk">${t.carsToInspect.map(i => `<button data-u="${i}" class="${t.inspected[i] ? "seen" : ""} ${t.marks[i]?.length ? "marked" : ""}">${i + 1}</button>`).join("")}</div><div class="obs" id="obs"></div>`;
  }
  if (t.feedback) html += `<div class="fb ${t.feedbackGood ? "good" : "bad"}">${esc(t.feedback)}</div>`;
  html += `</div>`;
  $("trainerRun").innerHTML = html;

  const on = (id, f) => { if ($(id)) $(id).onclick = f; };
  const apply = r => { trainer = r; renderTrainer(); };
  on("tDone", () => post("trainer/done").then(apply));
  on("tAns", () => post("trainer/answer", { value: +$("tVal").value }).then(apply));
  on("tTime", () => post("trainer/timing").then(apply));
  on("tQNum", () => post("trainer/question", { number: +$("tVal").value }).then(apply));
  document.querySelectorAll("button.qc").forEach(b => b.onclick = () => post("trainer/question", { choice: +b.dataset.c }).then(apply));
  on("tWalk", () => post("trainer/finish-walk").then(apply));
  on("dPass", () => post("trainer/decide", { choice: "pass" }).then(apply));
  on("dRep", () => post("trainer/decide", { choice: "passAfterRepairs" }).then(apply));
  on("dFail", () => post("trainer/decide", { choice: "fail" }).then(apply));
  on("tHint", () => post("trainer/hint").then(h => alert(h.hint)));
  on("tQuit", async () => { if (confirm("End this session? Practice and Test results are saved as they stand.")) { await post("trainer/end"); trainer = null; renderTrainer(); } });
  document.querySelectorAll(".walk button").forEach(b => b.onclick = () => inspect(+b.dataset.u));
  if (s.kind === "Walk" && selectedCar != null && t.inspected[selectedCar]) showObservation(t.inspected[selectedCar]);
}

async function inspect(unit) {
  const o = await post("trainer/inspect", { unit });
  selectedCar = unit;
  trainer.inspected[unit] = o;
  lastTrainerKey = ""; renderTrainer();
}

function showObservation(o) {
  const marks = trainer.marks[o.unit] || [];
  if (o.loco) { showLocoObservation(o, marks); return; }
  const lines = [o.pistonOut ? `Piston <b>out</b> - travel ${o.pistonTravelIn} in` : "Piston <b>in</b> (brake released)",
    o.leakHeard ? "<span style='color:var(--warn)'>Air leak heard at this car</span>" : "No leak heard",
    o.angleCockBehindClosed ? "<span style='color:var(--bad)'>Rear angle cock CLOSED</span>" : "Angle cocks open",
    `Retainer: ${o.retainer === "Exhaust" ? "exhaust (normal)" : esc(o.retainer)}`];
  $("obs").innerHTML = `<b>Car ${o.unit + 1}: ${esc(o.id)}</b> ${esc(o.kind)}<br>${lines.join("<br>")}
    <div class="marks">${DEFECTS.map(([k, n]) => `<button data-d="${k}" class="${marks.includes(k) ? "on" : ""}">${n}</button>`).join("")}</div>`;
  document.querySelectorAll("#obs .marks button").forEach(b => b.onclick = async () => {
    trainer = await post("trainer/mark", { unit: o.unit, defect: b.dataset.d, on: !marks.includes(b.dataset.d) });
    lastTrainerKey = ""; renderTrainer();
  });
}

// ---- start -------------------------------------------------------------------------------------------------------

(async () => {
  await requireUser();
  await loadProcedures();
  const s = await api("api/airbrake");
  if (s.view) { view = s.view; render(); }
  if (s.trainer) { trainer = s.trainer; renderTrainer(); }
  loadFaults();
  await conn.start();
  window.addEventListener("resize", () => view && render());
})();

// A locomotive on a walk-around: brakes, the cab's MU-2A and brake valve, cut-out cocks, and the MU hoses behind it.
function showLocoObservation(o, marks) {
  const l = o.loco, bad = t => `<span style='color:var(--warn)'>${t}</span>`;
  const lines = [o.pistonOut ? `Brakes <b>applied</b> (${l.brakeCylinderPsi} psi)` : "Brakes <b>released</b>",
    `MU-2A: ${l.mu2a === "Trail" ? "trail" : "lead / dead"}`,
    `Brake valve cut-out: ${{ Out: "OUT", Frt: "FRT", Pass: "PASS" }[l.cutOut] ?? (l.brakeValveCutIn ? "in" : "OUT")}`,
    l.cylindersCutOut ? bad("Brake cylinder cut-out cock CLOSED") : "Brake cylinder cut-out cock open",
    l.deadEngineCockOpen ? "Dead engine cut-out cock open" : "Dead engine cut-out cock closed",
    l.compressorDead ? "Engine shut down (no compressor)" : "Engine running",
    l.hosesPartedBehind.length ? bad("MU hoses behind not coupled: " + esc(l.hosesPartedBehind.join(", "))) : "MU hoses behind coupled",
    o.leakHeard ? bad("Air leak heard on this unit") : "No leak heard"];
  $("obs").innerHTML = `<b>Unit ${o.unit + 1}: ${esc(o.id)}</b> ${esc(o.kind)}<br>${lines.join("<br>")}
    <div class="marks">${DEFECTS.filter(([k]) => ["NotApplied", "NotReleased", "AirLeak", "LocoSetup"].includes(k)).map(([k, n]) => `<button data-d="${k}" class="${marks.includes(k) ? "on" : ""}">${n}</button>`).join("")}</div>`;
  document.querySelectorAll("#obs .marks button").forEach(b => b.onclick = async () => {
    trainer = await post("trainer/mark", { unit: o.unit, defect: b.dataset.d, on: !marks.includes(b.dataset.d) });
    lastTrainerKey = ""; renderTrainer();
  });
}
