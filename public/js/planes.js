// Client-side script para el Generador de Planes y Propuestas

let currentPlansData = null;

async function loadPlans() {
  const clientName = document.getElementById("clientName").value.trim() || "Cliente General";
  const nicho = document.getElementById("clientNiche").value;
  const goal = document.getElementById("clientGoal").value;
  const container = document.getElementById("plansContainer");

  container.innerHTML = `<p style="text-align: center; color: var(--muted-foreground); padding: 3rem 0;">Consultando plantillas y calculando propuesta inteligente…</p>`;

  try {
    const res = await fetch(`/api/planes/sugeridos?nicho=${encodeURIComponent(nicho)}&objetivo=${encodeURIComponent(goal)}`);
    const data = await res.json();
    currentPlansData = data;

    renderPlans(data.planes, clientName, nicho, goal);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="color: var(--error); text-align: center;">Error conectando con la base de datos Neon.</p>`;
  }
}

function renderPlans(planes, clientName, nicho, goal) {
  const container = document.getElementById("plansContainer");
  if (!planes || planes.length === 0) {
    container.innerHTML = `<p>No hay planes disponibles para este filtro.</p>`;
    return;
  }

  let html = `<div class="plans-grid">`;

  for (const plan of planes) {
    const isFeatured = plan.recomendada;
    html += `
      <div class="plan-card ${isFeatured ? 'featured' : ''}">
        ${isFeatured ? '<span class="badge-featured">Recomendado</span>' : ''}
        <div>
          <span class="kicker">${plan.cantidadVideos} Videos / Mes</span>
          <h3 style="font-size: 1.25rem; margin-top: 0.25rem;">${plan.nombre}</h3>
          <p style="font-size: 0.85rem; color: var(--muted-foreground); margin-top: 0.4rem;">${plan.descripcion}</p>
        </div>

        <div>
          <div class="price">$${plan.precioCop.toLocaleString('es-CO')} <span style="font-size: 0.9rem; font-weight: normal; color: var(--muted-foreground);">COP</span></div>
          <div class="price-usd">Aprox. $${plan.precioUsd} USD</div>
        </div>

        <div>
          <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: 0.5rem;">
            Plantillas Sugeridas del Catálogo:
          </div>
          <div style="max-height: 190px; overflow-y: auto; padding-right: 4px;">
            ${plan.plantillas.map(t => `
              <div class="template-item">
                <div class="template-header">
                  <span>${t.nombre}</span>
                  <span style="font-size: 0.75rem; text-transform: uppercase; color: var(--primary);">${t.nivel}</span>
                </div>
                ${t.gancho ? `<div class="template-hook">"${t.gancho.slice(0, 60)}…"</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--muted-foreground); margin-bottom: 0.5rem;">
            Entregables Incluidos:
          </div>
          <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.82rem; color: var(--foreground); display: flex; flex-direction: column; gap: 0.25rem;">
            ${plan.entregables.map(e => `<li>${e}</li>`).join('')}
          </ul>
        </div>

        <div style="margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--border);">
          <button class="btn ${isFeatured ? 'primary' : 'outline'}" style="width: 100%;" onclick="saveProposal('${plan.id}')">
            Guardar y Emitir PDF
          </button>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;
}

async function saveProposal(selectedPlanId) {
  if (!currentPlansData) return;
  const clientName = document.getElementById("clientName").value.trim() || "Cliente General";
  const nicho = document.getElementById("clientNiche").value;
  const goal = document.getElementById("clientGoal").value;

  const payload = {
    clienteNombre: clientName,
    nicho: nicho,
    objetivoComercial: goal,
    opciones: currentPlansData.planes.map(p => ({
      nombre: p.nombre,
      cantidadVideos: p.cantidadVideos,
      precioCop: p.precioCop,
      precioUsd: p.precioUsd,
      entregables: p.entregables,
      plantillasIds: p.plantillas.map(t => t.id),
      recomendada: p.id === selectedPlanId
    })),
    notas: `Generado para ${clientName} enfocado en ${goal}.`,
    creadoPor: "TATAN"
  };

  try {
    const res = await fetch("/api/propuestas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.ok) {
      alert(`¡Propuesta ${result.codigo} guardada en Neon Postgres! Abriendo PDF comercial…`);
      window.open(`/api/propuestas/${result.propuesta.id}/pdf`, "_blank");
      loadSavedProposals();
    } else {
      alert("Error: " + (result.error || "No se pudo guardar"));
    }
  } catch (err) {
    console.error(err);
    alert("Error de conexión al guardar propuesta.");
  }
}

async function loadSavedProposals() {
  const container = document.getElementById("savedProposals");
  try {
    const res = await fetch("/api/propuestas");
    const data = await res.json();
    if (!data.propuestas || data.propuestas.length === 0) {
      container.innerHTML = `<p style="color: var(--muted-foreground);">No hay propuestas guardadas aún en Neon.</p>`;
      return;
    }

    let html = `
      <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; text-align: left;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border); color: var(--muted-foreground);">
            <th style="padding: 0.5rem;">Código</th>
            <th style="padding: 0.5rem;">Cliente</th>
            <th style="padding: 0.5rem;">Nicho</th>
            <th style="padding: 0.5rem;">Inversión Est.</th>
            <th style="padding: 0.5rem;">Fecha</th>
            <th style="padding: 0.5rem; text-align: right;">Acciones</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const p of data.propuestas) {
      html += `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 0.6rem; font-weight: 700; color: var(--primary);">${p.codigo_propuesta}</td>
          <td style="padding: 0.6rem;">${p.cliente_nombre}</td>
          <td style="padding: 0.6rem;">${p.nicho}</td>
          <td style="padding: 0.6rem; font-weight: 600;">$${Number(p.total_estimado_cop).toLocaleString('es-CO')} COP</td>
          <td style="padding: 0.6rem; color: var(--muted-foreground);">${new Date(p.created_at).toLocaleDateString('es-CO')}</td>
          <td style="padding: 0.6rem; text-align: right;">
            <a href="/api/propuestas/${p.id}/pdf" target="_blank" class="btn outline" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
              Descargar PDF
            </a>
          </td>
        </tr>
      `;
    }

    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="color: var(--error);">Error cargando historial de propuestas.</p>`;
  }
}

document.getElementById("btnGenerate").addEventListener("click", loadPlans);

// Carga inicial
loadPlans();
loadSavedProposals();
