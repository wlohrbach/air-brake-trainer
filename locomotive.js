// The locomotive view: each unit's air system drawn as a piping schematic, filled and animated from the running
// simulation (pressures and air flows from the model), with the consist's cocks, valves and MU hoses to work.
"use strict";

let view = null, built = 0, stands = false;
const post = (url, body) => api("api/airbrake/" + url, { method: "POST", body: body || {} }).catch(e => { alert(e.message); throw e; });
const control = body => post("control", body);
// The crew's own settings on a unit (not instructor faults - those stay on the air brake page).
const loco = (unit, setting) => post("loco", { unit, ...setting });

const SYS = { mr: "Main reservoir", bp: "Brake pipe", er: "Equalizing", ind: "Independent #20", act: "Actuating #13", bc: "Brake cylinder", ex: "Exhaust" };
const PRESETS = { "Everything": Object.keys(SYS), "Automatic brake": ["mr", "bp", "er", "bc", "ex"], "Independent brake": ["mr", "ind", "bc", "ex"],
  "Bail off": ["act", "ind", "bc", "ex"], "Dead engine": ["mr", "bp", "bc"] };
const AUTO_ANG = { Release: -130, Minimum: -100, FullService: 62, Suppression: 74, HandleOff: 96, Emergency: 130 };
const L = k => view.locomotives[k];
const OX = k => 20 + k * 640;

// ---- schematic ----------------------------------------------------------------------------------------------

let pipes = [], hoses = [];
function P(sys, pts, net, flow, full) { return { sys, pts, net, flow, full: full || (sys === "mr" || sys === "act" ? 140 : 90) }; }
const pos = x => Math.max(0, x);
function bpFlowThrough(k) { let q = 0; for (let j = 0; j <= k; j++) q += L(j).flows.brakePipe - L(j).flows.deadEngine; return q; }

function unitPipes(k) {
  const l = () => L(k), f = () => L(k).flows, bp = () => L(k).brakePipePsi;
  const lead = () => L(k).mu2a !== "Trail";
  return [
    P("mr", [[104, 70], [130, 70]], () => l().mainReservoirPsi, () => f().compressor),
    P("mr", [[210, 88], [210, 110]], () => l().mainReservoirPsi, null),
    P("mr", [[0, 110], [560, 110]], () => l().mainReservoirPsi, null),
    P("mr", [[40, 110], [40, 185]], () => l().mainReservoirPsi, () => pos(f().brakePipe)),
    P("mr", [[200, 110], [200, 185]], () => l().mainReservoirPsi, () => pos(f().independent) + pos(f().actuating)),
    P("mr", [[505, 110], [505, 300]], () => l().mainReservoirPsi, () => pos(f().relay)),
    P("bp", [[230, 555], [230, 478]], bp, () => f().deadEngine),
    P("bp", [[230, 462], [230, 428]], bp, () => f().deadEngine),
    P("mr", [[230, 412], [230, 110]], () => l().mainReservoirPsi, () => f().deadEngine),
    P("er", [[50, 335], [50, 372]], () => l().equalizingPsi, null),
    // The brake pipe leaves the 26C through the cut-out pilot valve, just below the automatic.
    P("bp", [[110, 335], [110, 352]], bp, () => f().brakePipe),
    P("bp", [[110, 368], [110, 555]], bp, () => f().brakePipe),
    P("ex", [[14, 320], [2, 320]], () => 0, () => pos(-f().brakePipe)),
    P("ex", [[200, 300], [200, 318]], () => 0, () => pos(-f().independent) + pos(-f().actuating)),
    P("ex", [[526, 345], [542, 345]], () => 0, () => pos(-f().relay)),
    P("ind", [[0, 135], [560, 135]], () => l().independentPipePsi, null),
    P("ind", [[222, 215], [270, 215]], () => lead() ? l().independentPipePsi : 0, () => f().independent),
    P("ind", [[315, 200], [315, 135]], () => l().independentPipePsi, () => f().independent),
    P("ind", [[360, 235], [430, 235], [430, 270], [461, 270]], () => l().independentPipePsi, null),
    P("act", [[0, 158], [560, 158]], () => l().actuatingPipePsi, null),
    P("act", [[160, 185], [160, 158]], () => l().actuatingPipePsi, () => f().actuating),
    P("act", [[390, 158], [390, 420], [370, 420]], () => l().actuatingPipePsi, null),
    P("bc", [[370, 380], [552, 380], [552, 270], [479, 270]], () => l().automaticPsi, null),
    P("bc", [[470, 279], [470, 300]], () => Math.max(l().automaticPsi, l().independentPipePsi), null),
    P("bc", [[470, 360], [470, 462]], () => l().brakeCylinderPsi, () => f().relay),
    P("bc", [[470, 478], [470, 490]], () => l().brakeCylinderPsi, () => f().relay),
    P("bc", [[430, 490], [510, 490]], () => l().brakeCylinderPsi, null),
    P("bc", [[430, 490], [430, 500]], () => l().brakeCylinderPsi, () => f().relay),
    P("bc", [[510, 490], [510, 500]], () => l().brakeCylinderPsi, () => f().relay),
    P("bp", [[315, 555], [315, 440]], bp, null),
    P("bp", [[0, 555], [560, 555]], bp, () => bpFlowThrough(k)),
  ].map(p => ({ ...p, pts: p.pts.map(([x, y]) => [x + OX(k), y]) }));
}
const pathD = pts => "M" + pts.map(p => p.join(" ")).join(" L");
function pipeSvg(p) {
  const d = pathD(p.pts);
  return `<g><title>${SYS[p.sys]}</title><path class="tube" d="${d}" stroke="var(--${p.sys})"/><path class="core" d="${d}"/>` +
    (p.sys === "ex" ? "" : `<path class="fill" d="${d}" stroke="var(--${p.sys})"/>`) + (p.flow ? `<path class="dash" d="${d}"/>` : "") + "</g>";
}
const HOSE_KINDS = [
  { key: "hoseMainReservoir", fault: 3, y: 110, sys: "mr", name: "Main reservoir equalizing hose (#3)", psi: "mainReservoirPsi" },
  { key: "hoseIndependent", fault: 20, y: 135, sys: "ind", name: "Independent application and release hose (#20)", psi: "independentPipePsi" },
  { key: "hoseActuating", fault: 13, y: 158, sys: "act", name: "Actuating hose (#13)", psi: "actuatingPipePsi" },
];
function hoseD(x0, y, coupled) {
  const x1 = x0 + 80, m = x0 + 40;
  return coupled ? [`M${x0} ${y} C${x0 + 22} ${y + 34} ${x1 - 22} ${y + 34} ${x1} ${y}`]
    : [`M${x0} ${y} C${x0 + 12} ${y + 4} ${x0 + 16} ${y + 14} ${x0 + 14} ${y + 26}`, `M${x1} ${y} C${x1 - 12} ${y + 4} ${x1 - 16} ${y + 14} ${x1 - 14} ${y + 26}`];
}
function cockSvg(id, x, y, label, side) {
  const head = `<g class="click" id="${id}" tabindex="0" role="button" aria-label="${label}"><title>${label}: click to turn</title>
    <rect x="${x - 16}" y="${y - 16}" width="32" height="32" fill="transparent"/><circle class="ring" cx="${x}" cy="${y}" r="7.5"/>
    <line class="cockh hdl" x1="${x - 12}" y1="${y}" x2="${x + 12}" y2="${y}" style="transform-origin:${x}px ${y}px"/>`;
  const short = label.replace(/ \(unit \d\)/, "");
  if (side === "rs") return head + ["Brake valve cut-out", "pilot valve", "OUT / FRT / PASS"].map((t, i) => `<text class="ts" x="${x + 14}" y="${y - 6 + i * 12}">${t}</text>`).join("") + `</g>`;
  if (side === "b") { const [a, b] = short.split(" cut-out "); return head + `<text class="ts" x="${x + 12}" y="${y + 24}">${a}</text><text class="ts" x="${x + 12}" y="${y + 36}">cut-out ${b}</text></g>`; }
  return head + `<text class="ts" x="${side === "l" ? x - 18 : x + 18}" y="${y + 4}" text-anchor="${side === "l" ? "end" : "start"}">${short}</text></g>`;
}
function dial(id, cx, cy, r, marks) {
  let s = `<circle class="ring" cx="${cx}" cy="${cy}" r="${r}"/>`;
  for (const [a, t] of marks) {
    const rad = (a - 90) * Math.PI / 180, c = Math.cos(rad), n = Math.sin(rad);
    s += `<line x1="${cx + c * (r - 5)}" y1="${cy + n * (r - 5)}" x2="${cx + c * r}" y2="${cy + n * r}" stroke="#7a858e" stroke-width="1.2"/><text class="ts" style="font-size:8px" x="${cx + c * (r + 9)}" y="${cy + n * (r + 9) + 3}" text-anchor="middle">${t}</text>`;
  }
  return s + `<g class="hdl" id="${id}" style="transform-origin:${cx}px ${cy}px"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 4}" stroke="var(--text)" stroke-width="4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy - r + 6}" r="4.5" fill="var(--text)"/></g><circle cx="${cx}" cy="${cy}" r="5" fill="#7a858e"/>`;
}
function unitSvg(k) {
  const o = OX(k), l = L(k), g = [`<g transform="translate(${o} 0)">`];
  g.push(`<rect class="frame" x="0" y="36" width="560" height="548" rx="8"/><text class="tt" x="2" y="24">Unit ${k + 1} · ${k === 0 ? "lead" : "trailing"} <tspan class="ts" style="text-transform:none">${esc(l.id)}</tspan></text>`);
  g.push(`<rect class="box" x="10" y="50" width="94" height="40" rx="4"/><text class="t" x="18" y="66">Compressor</text><text class="ts" x="18" y="82" id="comp${k}">on</text>`);
  g.push(`<rect class="box" x="130" y="52" width="160" height="36" rx="18"/><text class="t" x="146" y="67">Main reservoirs</text><text class="tv" x="146" y="81" id="mrT${k}"></text>`);
  // The 26L's two valves: the 26C automatic (equalizing reservoir, brake pipe) and the SA-26 independent (#20, bail-off on #13).
  g.push(`<rect class="box" x="14" y="185" width="106" height="150" rx="6"/><text class="t" x="24" y="203">26C</text><text class="ts" x="24" y="217">automatic</text>`);
  g.push(dial(`auto${k}`, 67, 272, 28, [[-130, "REL"], [-100, "MIN"], [62, "FS"], [96, "HO"], [130, "EM"]]));
  g.push(`<rect class="box" x="128" y="185" width="94" height="115" rx="6"/><text class="t" x="138" y="203">SA-26</text><text class="ts" x="138" y="217">independent</text>`);
  g.push(dial(`indh${k}`, 175, 258, 24, [[-130, "REL"], [130, "FULL"]]));
  g.push(`<text class="ts" x="4" y="314">EX</text><text class="ts" x="200" y="330" text-anchor="middle">EX</text>`);
  g.push(`<rect class="box" x="8" y="372" width="92" height="56" rx="8"/><text class="t" x="16" y="389">Equalizing</text><text class="ts" x="16" y="403">reservoir</text><text class="tv" x="16" y="419" id="erT${k}"></text>`);
  g.push(`<g class="click" id="mu${k}" tabindex="0" role="button" aria-label="MU-2A valve, unit ${k + 1}"><title>MU-2A valve: click to turn</title><rect class="box" x="270" y="198" width="90" height="56" rx="5"/><text class="t" x="280" y="215">MU-2A</text><text class="tv" x="280" y="232" id="muT${k}"></text><text class="ts" x="280" y="247">click to turn</text></g>`);
  g.push(`<rect class="box" x="260" y="360" width="110" height="80" rx="5"/><text class="t" x="268" y="378">26-F control</text><text class="t" x="268" y="392">valve</text><text class="tv" x="268" y="410" id="cvT${k}"></text><text class="ts" x="268" y="428" id="cvS${k}"></text>`);
  g.push(`<circle class="ring" cx="470" cy="270" r="9"/><text class="ts" x="467" y="256" text-anchor="middle" style="font-size:10px">double check</text>`);
  g.push(`<rect class="box" x="414" y="300" width="112" height="60" rx="5"/><text class="t" x="424" y="323" id="rvN${k}">J-1 relay valve</text><text class="tv" x="424" y="346" id="ctlT${k}"></text><text class="ts" x="530" y="337">EX</text>`);
  g.push(`<line id="rodL${k}" x1="400" y1="513" x2="394" y2="513" stroke="var(--text)" stroke-width="3.5" stroke-linecap="round"/><rect class="box" x="400" y="500" width="60" height="26" rx="4"/>`);
  g.push(`<line id="rodR${k}" x1="540" y1="513" x2="546" y2="513" stroke="var(--text)" stroke-width="3.5" stroke-linecap="round"/><rect class="box" x="480" y="500" width="60" height="26" rx="4"/>`);
  g.push(`<text class="t" x="410" y="542">Brake cylinders</text><text class="tv" x="512" y="542" id="bcT${k}"></text>`);
  g.push(`<path d="M222 428 L238 428 L230 414 Z" fill="var(--comp)" stroke="#7a858e" stroke-width="1.2"/><text class="ts" x="219" y="414" text-anchor="end">choke +</text><text class="ts" x="219" y="426" text-anchor="end">check</text>`);
  if (k === 0) g.push(`<text class="ts" x="324" y="102">Main res. equalizing #3</text><text class="ts" x="324" y="128">Independent app. &amp; release #20</text><text class="ts" x="400" y="151">Actuating #13</text><text class="ts" x="8" y="546">Brake pipe</text>`);
  g.push(`<text class="tv" x="548" y="128" text-anchor="end" id="t20${k}"></text><text class="tv" x="548" y="151" text-anchor="end" id="t13${k}"></text><text class="tv" x="556" y="572" text-anchor="end" id="tbp${k}"></text>`);
  g.push(`</g>`);
  g.push(cockSvg(`ckbv${k}`, o + 110, 360, `Brake valve cut-out pilot valve, OUT / FRT / PASS (unit ${k + 1})`, "rs"));
  g.push(cockSvg(`ckde${k}`, o + 230, 470, `Dead engine cut-out cock (unit ${k + 1})`, "b"));
  g.push(cockSvg(`ckbc${k}`, o + 470, 470, `BC cut-out cock (unit ${k + 1})`, "r"));
  return g.join("");
}

function build() {
  const n = view.locomotives.length, svg = $("schem");
  built = n;
  const width = (n - 1) * 640 + 600;
  svg.setAttribute("viewBox", `0 0 ${width} 600`);
  svg.style.minWidth = n > 3 ? n * 420 + "px" : "0";
  pipes = [];
  for (let k = 0; k < n; k++) pipes.push(...unitPipes(k));
  const end = OX(n - 1) + 560;
  pipes.push(P("bp", [[end, 555], [end + 18, 555]], () => L(n - 1).brakePipePsi, () => bpFlowThrough(n - 1)));
  hoses = [];
  for (let k = 0; k < n - 1; k++) {
    const x0 = OX(k) + 560;
    pipes.push(P("bp", [[x0, 555], [x0 + 80, 555]], () => L(k).brakePipePsi, () => bpFlowThrough(k)));
    for (const h of HOSE_KINDS) hoses.push({ k, h, x0 });
  }
  const order = Object.keys(SYS);
  pipes.sort((a, b) => order.indexOf(a.sys) - order.indexOf(b.sys));
  let html = "";
  for (const sys of order) html += `<g class="lay${layerOff.has(sys) ? " off" : ""}" data-sys="${sys}">` + pipes.filter(p => p.sys === sys).map(pipeSvg).join("") +
    hoses.filter(h => h.h.sys === sys).map(h => `<g id="hose-${h.k}-${h.h.fault}"></g>`).join("") + "</g>";
  for (let k = 0; k < n; k++) html += unitSvg(k);
  html += `<text class="ts" x="${width - 2}" y="594" text-anchor="end">to the train →</text>`;
  svg.innerHTML = html;
  const groups = svg.querySelectorAll(".lay > g:not([id])");
  pipes.forEach((p, i) => { p.fillEl = groups[i].querySelector(".fill"); p.dashEl = groups[i].querySelector(".dash"); p.off = 0; });
  for (let k = 0; k < n; k++) {
    bind(`mu${k}`, () => setMu2a(k, L(k).mu2a === "Trail" ? "LeadOrDead" : "Trail"));
    bind(`ckbv${k}`, () => nextCutOut(k));
    bind(`ckde${k}`, () => loco(k, { deadEngineCockOpen: !L(k).deadEngineCutOutOpen }));
    bind(`ckbc${k}`, () => loco(k, { cylindersCutOut: !L(k).brakeCylindersCutOut }));
  }
  hoseState = "";
  buildGauges();
  buildConfig();
}
let hoseState = "";
function drawHoses() {
  const key = hoses.map(h => L(h.k)[h.h.key]).join();
  if (key === hoseState) return;
  hoseState = key;
  for (const hz of hoses) {
    const on = L(hz.k)[hz.h.key], g = $(`hose-${hz.k}-${hz.h.fault}`), y = hz.h.y;
    g.innerHTML = `<g class="click" id="hb-${hz.k}-${hz.h.fault}" tabindex="0" role="button"><title>${hz.h.name}: click to ${on ? "part" : "couple"}</title>
      <rect x="${hz.x0 + 2}" y="${y - 6}" width="76" height="36" fill="transparent"/>` +
      hoseD(hz.x0, y, on).map(d => `<path class="tube" d="${d}" stroke="var(--${hz.h.sys})"/><path class="core" d="${d}"/><path class="fill" d="${d}" stroke="var(--${hz.h.sys})"/>${on ? `<path class="dash" d="${d}"/>` : ""}`).join("") +
      (on ? `<circle cx="${hz.x0 + 40}" cy="${y + 25}" r="3.5" fill="#7a858e"/>` : `<circle cx="${hz.x0 + 14}" cy="${y + 27}" r="3.5" fill="#7a858e"/><circle cx="${hz.x0 + 66}" cy="${y + 27}" r="3.5" fill="#7a858e"/>`) + "</g>";
    hz.fills = g.querySelectorAll(".fill"); hz.dash = g.querySelector(".dash"); hz.off = 0;
    bind(`hb-${hz.k}-${hz.h.fault}`, () => loco(hz.k, { hose: hz.h.fault, hoseCoupled: !L(hz.k)[hz.h.key] }));
  }
}
function bind(id, fn) {
  const el = $(id); if (!el) return;
  el.onclick = fn;
  el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };
}

// ---- car brake system -------------------------------------------------------------------------------------------
// One freight car of the running train: brake pipe and angle cocks, branch pipe with cut-out cock and dirt collector,
// the control valve (service and emergency portions on the pipe bracket), the combined reservoir and the brake
// cylinder, with the retaining valve on the exhaust. Flows are read from the valve's state and the pressures around it.

const CAR_SYS = { bp: "Brake pipe", aux: "Auxiliary reservoir", em: "Emergency reservoir", bc: "Brake cylinder", ex: "Exhaust" };
const RETAINER = { Exhaust: "EX - exhaust", HighPressure: "HP - holds 20 psi", LowPressure: "LP - holds 10 psi", SlowDirect: "SD - slow direct" };
let carUnit = -1, carCount = -1, carPipes = [];
const CU = () => view.units[carUnit];
const unitBefore = () => view.units[carUnit - 1];
const unitAfter = () => view.units[carUnit + 1];
function carPipe(sys, pts, net, flow, full = 90) { return { sys, pts, net, flow, full, off: 0 }; }
function buildCar() {
  const cars = view.units.filter(u => !u.loco);
  carCount = view.units.length;
  if (!view.units[carUnit] || view.units[carUnit].loco) carUnit = cars.length ? cars[0].index : -1;
  $("carPick").innerHTML = cars.map((u, i) => `<option value="${u.index}"${u.index === carUnit ? " selected" : ""}>${i + 1} · ${esc(u.id)} · ${esc(u.kind)}</option>`).join("");
  if (carUnit < 0) return;
  // Air moves where the valve lets it: from the higher pressure to the lower, as fast as the difference allows.
  const d = (a, b) => Math.max(-20, Math.min(20, (a - b) * 3));
  const st = () => CU().valve, rel = () => st() === "Release", app = () => st() === "Service" || st() === "Emergency";
  carPipes = [
    // Beyond each angle cock the hose belongs to the next car's brake pipe, so it shows that car's pressure.
    carPipe("bp", [[20, 290], [48, 290]], () => (unitBefore() ?? CU()).brakePipePsi, null),
    carPipe("bp", [[72, 290], [888, 290]], () => CU().brakePipePsi, null),
    carPipe("bp", [[912, 290], [940, 290]], () => (unitAfter() ?? CU()).brakePipePsi, null),
    carPipe("bp", [[330, 290], [330, 268]], () => CU().brakePipePsi, () => rel() ? Math.max(0, d(CU().brakePipePsi, CU().auxPsi)) : 0),
    carPipe("bp", [[330, 252], [330, 240]], () => CU().cutOut ? 0 : CU().brakePipePsi, () => rel() ? Math.max(0, d(CU().brakePipePsi, CU().auxPsi)) : 0),
    carPipe("bp", [[330, 215], [330, 180]], () => CU().cutOut ? 0 : CU().brakePipePsi, () => rel() ? Math.max(0, d(CU().brakePipePsi, CU().auxPsi)) : 0),
    carPipe("aux", [[470, 115], [560, 115]], () => CU().auxPsi, () => rel() ? Math.max(0, d(CU().brakePipePsi, CU().auxPsi)) : app() ? -Math.max(0, d(CU().auxPsi, CU().cylinderPsi)) : 0),
    carPipe("em", [[470, 158], [530, 158], [530, 205], [810, 205], [810, 180]], () => CU().emergencyPsi,
      () => rel() ? Math.max(0, d(CU().brakePipePsi, CU().emergencyPsi)) : st() === "Emergency" ? -Math.max(0, d(CU().emergencyPsi, CU().cylinderPsi)) : 0),
    carPipe("bc", [[270, 125], [200, 125]], () => CU().cylinderPsi, () => app() ? Math.max(0, d(CU().auxPsi, CU().cylinderPsi)) : rel() ? -Math.min(20, CU().cylinderPsi) : 0),
    carPipe("ex", [[300, 70], [300, 40], [240, 40]], () => 0, () => rel() ? Math.max(0, Math.min(20, CU().cylinderPsi - ({ HighPressure: 20, LowPressure: 10 }[CU().retainer] ?? 0))) : 0),
    carPipe("ex", [[420, 70], [420, 40], [470, 40]], () => 0, () => st() === "Emergency" ? Math.min(20, CU().brakePipePsi) : 0),
  ];
  const g = [];
  g.push(`<text class="tt" x="20" y="24">Car <tspan class="ts" style="text-transform:none" id="carName"></tspan></text>`);
  for (const p of carPipes) {
    const dd = pathD(p.pts);
    g.push(`<g><title>${CAR_SYS[p.sys]}</title><path class="tube" d="${dd}" stroke="var(--${p.sys})"/><path class="core" d="${dd}"/>` +
      (p.sys === "ex" ? "" : `<path class="fill" d="${dd}" stroke="var(--${p.sys})"/>`) + (p.flow ? `<path class="dash" d="${dd}"/>` : "") + "</g>");
  }
  // angle cocks, hoses, branch pipe fittings
  g.push(carCock("cacF", 60, 290, "Angle cock, A end", true), carCock("cacR", 900, 290, "Angle cock, B end", true), carCock("ccut", 330, 260, "Branch pipe cut-out cock"));
  g.push(`<text class="ts" x="60" y="316" text-anchor="middle">A end angle cock</text><text class="ts" x="900" y="316" text-anchor="middle">B end angle cock</text>`);
  g.push(`<text class="ts" x="20" y="270" id="cAhead"></text><text class="ts" x="940" y="270" text-anchor="end" id="cBehind"></text>`);
  g.push(`<text class="ts" x="342" y="264">cut-out cock</text><text class="tv" x="600" y="282" id="cBp"></text><text class="ts" x="540" y="282" text-anchor="end">Brake pipe</text>`);
  g.push(`<rect class="box" x="306" y="215" width="48" height="25" rx="4"/><text class="ts" x="362" y="226">combined dirt</text><text class="ts" x="362" y="238">collector</text>`);
  // control valve on its pipe bracket
  g.push(`<rect class="box" x="270" y="70" width="200" height="110" rx="6"/><text class="t" x="280" y="88">Control valve (ABDX type)</text>`);
  g.push(`<rect class="box" x="280" y="96" width="80" height="44" rx="4"/><text class="ts" x="288" y="113">service</text><text class="ts" x="288" y="126">portion</text>`);
  g.push(`<rect class="box" x="380" y="96" width="80" height="44" rx="4"/><text class="ts" x="388" y="113">emergency</text><text class="ts" x="388" y="126">portion</text>`);
  g.push(`<text class="ts" x="370" y="160" text-anchor="middle">pipe bracket</text><text class="tv" x="370" y="174" text-anchor="middle" id="cState"></text>`);
  // retaining valve and emergency vent
  g.push(`<g class="click" id="cRetBtn" tabindex="0" role="button" aria-label="Retaining valve handle"><title>Retaining valve: click to turn the handle (EX, HP, LP, SD)</title>` +
    `<rect class="box" x="150" y="26" width="90" height="28" rx="4"/><text class="ts" x="158" y="44">retaining valve</text><text class="tv" x="150" y="68" id="cRet"></text></g><text class="ts" x="136" y="44" text-anchor="end">EX</text>`);
  g.push(`<text class="ts" x="478" y="36">vent valve</text><text class="ts" x="478" y="48">(emergency) EX</text>`);
  // combined reservoir
  g.push(`<rect class="box" x="560" y="80" width="340" height="100" rx="46"/><line x1="730" y1="82" x2="730" y2="178" stroke="#7a858e" stroke-width="1.3"/>`);
  g.push(`<text class="t" x="590" y="112">Auxiliary</text><text class="ts" x="590" y="127">2,500 in³</text><text class="tv" x="590" y="150" id="cAux"></text>`);
  g.push(`<text class="t" x="750" y="112">Emergency</text><text class="ts" x="750" y="127">3,500 in³</text><text class="tv" x="750" y="150" id="cEm"></text>`);
  g.push(`<text class="ts" x="730" y="72" text-anchor="middle">combined reservoir</text>`);
  // brake cylinder, piston and push rod
  g.push(`<line id="cRod" x1="80" y1="125" x2="60" y2="125" stroke="var(--text)" stroke-width="3.5" stroke-linecap="round"/>`);
  g.push(`<rect class="box" x="80" y="100" width="120" height="50" rx="5"/><text class="t" x="88" y="92">Brake cylinder</text><text class="tv" x="90" y="130" id="cBc"></text>`);
  g.push(`<text class="ts" x="80" y="168" id="cTravel"></text><text class="ts" x="80" y="182" id="cBrake"></text>`);
  $("carSchem").innerHTML = g.join("");
  bind("cRetBtn", nextRetainer);
  const groups = $("carSchem").querySelectorAll(":scope > g:not([id])");
  carPipes.forEach((p, i) => { p.fillEl = groups[i].querySelector(".fill"); p.dashEl = groups[i].querySelector(".dash"); });
}
// The handle lies along the pipe when the cock is open and across it when closed; cock() turns it 90° to open, so a cock
// on a horizontal pipe starts from a vertical handle.
function carCock(id, x, y, label, horizontalPipe = false) {
  const [dx, dy] = horizontalPipe ? [0, 12] : [12, 0];
  return `<g id="${id}"><title>${label}</title><circle class="ring" cx="${x}" cy="${y}" r="7.5"/>` +
    `<line class="cockh hdl" x1="${x - dx}" y1="${y - dy}" x2="${x + dx}" y2="${y + dy}" style="transform-origin:${x}px ${y}px"/></g>`;
}
function renderCar() {
  if (carCount !== view.units.length) buildCar();
  if (carUnit < 0) return;
  const u = CU(), r = Math.round, ahead = unitBefore();
  $("carName").textContent = `${u.id} · ${u.kind} · ${u.loaded ? "loaded" : "empty"}`;
  $("cBp").textContent = `${r(u.brakePipePsi)} psi`;
  $("cAux").textContent = `${r(u.auxPsi)} psi`; $("cEm").textContent = `${r(u.emergencyPsi)} psi`; $("cBc").textContent = `${r(u.cylinderPsi)} psi`;
  $("cState").textContent = { Release: "release - charging", Service: "service", Lap: "lap", Emergency: "EMERGENCY", "Cut out": "cut out" }[u.valve] ?? u.valve;
  $("cRet").textContent = RETAINER[u.retainer] ?? u.retainer;
  $("cTravel").textContent = u.pistonOut ? `piston out, travel ${u.pistonTravelIn.toFixed(1)} in` : "piston in (released)";
  $("cBrake").textContent = u.sticking ? "sticking brake" : u.cylinderLeakScfm > 0 ? "cylinder leaking" : "";
  $("cRod").setAttribute("x2", 74 - (u.pistonOut ? Math.min(14, u.pistonTravelIn) * 3.2 : 4));
  cock("ccut", !u.cutOut);
  const behind = unitAfter();
  $("cAhead").textContent = ahead ? `← ${ahead.loco ? "locomotive" : "car ahead"} ${r(ahead.brakePipePsi)} psi` : "← front of train";
  $("cBehind").textContent = behind ? `car behind ${r(behind.brakePipePsi)} psi →` : "end of train (EOT) →";
  cock("cacF", !(ahead && ahead.angleCockBehindClosed));
  cock("cacR", !u.angleCockBehindClosed);
}
function animateCar(dt, run) {
  if (carUnit < 0 || !CU()) return;
  for (const p of carPipes) {
    if (p.fillEl) p.fillEl.style.opacity = Math.max(0, Math.min(1, p.net() / p.full));
    if (p.flow) flowDash(p.dashEl, p.flow(), dt, p, run);
  }
}
$("carPick").onchange = () => { carUnit = +$("carPick").value; carCount = -1; renderCar(); };
// The retaining valve handle turns EX -> HP -> LP -> SD -> EX, as a carman sets it.
const RETAINER_NEXT = { Exhaust: ["HighPressure", 1], HighPressure: ["LowPressure", 2], LowPressure: ["SlowDirect", 3], SlowDirect: ["Exhaust", 0] };
function nextRetainer() {
  const [, value] = RETAINER_NEXT[CU().retainer] ?? RETAINER_NEXT.SlowDirect;
  post("fault", value ? { type: "retainer", unit: carUnit, value, on: true } : { type: "retainer", unit: carUnit, on: false });
}

// ---- views ----------------------------------------------------------------------------------------------------

const HINTS = {
  viewLoco: "Pipes fill as they charge; dashes show which way the air moves. Click a cock, an MU-2A valve or an MU hose to work it.",
  viewCar: "Click the retaining valve to turn its handle. Other car faults are set on the Brake Pipe Propagation Simulator.",
  viewConsist: "Each unit's crew settings. Adding or taking off a unit starts the same train again.",
};
function showView(id) {
  for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === id);
  for (const v of Object.keys(HINTS)) $(v).hidden = v !== id;
  $("hint").textContent = HINTS[id];
}
for (const b of $("tabs").querySelectorAll("button")) b.onclick = () => showView(b.dataset.v);
showView("viewLoco");

// ---- consist controls ---------------------------------------------------------------------------------------

const normalMu = k => k === 0 ? "LeadOrDead" : "Trail";
// A trailing unit set up to be hauled dead: no compressor and the dead engine cock open. Its MU-2A in lead/dead and its MU
// hoses parted are then correct, not faults.
const hauledDead = k => k > 0 && L(k).compressorDead && L(k).deadEngineCutOutOpen;
const setMu2a = (k, pos) => loco(k, { mu2a: pos });
// The cut-out pilot valve steps OUT, FRT, PASS and back to OUT.
const CUT_OUT = { Out: "OUT", Frt: "FRT", Pass: "PASS" };
const nextCutOut = k => loco(k, { cutOut: { Out: "Frt", Frt: "Pass", Pass: "Out" }[L(k).cutOut] ?? "Frt" });
const CFG = [
  ["MU-2A", l => l.mu2a === "Trail" ? "Trail" : "Lead / dead", (l, k) => l.mu2a !== normalMu(k) && !hauledDead(k), k => setMu2a(k, L(k).mu2a === "Trail" ? "LeadOrDead" : "Trail")],
  ["Brake valve cut-out", l => CUT_OUT[l.cutOut] ?? "--", (l, k) => k === 0 ? l.cutOut !== "Frt" : l.brakeValveCutIn, k => nextCutOut(k)],
  ["Compressor", l => l.compressorDead ? "Dead" : "Running", (l, k) => l.compressorDead && !hauledDead(k), k => loco(k, { compressorDead: !L(k).compressorDead })],
  ["Dead engine cock", l => l.deadEngineCutOutOpen ? "Open" : "Closed", (l, k) => l.deadEngineCutOutOpen && !hauledDead(k), k => loco(k, { deadEngineCockOpen: !L(k).deadEngineCutOutOpen })],
  ["BC cut-out cock", l => l.brakeCylindersCutOut ? "Closed" : "Open", l => l.brakeCylindersCutOut, k => loco(k, { cylindersCutOut: !L(k).brakeCylindersCutOut })],
  // Equipment, not a crew setting: either is correct, so it's never flagged.
  ["Relay valve", l => l.relayValve === "J1_6_16" ? "J-1.6-16 (1.6 : 1)" : "J-1 (1 : 1)", () => false, k => loco(k, { relayValve: L(k).relayValve === "J1_6_16" ? "J1" : "J1_6_16" })],
];
// Adding or taking off a unit starts the same train again (same cars and seed, charged) with the new consist.
const MAX_UNITS = 6;
function setUnits(m) {
  if (!confirm(`Start the train again with ${m} locomotive${m > 1 ? "s" : ""}? Same cars, charged; the consist settings go back to standard.`)) return;
  const s = view.setup;
  post("start", { ...s, locomotives: m, shutDownUnits: Math.min(s.shutDownUnits || 0, m - 1), startCharged: true });
}
function buildConfig() {
  const n = view.locomotives.length;
  $("unitCount").innerHTML = `<span class="muted">${n} locomotive${n > 1 ? "s" : ""}</span>` +
    `<button id="addUnit"${n >= MAX_UNITS ? " disabled" : ""}>Add a unit</button><button id="removeUnit"${n <= 1 ? " disabled" : ""}>Take off the last unit</button>`;
  $("addUnit").onclick = () => setUnits(n + 1);
  $("removeUnit").onclick = () => setUnits(n - 1);
  $("cfgHead").innerHTML = `<tr><th></th>${view.locomotives.map((l, k) => `<th>Unit ${k + 1}</th>`).join("")}</tr>`;
  $("cfgBody").innerHTML = CFG.map((c, r) => `<tr><td>${c[0]}</td>${view.locomotives.map((l, k) => `<td><button id="cfg${r}-${k}"></button></td>`).join("")}</tr>`).join("") +
    (n > 1 ? HOSE_KINDS.map(h => `<tr><td>${h.name.replace(/ hose/, "").replace("Independent application and release", "Independent").replace("Main reservoir equalizing", "MR equalizing")}</td>${view.locomotives.map((l, k) => k < n - 1 ? `<td><button id="cfgh${h.fault}-${k}"></button></td>` : `<td class="muted">behind unit ${k}</td>`).join("")}</tr>`).join("") : "");
  CFG.forEach((c, r) => view.locomotives.forEach((l, k) => $(`cfg${r}-${k}`).onclick = () => c[3](k)));
  if (n > 1) for (const h of HOSE_KINDS) for (let k = 0; k < n - 1; k++) $(`cfgh${h.fault}-${k}`).onclick = () => loco(k, { hose: h.fault, hoseCoupled: !L(k)[h.key] });
  const last = n - 1;
  $("quick").innerHTML = n > 1 ? `<button id="qTrail">Unit ${last + 1} as a trailing unit</button><button id="qDead">Unit ${last + 1} hauled dead</button>` : "";
  if (n > 1) {
    $("qTrail").onclick = async () => {
      await loco(last, { mu2a: "Trail", brakeValveCutIn: false, compressorDead: false, deadEngineCockOpen: false, cylindersCutOut: false });
      for (const h of HOSE_KINDS) await loco(last - 1, { hose: h.fault, hoseCoupled: true });
    };
    $("qDead").onclick = async () => {
      // Hauled dead: MU-2A in lead/dead, brake valve cut out, no compressor, dead engine cock open, MU hoses parted.
      await loco(last, { mu2a: "LeadOrDead", brakeValveCutIn: false, compressorDead: true, deadEngineCockOpen: true });
      for (const h of HOSE_KINDS) await loco(last - 1, { hose: h.fault, hoseCoupled: false });
    };
  }
}
function refreshConfig() {
  CFG.forEach((c, r) => view.locomotives.forEach((l, k) => { const b = $(`cfg${r}-${k}`); if (!b) return; b.textContent = c[1](l, k); b.classList.toggle("bad", !!c[2](l, k)); }));
  const n = view.locomotives.length;
  for (const h of HOSE_KINDS) for (let k = 0; k < n - 1; k++) { const b = $(`cfgh${h.fault}-${k}`); if (!b) continue; const on = L(k)[h.key]; b.textContent = on ? "Coupled" : "Parted"; b.classList.toggle("bad", !on && !hauledDead(k + 1)); }
}

// ---- gauges -------------------------------------------------------------------------------------------------

function gaugeSvg(id, a, b) {
  let s = `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#101010" stroke="#7a858e" stroke-width="1.5"/>`;
  for (let v = 0; v <= 160; v += 10) {
    const r = (-135 + v / 160 * 270 - 90) * Math.PI / 180, r1 = v % 20 ? 47 : 44;
    s += `<line x1="${60 + Math.cos(r) * r1}" y1="${60 + Math.sin(r) * r1}" x2="${60 + Math.cos(r) * 51}" y2="${60 + Math.sin(r) * 51}" stroke="#9aa4ad" stroke-width="${v % 20 ? 1 : 1.6}"/>`;
    if (v % 40 === 0) s += `<text x="${60 + Math.cos(r) * 35}" y="${60 + Math.sin(r) * 35 + 3.5}" text-anchor="middle" style="font:9.5px Consolas, monospace;fill:#9aa4ad">${v}</text>`;
  }
  s += `<line id="${id}b" x1="60" y1="66" x2="60" y2="16" stroke="#eee" stroke-width="2.4" stroke-linecap="round" style="transform-origin:60px 60px"/>`;
  s += `<line id="${id}a" x1="60" y1="66" x2="60" y2="16" stroke="var(--mr)" stroke-width="2" stroke-linecap="round" style="transform-origin:60px 60px"/>`;
  return s + `<circle cx="60" cy="60" r="4.5" fill="#7a858e"/></svg>`;
}
let gauges = [];
function buildGauges() {
  gauges = [];
  view.locomotives.forEach((l, k) => {
    if (k === 0) {
      gauges.push({ id: "g0x", k, a: ["mainReservoirPsi", "Main res"], b: ["equalizingPsi", "Equalizing"] });
      gauges.push({ id: "g0y", k, a: ["brakeCylinderPsi", "Brake cyl"], b: ["brakePipePsi", "Brake pipe"] });
    } else gauges.push({ id: `g${k}`, k, a: ["mainReservoirPsi", "Main res"], b: ["brakeCylinderPsi", "Brake cyl"] });
  });
  $("gauges").innerHTML = gauges.map(g => `<div class="gauge">${gaugeSvg(g.id)}<div class="cap">Unit ${g.k + 1}<br><span style="color:var(--mr)">●</span> ${g.a[1]} <b id="${g.id}av"></b><br>${g.b[1]} <b id="${g.id}bv"></b></div></div>`).join("");
}

// ---- narration ----------------------------------------------------------------------------------------------

function narrate() {
  const w = [], n = [], ls = view.locomotives, r = Math.round, lead = ls[0];
  ls.forEach((l, k) => {
    const name = `Unit ${k + 1}`;
    if (k === 0) {
      if (l.mu2a === "Trail") w.push(`${name}'s MU-2A is in TRAIL: the lead brake valve's independent and bail-off can't reach any relay valve.`);
      if (!l.brakeValveCutIn) w.push(`The lead brake valve is cut out: nothing is maintaining the brake pipe.`);
      else if (l.cutOut === "Pass") w.push(`The lead brake valve is in PASS: easing the handle back toward release raises the brake pipe (graduated release). Freight runs in FRT.`);
    } else {
      if (l.brakeValveCutIn) w.push(`${name}'s brake valve is cut in, so it works the brake pipe against the lead unit.`);
      if (l.mu2a !== "Trail" && !l.compressorDead) w.push(`${name}'s MU-2A is in LEAD/DEAD: its own brake valve works its #20 and #13 pipes instead of the lead's.`);
      const behind = ls[k - 1];
      if (!behind.hoseIndependent && l.mu2a === "Trail") w.push(`The #20 hose ahead of ${name} is parted: it gets no independent application or release.`);
      if (!behind.hoseActuating && l.mu2a === "Trail") w.push(`The #13 hose ahead of ${name} is parted: bail-off won't release it.`);
      if (l.compressorDead && !l.deadEngineCutOutOpen && !behind.hoseMainReservoir) w.push(`${name} has no compressor, no MR equalizing hose and a closed dead engine cock: nothing can recharge its main reservoirs.`);
    }
    if (l.brakeCylindersCutOut) w.push(`${name}'s brake cylinders are cut out.`);
    if (l.mainReservoirPsi < 45) w.push(`${name}'s main reservoirs are down to ${r(l.mainReservoirPsi)} psi: its relay valve can't fill the cylinders to what it's asked for.`);
  });
  const f = lead.flows;
  if (lead.automatic === "Emergency") n.push("Emergency: the brake valve vents the brake pipe straight to atmosphere.");
  else if (f.brakePipe > 5) n.push(`The lead relay valve is charging the brake pipe from the main reservoirs (${r(lead.brakePipePsi)} psi, heading for the equalizing reservoir at ${r(lead.equalizingPsi)}).`);
  else if (f.brakePipe < -5) n.push(`The brake pipe is exhausting at the lead brake valve down to the equalizing reservoir (${r(lead.equalizingPsi)} psi).`);
  else if (lead.brakeValveCutIn) n.push(`Brake pipe is holding at ${r(lead.brakePipePsi)} psi; the relay valve feeds just enough to make up leakage (${r(view.flowScfm)} CFM).`);
  ls.forEach((l, k) => { if (l.automaticPsi > 2) n.push(`Unit ${k + 1}'s control valve asks its relay valve for ${r(l.automaticPsi)} psi on the automatic.`); });
  if (lead.independentPipePsi > 2) {
    n.push(`Independent at ${r(lead.independentPipePsi)} psi on the #20 pipe; each relay valve fills its own cylinders from its own main reservoirs.`);
    ls.forEach((l, k) => { if (l.relayValve === "J1_6_16" && l.independentPipePsi > 2) n.push(`Unit ${k + 1}'s J-1.6-16 relay valve turns ${r(l.independentPipePsi)} psi on #20 into ${r(l.relayTargetPsi)} psi in its cylinders (1.6 : 1).`); });
  }
  else if (f.independent < -1) n.push("The independent is releasing: #20 exhausts through the lead brake valve.");
  if (lead.actuatingPipePsi > 15) n.push(`Bail off: the #13 actuating pipe is charged (${r(lead.actuatingPipePsi)} psi) and the control valves drop their automatic application.`);
  ls.forEach((l, k) => { if (l.flows.deadEngine > 0.5) n.push(`Dead engine: brake pipe air passes the choke and check valve into unit ${k + 1}'s main reservoirs (${r(l.mainReservoirPsi)} psi).`); });
  if (ls.some(l => l.compressorRunning)) n.push("Compressors are pumping the main reservoirs up (cut out at 140 psi).");
  $("warns").innerHTML = w.map(x => `<div>${esc(x)}</div>`).join("");
  $("now").innerHTML = n.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join("");
}

// ---- drawing ------------------------------------------------------------------------------------------------

function render() {
  const v = view;
  const has = v && v.locomotives && v.locomotives.length > 0;
  $("noTrain").hidden = !!has; $("rack").hidden = !has;
  $("status").textContent = !v ? "Not running" : v.paused ? "Paused" : `Running ${v.speedFactor}x`;
  if (!has) return;
  if (built !== v.locomotives.length) { build(); carCount = -1; }
  drawHoses();
  renderCar();
  refreshConfig();
  v.locomotives.forEach((l, k) => {
    $(`mrT${k}`).textContent = `${Math.round(l.mainReservoirPsi)} psi`;
    $(`erT${k}`).textContent = `${Math.round(l.equalizingPsi)} psi`;
    $(`muT${k}`).textContent = l.mu2a === "Trail" ? "TRAIL 6 / 26" : "LEAD / DEAD";
    $(`cvT${k}`).textContent = `asks ${Math.round(l.controlValvePsi)} psi`;
    $(`cvS${k}`).textContent = l.controlValvePsi > 1 && l.automaticPsi < 1 ? "bailed off" : l.controlValvePsi > 1 ? "applied" : "released";
    const j16 = l.relayValve === "J1_6_16";
    $(`rvN${k}`).textContent = j16 ? "J-1.6-16 relay" : "J-1 relay valve";
    $(`ctlT${k}`).textContent = `${Math.round(l.relayTargetPsi)} psi`;
    $(`bcT${k}`).textContent = `${Math.round(l.brakeCylinderPsi)} psi`;
    $(`t20${k}`).textContent = Math.round(l.independentPipePsi); $(`t13${k}`).textContent = Math.round(l.actuatingPipePsi); $(`tbp${k}`).textContent = Math.round(l.brakePipePsi);
    $(`comp${k}`).textContent = l.compressorDead ? "dead" : l.compressorRunning ? "running" : "off";
    cock(`ckbv${k}`, l.brakeValveCutIn); cock(`ckde${k}`, l.deadEngineCutOutOpen); cock(`ckbc${k}`, !l.brakeCylindersCutOut);
    const a = k === 0 && l.automatic === "Service" ? AUTO_ANG.Minimum + (v.reductionPsi - 6) / 20 * (AUTO_ANG.FullService - AUTO_ANG.Minimum) : (AUTO_ANG[l.automatic] ?? -130);
    $(`auto${k}`).style.transform = `rotate(${a}deg)`;
    $(`indh${k}`).style.transform = `rotate(${-130 + l.independent * 260}deg)` + (l.bailOff ? " scale(.82)" : "");
    const travel = Math.max(0, Math.min(1, (l.brakeCylinderPsi - 3) / 20)) * 16 + 4;
    $(`rodL${k}`).setAttribute("x2", 400 - travel); $(`rodR${k}`).setAttribute("x2", 540 + travel);
  });
  for (const g of gauges) for (const s of ["a", "b"]) {
    const val = L(g.k)[g[s][0]];
    $(g.id + s).style.transform = `rotate(${-135 + Math.max(0, Math.min(160, val)) / 160 * 270}deg)`;
    $(g.id + s + "v").textContent = Math.round(val);
  }
  // brake valve card
  for (const b of $("autoSeg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.a === v.automatic);
  if (document.activeElement !== $("ind")) $("ind").value = Math.round(v.independent * 100);
  showIndependent(+$("ind").value / 100);
  if (v.automatic === "Service" && document.activeElement !== $("red")) { $("red").value = Math.round(v.reductionPsi); }
  $("redOut").textContent = `${$("red").value} psi`;
  narrate();
}
function cock(id, open) {
  const h = $(id).querySelector(".cockh");
  h.style.transform = open ? "rotate(90deg)" : "rotate(0deg)";
  h.setAttribute("stroke", open ? "var(--text)" : "var(--bad)");
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (view && built && view.locomotives.length === built) {
    const run = !view.paused;
    for (const p of pipes) {
      if (p.fillEl) p.fillEl.style.opacity = Math.max(0, Math.min(1, p.net() / p.full));
      if (p.flow) flowDash(p.dashEl, p.flow(), dt, p, run);
    }
    for (const hz of hoses) {
      if (!hz.fills) continue;
      const v = Math.max(0, Math.min(1, L(hz.k)[hz.h.psi] / (hz.h.sys === "ind" ? 90 : 140)));
      hz.fills.forEach(f => f.style.opacity = v);
      flowDash(hz.dash, L(hz.k).flows[hz.h.key], dt, hz, run);
    }
    animateCar(dt, run);
  }
  requestAnimationFrame(animate);
}
function flowDash(el, q, dt, obj, run) {
  if (!el) return;
  const m = Math.abs(q);
  if (m < 0.3) { el.style.opacity = 0; return; }
  el.style.opacity = Math.min(1, 0.35 + m / 20);
  if (reduceMotion || !run) return;
  obj.off = (obj.off - Math.sign(q) * Math.min(80, 6 * Math.sqrt(m)) * dt * Math.sqrt(view.speedFactor || 1)) % 13;
  el.style.strokeDashoffset = obj.off;
}

// ---- layers and controls --------------------------------------------------------------------------------------

const layerOff = new Set();
function setLayer(k, on) {
  if (on) layerOff.delete(k); else layerOff.add(k);
  $("lay-" + k).classList.toggle("off", !on);
  const g = document.querySelector(`.lay[data-sys="${k}"]`); if (g) g.classList.toggle("off", !on);
}
for (const [k, n] of Object.entries(SYS)) {
  const b = document.createElement("button"); b.className = "chip"; b.id = "lay-" + k; b.style.setProperty("--c", `var(--${k})`);
  b.innerHTML = `<i></i>${n}`; b.onclick = () => setLayer(k, layerOff.has(k)); $("layers").appendChild(b);
}
for (const [n, list] of Object.entries(PRESETS)) {
  const b = document.createElement("button"); b.textContent = n; b.onclick = () => { for (const k of Object.keys(SYS)) setLayer(k, list.includes(k)); }; $("presets").appendChild(b);
}
for (const b of $("autoSeg").querySelectorAll("button"))
  b.onclick = () => control({ automatic: b.dataset.a, serviceFraction: (+$("red").value - 6) / 20 });
$("red").oninput = () => { $("redOut").textContent = `${$("red").value} psi`; };
$("red").onchange = () => control({ automatic: "Service", serviceFraction: (+$("red").value - 6) / 20 });
$("ind").oninput = () => showIndependent(+$("ind").value / 100);
$("ind").onchange = () => control({ independent: +$("ind").value / 100 });
// The independent sets #20 (45 psi at full); each unit's relay valve turns that into its cylinder pressure, 1 : 1 on a
// J-1 and 1.6 : 1 on a J-1.6-16 (45 on #20 = 72 in the cylinders).
const IND_FULL_PSI = 45, RELAY = { J1: ["J-1", 1], J1_6_16: ["J-1.6-16", 1.6] };
function showIndependent(fraction) {
  const p20 = fraction * IND_FULL_PSI, r = Math.round;
  const kinds = [...new Set(view.locomotives.map(l => l.relayValve))].map(k => RELAY[k] ?? RELAY.J1);
  $("indOut").textContent = kinds.length === 1 && kinds[0][1] === 1 ? `${r(p20)} psi`
    : `#20 ${r(p20)} psi · BC ` + kinds.map(([name, ratio]) => `${r(p20 * ratio)}` + (kinds.length > 1 ? ` (${name})` : "")).join(" / ") + " psi";
}
const bail = $("bail");
const down = e => { e.preventDefault(); bail.classList.add("down"); control({ bailOff: true }); };
const up = () => { if (!bail.classList.contains("down")) return; bail.classList.remove("down"); control({ bailOff: false }); };
bail.addEventListener("pointerdown", down);
for (const ev of ["pointerup", "pointerleave", "pointercancel", "blur"]) bail.addEventListener(ev, up);
bail.addEventListener("keydown", e => { if (e.key === " " && !e.repeat) down(e); });
bail.addEventListener("keyup", e => { if (e.key === " ") up(); });
$("startTrain").onclick = () => post("start", { locomotives: +$("nLocos").value, cars: +$("nCars").value, startCharged: true, trainLeakageScfm: 10, loadedShare: 0.5, feedValvePsi: 90 });

const conn = new signalR.HubConnectionBuilder().withUrl("hub/train").withAutomaticReconnect([0, 1000, 2000, 5000, 5000]).build();
conn.on("airbrake", v => { view = v; render(); });

(async () => {
  await requireUser();
  const s = await api("api/airbrake");
  view = s.view; render();
  await conn.start();
  requestAnimationFrame(animate);
})();
