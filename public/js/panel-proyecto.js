function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const SCENE_ROLE_LABEL = {
  gancho: "Gancho",
  desarrollo: "Desarrollo",
  mensaje: "Mensaje",
  cierre_y_llamado_a_la_accion: "Cierre y llamado a la acción",
};

const projectId = window.location.pathname.split("/").filter(Boolean)[1];
const app = document.getElementById("app");

async function load() {
  try {
    const sessionRes = await fetch("/api/session");
    if (!sessionRes.ok) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch(`/api/admin/projects/${projectId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar.");

    const sceneById = new Map(data.scenes.map((s) => [s.id, s]));

    let roundsHtml = "";
    for (const round of data.rounds) {
      let reviewsHtml = "";
      for (const review of round.reviews) {
        const scene = sceneById.get(review.sceneId);
        reviewsHtml += `
          <div class="review-item">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
              <span style="font-size:0.875rem;">Cuadro ${scene ? scene.sceneNumber : "—"} — ${scene ? SCENE_ROLE_LABEL[scene.sceneRole] || scene.sceneRole : ""}</span>
              <span class="badge ${review.decision === "aprobado" ? "badge-success" : "badge-warning"}">
                ${review.decision === "aprobado" ? "Aprobado" : "Ajuste solicitado"}
              </span>
            </div>
            ${review.comment ? `<p class="hint" style="margin:0.25rem 0 0; font-style:italic;">${escapeHtml(review.comment)}</p>` : ""}
          </div>`;
      }

      roundsHtml += `
        <section class="round-card">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <h2 style="font-size:1.25rem;">Ronda ${round.roundNumber} de ${data.project.maxReviewRounds}</h2>
            <span class="badge ${round.status === "bloqueada" ? "" : "badge-primary"}">
              ${round.status === "bloqueada" ? "Enviada" : "Abierta — esperando al cliente"}
            </span>
          </div>
          ${round.submittedAt ? `<p class="hint" style="font-size:0.8125rem;">Enviada el ${new Date(round.submittedAt).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}</p>` : ""}
          ${round.submittedAt ? `<a href="/api/review/${data.project.shareSlug}/acta/${round.id}.pdf" target="_blank" style="font-size:0.8125rem;">📄 Ver acta en PDF</a>` : ""}
          ${reviewsHtml ? `<div>${reviewsHtml}</div>` : ""}
        </section>`;
    }

    app.innerHTML = `
      <a class="back-link" href="/panel">← Todos los proyectos</a>
      <header style="display:flex; flex-direction:column; gap:0.25rem;">
        <span class="kicker">${escapeHtml(data.project.encargoCode)}</span>
        <h1 style="font-size:1.875rem;">${escapeHtml(data.project.pieceName)}</h1>
        <p class="hint">${escapeHtml(data.project.clientName)}</p>
        <a href="/revision/${data.project.shareSlug}" target="_blank" style="font-size:0.8125rem;">Abrir sala de aprobación del cliente</a>
      </header>
      <div style="display:flex; flex-direction:column; gap:1rem;">${roundsHtml}</div>
    `;
  } catch (err) {
    app.innerHTML = `<div class="center-state"><p class="error-text">${escapeHtml(err.message)}</p></div>`;
  }
}

load();
