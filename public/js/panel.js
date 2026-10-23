function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const app = document.getElementById("app");

async function load() {
  try {
    const sessionRes = await fetch("/api/session");
    if (!sessionRes.ok) {
      window.location.href = "/login";
      return;
    }
    const session = await sessionRes.json();

    const res = await fetch("/api/admin/projects");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar.");

    let rows = "";
    if (data.projects.length === 0) {
      rows = `<p class="hint">Todavía no hay proyectos.</p>`;
    }
    for (const p of data.projects) {
      const badge = p.latestRoundNumber
        ? `<span class="badge ${p.latestRoundStatus === "bloqueada" ? "" : "badge-primary"}">Ronda ${p.latestRoundNumber} · ${p.latestRoundStatus === "bloqueada" ? "enviada" : "abierta"}</span>`
        : "";
      rows += `
        <a class="panel-row" href="/panel/${p.id}">
          <div>
            <div class="hint" style="font-size:0.75rem;">${escapeHtml(p.encargoCode)}</div>
            <div class="scene-title" style="font-size:1.1rem;">${escapeHtml(p.pieceName)}</div>
            <div class="hint" style="font-size:0.8125rem;">${escapeHtml(p.clientName)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
            ${badge}
            <span class="hint" style="font-size:0.8125rem;">${p.approvedScenesInLatestRound} aprobados · ${p.adjustScenesInLatestRound} con ajuste de ${p.totalScenes}</span>
            <a href="/revision/${p.shareSlug}" target="_blank" onclick="event.stopPropagation()" style="font-size:0.8125rem;">link del cliente</a>
          </div>
        </a>`;
    }

    app.innerHTML = `
      <header class="panel-header">
        <div>
          <span class="kicker">ImpulData · Panel</span>
          <h1>Proyectos en revisión</h1>
        </div>
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <span class="hint" style="font-size:0.8125rem;">${escapeHtml(session.email)}</span>
          <button type="button" id="logout-btn">Salir</button>
        </div>
      </header>
      <div style="display:flex; flex-direction:column; gap:0.75rem;">${rows}</div>
    `;

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await fetch("/api/logout", { method: "POST" });
      window.location.href = "/login";
    });
  } catch (err) {
    app.innerHTML = `<div class="center-state"><p class="error-text">${escapeHtml(err.message)}</p></div>`;
  }
}

load();
