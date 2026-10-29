// Catálogo de plantillas: carga todo una vez y filtra en el navegador.
const TIER = {
  agencia: { label: "Agencia", colors: ["#3b2330", "#b9792b"] },
  creador: { label: "Creador", colors: ["#2f4858", "#c08552"] },
  ugc: { label: "UGC", colors: ["#2f6b66", "#d7a35b"] },
  aprobado: { label: "Aprobada ImpulData", colors: ["#6b3d5a", "#e0a96d"] },
  apoyo: { label: "Apoyo (Mixkit)", colors: ["#5a4a42", "#a89280"] },
  guia: { label: "Guía", colors: ["#3d3a5c", "#8a7fb5"] },
};
const NIVEL = { premium: "Premium", estandar: "Estándar", guia: "Guía" };
const FMT = { vertical: "Vertical 9:16", horizontal: "Horizontal 16:9", cuadrado: "Cuadrado 1:1" };
const CAP = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

const els = {
  grid: document.getElementById("grid"), empty: document.getElementById("empty"), q: document.getElementById("q"),
  seg: document.getElementById("nivelSeg"), tier: document.getElementById("fTier"), nicho: document.getElementById("fNicho"),
  objetivo: document.getElementById("fObjetivo"), fmt: document.getElementById("fFmt"), sort: document.getElementById("fSort"),
  count: document.getElementById("resultCount"), clear: document.getElementById("clear"), stats: document.getElementById("stats"),
  drawer: document.getElementById("drawer"), scrim: document.getElementById("scrim"),
};
const state = { all: [], nivel: "", q: "" };

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}
const nivelOf = (p) => p.nivel || (p.tier === "guia" ? "guia" : "estandar");

function hash(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
function initials(t) {
  const words = String(t).replace(/[·\-–—]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  return ((words[0] || t)[0] + ((words[1] || "")[0] || "")).toUpperCase();
}
function posterHtml(p, big) {
  const [a, b] = (TIER[p.tier] || TIER.apoyo).colors;
  const angle = 110 + (hash(p.id) % 90);
  const fmt = FMT[p.fmt] ? p.fmt : "horizontal";
  const nivel = nivelOf(p);
  const dur = p.seg ? `${Math.round(Number(p.seg))} s` : "";
  const cortes = p.cortes ? ` · ${p.cortes} cortes` : "";
  return `
    <div class="poster" style="background:linear-gradient(${angle}deg, ${a}, ${b})">
      <span class="tl pill ${nivel}">${nivel === "premium" ? "★ " : ""}${NIVEL[nivel]}</span>
      <span class="tr pill glass">${esc((TIER[p.tier] || {}).label || CAP(p.tier))}</span>
      <div class="frame ${fmt}"><span>${esc(initials(p.titulo))}</span></div>
      ${dur || cortes ? `<span class="bl">${dur}${cortes}</span>` : ""}
      ${big ? '<button type="button" class="d-close" aria-label="Cerrar">✕</button>' : ""}
    </div>`;
}

function cardHtml(p) {
  const tags = [...(p.objetivos || []).slice(0, 2), ...(p.nichos || []).slice(0, 2)];
  return `
    <button type="button" class="card" data-id="${esc(p.id)}">
      ${posterHtml(p)}
      <div class="card-body">
        <div class="card-title">${esc(p.titulo)}</div>
        <div class="card-que">${esc(p.que || p.gramatica || p.uso || "")}</div>
        <div class="tags">${tags.map((t) => `<span class="tag">${esc(CAP(t))}</span>`).join("")}</div>
      </div>
    </button>`;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = state.all.filter((p) => {
    if (state.nivel && nivelOf(p) !== state.nivel) return false;
    if (els.tier.value && p.tier !== els.tier.value) return false;
    if (els.nicho.value && !(p.nichos || []).includes(els.nicho.value)) return false;
    if (els.objetivo.value && !(p.objetivos || []).includes(els.objetivo.value)) return false;
    if (els.fmt.value && p.fmt !== els.fmt.value) return false;
    if (q) {
      const hay = [p.titulo, p.que, p.gramatica, p.uso, p.angulo, p.autor, p.cliente, p.cat].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const rank = { premium: 0, estandar: 1, guia: 2 };
  if (els.sort.value === "titulo") list.sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
  else if (els.sort.value === "seg") list.sort((a, b) => (Number(a.seg) || 1e9) - (Number(b.seg) || 1e9));
  else list.sort((a, b) => rank[nivelOf(a)] - rank[nivelOf(b)] || a.titulo.localeCompare(b.titulo, "es"));
  return list;
}

function render() {
  const list = filtered();
  els.grid.innerHTML = list.map(cardHtml).join("");
  els.empty.hidden = list.length > 0;
  els.count.textContent = `${list.length} de ${state.all.length} plantillas`;
  const active = state.nivel || state.q || [els.tier, els.nicho, els.objetivo, els.fmt].some((s) => s.value);
  els.clear.hidden = !active;
  for (const s of [els.tier, els.nicho, els.objetivo, els.fmt]) s.classList.toggle("on", !!s.value);
  const params = new URLSearchParams();
  if (state.nivel) params.set("nivel", state.nivel);
  if (state.q) params.set("q", state.q);
  for (const [k, s] of [["origen", els.tier], ["nicho", els.nicho], ["objetivo", els.objetivo], ["formato", els.fmt]]) if (s.value) params.set(k, s.value);
  history.replaceState(null, "", params.toString() ? `?${params}` : location.pathname);
}

function renderSeg() {
  const counts = { "": state.all.length };
  for (const p of state.all) counts[nivelOf(p)] = (counts[nivelOf(p)] || 0) + 1;
  const opts = [["", "Todos"], ["premium", "Premium"], ["estandar", "Estándar"], ["guia", "Guías"]];
  els.seg.innerHTML = opts
    .map(([v, l]) => `<button type="button" role="tab" data-v="${v}" aria-selected="${state.nivel === v}">${l}<span class="n">${counts[v] || 0}</span></button>`)
    .join("");
}

function fillSelect(sel, values, labeler) {
  for (const v of values) sel.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(labeler(v))}</option>`);
}

function openDrawer(p) {
  const nivel = nivelOf(p);
  const facts = [
    [p.seg ? `${Number(p.seg).toFixed(1).replace(".0", "")} s` : "—", "Duración"],
    [p.cortes ?? "—", "Cortes"],
    [FMT[p.fmt] ? FMT[p.fmt].split(" ")[0] : "—", "Formato"],
  ];
  const sec = (title, body) => (body ? `<div class="d-sec"><h3>${title}</h3><p>${esc(body)}</p></div>` : "");
  const links = [];
  if (p.url) links.push(`<a class="primary" href="${esc(p.url)}" target="_blank" rel="noopener">Ver referencia ↗</a>`);
  if (p.x) links.push(`<a class="${p.url ? "ghost" : "primary"}" href="${esc(p.x)}" target="_blank" rel="noopener">Ver en X ↗</a>`);
  els.drawer.innerHTML = `
    ${posterHtml(p, true)}
    <div class="d-body">
      <div>
        <h2 id="dTitle">${esc(p.titulo)}</h2>
        <div class="d-sub">${esc([NIVEL[nivel], (TIER[p.tier] || {}).label, p.soft, p.autor, p.cliente].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="facts">${facts.map(([b, s]) => `<div><b>${esc(String(b))}</b><span>${s}</span></div>`).join("")}</div>
      ${sec("Qué es", p.que)}
      ${sec("Cómo se construye", p.gramatica)}
      ${sec("Para qué sirve", p.uso)}
      ${sec("Ángulo", p.angulo)}
      ${p.nivel_porque ? `<div class="d-sec"><h3>Por qué es ${esc(NIVEL[nivel])}</h3><p class="why">${esc(p.nivel_porque)}</p></div>` : ""}
      <div class="d-sec"><h3>Encaja con</h3><div class="tags">${[...(p.objetivos || []), ...(p.nichos || [])].map((t) => `<span class="tag">${esc(CAP(t))}</span>`).join("") || "—"}</div></div>
      ${links.length ? `<div class="d-actions">${links.join("")}</div>` : ""}
      <div class="d-id">ID ${esc(p.id)}${p.ficha ? ` · ficha ${esc(p.ficha)}` : ""}</div>
    </div>`;
  els.scrim.hidden = false;
  els.drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => els.drawer.classList.add("open"));
  els.drawer.querySelector(".d-close").focus();
  els.drawer.querySelector(".d-close").addEventListener("click", closeDrawer);
}
function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.scrim.hidden = true;
}

async function load() {
  els.grid.innerHTML = Array.from({ length: 8 }, () => `<div class="card skeleton"><div class="poster"></div><div class="card-body"><div></div><div style="width:70%"></div></div></div>`).join("");
  const res = await fetch("/api/plantillas?limit=200");
  if (res.status === 401) return;
  const data = await res.json();
  if (!res.ok) {
    els.grid.innerHTML = `<p class="empty">${esc(data.error || "No se pudo cargar el catálogo.")}</p>`;
    return;
  }
  state.all = data.plantillas;
  window.setNavCount && window.setNavCount("catalogo", state.all.length);

  const uniq = (fn) => [...new Set(state.all.flatMap(fn).filter(Boolean))].sort();
  fillSelect(els.tier, uniq((p) => [p.tier]), (v) => (TIER[v] || {}).label || CAP(v));
  fillSelect(els.nicho, uniq((p) => p.nichos || []), CAP);
  fillSelect(els.objetivo, uniq((p) => p.objetivos || []), CAP);
  fillSelect(els.fmt, uniq((p) => [p.fmt]), (v) => FMT[v] || CAP(v));

  const prem = state.all.filter((p) => nivelOf(p) === "premium").length;
  const refs = state.all.filter((p) => p.url || p.x).length;
  els.stats.innerHTML = [[state.all.length, "plantillas"], [prem, "premium"], [refs, "con referencia"]]
    .map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("");

  const params = new URLSearchParams(location.search);
  state.nivel = params.get("nivel") || "";
  state.q = params.get("q") || "";
  els.q.value = state.q;
  for (const [k, s] of [["origen", els.tier], ["nicho", els.nicho], ["objetivo", els.objetivo], ["formato", els.fmt]]) s.value = params.get(k) || "";
  renderSeg();
  render();
}

els.q.addEventListener("input", () => { state.q = els.q.value; render(); });
els.seg.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.nivel = b.dataset.v;
  renderSeg();
  render();
});
for (const s of [els.tier, els.nicho, els.objetivo, els.fmt, els.sort]) s.addEventListener("change", render);
els.clear.addEventListener("click", () => {
  state.nivel = ""; state.q = ""; els.q.value = "";
  for (const s of [els.tier, els.nicho, els.objetivo, els.fmt]) s.value = "";
  renderSeg();
  render();
});
els.grid.addEventListener("click", (e) => {
  const c = e.target.closest(".card[data-id]");
  if (c) openDrawer(state.all.find((p) => p.id === c.dataset.id));
});
els.scrim.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.scrim.hidden) closeDrawer();
  if (e.key === "/" && document.activeElement !== els.q && !/input|select|textarea/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    els.q.focus();
  }
});

load();
