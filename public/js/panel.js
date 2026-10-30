function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const app = document.getElementById("app");
let showPasswordForm = false;
let passwordMsg = "";
let passwordErr = "";

function renderSkeleton() {
  app.innerHTML = `
    <div class="skeleton" style="height:20px; width:200px;"></div>
    <div class="skeleton" style="height:70px; border-radius:0.65rem; margin-top:1rem;"></div>
    <div class="skeleton" style="height:70px; border-radius:0.65rem; margin-top:0.75rem;"></div>
    <div class="skeleton" style="height:70px; border-radius:0.65rem; margin-top:0.75rem;"></div>
  `;
}

async function changePassword(e) {
  e.preventDefault();
  passwordMsg = ""; passwordErr = "";
  const form = e.target;
  const currentPassword = form.currentPassword.value;
  const newPassword = form.newPassword.value;
  try {
    const res = await fetch("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo cambiar la contraseña.");
    passwordMsg = "Contraseña actualizada.";
    showPasswordForm = false;
    load();
  } catch (err) {
    passwordErr = err.message;
    load();
  }
}

async function load() {
  renderSkeleton();
  try {
    const sessionRes = await fetch("/api/session");
    if (!sessionRes.ok) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/admin/projects");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar.");

    let rows = "";
    if (data.projects.length === 0) {
      rows = `<p class="hint">Todavía no hay proyectos.</p>`;
    }
    data.projects.forEach((p, idx) => {
      const badge = p.latestRoundNumber
        ? `<span class="badge ${p.latestRoundStatus === "bloqueada" ? "" : "badge-primary"}">Ronda ${p.latestRoundNumber} · ${p.latestRoundStatus === "bloqueada" ? "enviada" : "abierta"}</span>`
        : "";
      rows += `
        <a class="panel-row rise" style="--i:${idx}" href="/panel/${p.id}">
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
    });

    app.innerHTML = `
      <header class="panel-header rise">
        <div>
          <span class="kicker">ImpulData · Panel</span>
          <h1>Proyectos en revisión</h1>
        </div>
        <button type="button" class="outline" id="toggle-password">🔒 Cambiar contraseña</button>
      </header>

      ${showPasswordForm ? `
        <form id="password-form" class="idea-grid rise" style="grid-template-columns:1fr; max-width:22rem;">
          <div><span class="field-label">Contraseña actual</span><input type="password" name="currentPassword" required /></div>
          <div><span class="field-label">Contraseña nueva (mín. 8 caracteres)</span><input type="password" name="newPassword" minlength="8" required /></div>
          ${passwordErr ? `<p class="error-text" style="margin:0;">${escapeHtml(passwordErr)}</p>` : ""}
          <button type="submit" class="primary" style="align-self:flex-start;">Guardar</button>
        </form>
      ` : ""}
      ${passwordMsg ? `<p class="hint" style="color:var(--success);">✓ ${escapeHtml(passwordMsg)}</p>` : ""}

      <div style="display:flex; flex-direction:column; gap:0.75rem;">${rows}</div>
    `;

    document.getElementById("toggle-password").addEventListener("click", () => {
      showPasswordForm = !showPasswordForm;
      passwordErr = "";
      load();
    });
    const form = document.getElementById("password-form");
    if (form) form.addEventListener("submit", changePassword);
  } catch (err) {
    app.innerHTML = `<div class="center-state"><p class="error-text">${escapeHtml(err.message)}</p></div>`;
  }
}

load();
