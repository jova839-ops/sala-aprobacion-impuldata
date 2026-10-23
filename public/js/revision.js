const SCENE_ROLE_LABEL = {
  gancho: "Gancho",
  desarrollo: "Desarrollo",
  mensaje: "Mensaje",
  cierre_y_llamado_a_la_accion: "Cierre y llamado a la acción",
};

function formatSeconds(start, end) {
  const fmt = (v) => v.toFixed(2).replace(".", ",");
  return `Del segundo ${fmt(start)} al ${fmt(end)}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

const shareSlug = window.location.pathname.split("/").filter(Boolean)[1];
const app = document.getElementById("app");

const state = { data: null, reviews: {}, submitting: false, actaUrl: null };

async function load() {
  try {
    const res = await fetch(`/api/review/${shareSlug}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No pudimos cargar esta sala.");
    state.data = data;
    render();
  } catch (err) {
    app.innerHTML = `<div class="center-state"><p class="error-text">${escapeHtml(err.message)}</p></div>`;
  }
}

function allDecided() {
  if (!state.data) return false;
  return state.data.scenes.every((s) => state.reviews[s.id] && state.reviews[s.id].decision);
}

function missingCommentScene() {
  if (!state.data) return null;
  return state.data.scenes.find((s) => {
    const r = state.reviews[s.id];
    return r && r.decision === "ajuste_solicitado" && (!r.comment || !r.comment.trim());
  });
}

function render() {
  const { project, scenes, rounds, activeRoundId } = state.data;
  const locked = activeRoundId === null;
  const latestLocked = [...rounds].reverse().find((r) => r.status === "bloqueada");

  let sceneCards = "";
  for (const scene of scenes) {
    const review = state.reviews[scene.id] || { decision: null, comment: "" };
    sceneCards += `
      <article class="scene-card">
        <div class="scene-image-wrap">
          <img src="${escapeHtml(scene.imagePath)}" alt="Cuadro ${scene.sceneNumber}: ${escapeHtml(scene.sceneTitle)}" loading="lazy" />
        </div>
        <div class="scene-body">
          <div class="scene-meta">
            <span class="badge">Cuadro ${scene.sceneNumber}</span>
            <span class="badge">${SCENE_ROLE_LABEL[scene.sceneRole] || scene.sceneRole}</span>
            <span class="scene-seconds">${formatSeconds(scene.secondsStart, scene.secondsEnd)}</span>
          </div>
          <h3 class="scene-title">${escapeHtml(scene.sceneTitle)}</h3>
          <div>
            <span class="field-label">Qué queremos que sientas</span>
            <p class="field-text">${escapeHtml(scene.intendedFeeling)}</p>
          </div>
          <div>
            <span class="field-label">Por qué lo hicimos así</span>
            <p class="field-text">${escapeHtml(scene.artisticReasoning)}</p>
          </div>
          <div class="decision-row">
            <button type="button" data-scene="${scene.id}" data-decision="aprobado"
              class="${review.decision === "aprobado" ? "active-approve" : ""}" ${locked ? "disabled" : ""}>
              ✓ Aprobado
            </button>
            <button type="button" data-scene="${scene.id}" data-decision="ajuste_solicitado"
              class="${review.decision === "ajuste_solicitado" ? "active-adjust" : ""}" ${locked ? "disabled" : ""}>
              Quiero un ajuste
            </button>
          </div>
          ${review.decision === "ajuste_solicitado" ? `
            <textarea data-comment="${scene.id}" rows="3" placeholder="Obligatorio: cuéntanos qué cambiarías en este cuadro…" ${locked ? "disabled" : ""}>${escapeHtml(review.comment)}</textarea>
          ` : ""}
        </div>
      </article>
      <aside class="tier-card">
        <div class="tier-col">
          <span class="field-label">Lo que tienes hoy</span>
          <strong>${escapeHtml(project.currentTierLabel || "—")}</strong>
          <p class="hint">${escapeHtml(project.currentTierDescription || "—")}</p>
        </div>
        <div class="tier-col">
          <span class="field-label" style="color:var(--primary);">✨ Siguiente nivel</span>
          <strong>${escapeHtml(project.nextTierLabel || "—")}</strong>
          <p class="hint">${escapeHtml(project.nextTierDescription || "—")}</p>
        </div>
      </aside>
    `;
  }

  let submitSection = "";
  if (locked) {
    submitSection = `
      <div class="submit-section">
        <p><strong>${latestLocked ? `Ya enviaste tu revisión (ronda ${latestLocked.roundNumber} de ${project.maxReviewRounds}).` : "Esta sala ya no tiene rondas disponibles."}</strong></p>
        ${latestLocked ? `<a href="/api/review/${shareSlug}/acta/${latestLocked.id}.pdf" target="_blank">📄 Ver acta en PDF</a>` : ""}
      </div>`;
  } else if (state.actaUrl) {
    submitSection = `
      <div class="submit-section">
        <p><strong>Gracias, tu revisión quedó guardada.</strong></p>
        <a href="${state.actaUrl}" target="_blank">📄 Ver acta en PDF</a>
      </div>`;
  } else {
    const missing = missingCommentScene();
    let hint;
    if (missing) {
      hint = `Falta el comentario del cuadro ${missing.sceneNumber} (pediste un ajuste ahí).`;
    } else if (allDecided()) {
      hint = `Ya marcaste los ${scenes.length} cuadros. Cuando envíes, esta ronda queda bloqueada.`;
    } else {
      hint = `Marca "Aprobado" o "Quiero un ajuste" en cada cuadro para poder enviar.`;
    }
    const canSubmit = allDecided() && !missing && !state.submitting;
    submitSection = `
      <div class="submit-section">
        <p class="hint">${hint}</p>
        <button type="button" id="submit-btn" class="primary" ${canSubmit ? "" : "disabled"}>
          ${state.submitting ? "Enviando…" : "Enviar revisión"}
        </button>
      </div>`;
  }

  app.innerHTML = `
    <header class="hero">
      <span class="kicker">ImpulData · Sala de Aprobación</span>
      <h1>${escapeHtml(project.pieceName)}</h1>
      ${project.introMessage ? `<p>${escapeHtml(project.introMessage)}</p>` : ""}
    </header>

    <section class="section">
      <h2>La idea</h2>
      <div class="idea-grid">
        <div><span class="field-label">El ángulo</span><p class="field-text">${escapeHtml(project.ideaAngle || "—")}</p></div>
        <div><span class="field-label">A quién le habla</span><p class="field-text">${escapeHtml(project.ideaAudience || "—")}</p></div>
        <div><span class="field-label">Colores</span><p class="field-text">${escapeHtml(project.colorPaletteNotes || "—")}</p></div>
        <div><span class="field-label">Tipografía</span><p class="field-text">${escapeHtml(project.typographyNotes || "—")}</p></div>
      </div>
    </section>

    <section class="section">
      <h2>Cuadro por cuadro</h2>
      <div style="display:flex; flex-direction:column; gap:1rem;">
        ${sceneCards}
      </div>
    </section>

    ${submitSection}
  `;

  app.querySelectorAll("[data-scene][data-decision]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sceneId = Number(btn.dataset.scene);
      const decision = btn.dataset.decision;
      const prev = state.reviews[sceneId] || { comment: "" };
      state.reviews[sceneId] = { decision, comment: prev.comment || "" };
      render();
    });
  });

  app.querySelectorAll("[data-comment]").forEach((ta) => {
    ta.addEventListener("input", () => {
      const sceneId = Number(ta.dataset.comment);
      const prev = state.reviews[sceneId] || { decision: null };
      state.reviews[sceneId] = { decision: prev.decision, comment: ta.value };
    });
  });

  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) submitBtn.addEventListener("click", submitReview);
}

async function submitReview() {
  if (state.submitting) return;
  state.submitting = true;
  render();
  try {
    const reviews = state.data.scenes.map((s) => ({
      sceneId: s.id,
      decision: state.reviews[s.id].decision,
      comment: state.reviews[s.id].comment ? state.reviews[s.id].comment.trim() : null,
    }));
    const res = await fetch(`/api/review/${shareSlug}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId: state.data.activeRoundId, reviews }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "No se pudo enviar la revisión.");
    state.actaUrl = result.actaPdfUrl;
    state.submitting = false;
    render();
  } catch (err) {
    state.submitting = false;
    render();
    alert(err.message);
  }
}

load();
