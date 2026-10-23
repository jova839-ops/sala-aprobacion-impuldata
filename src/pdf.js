const PDFDocument = require("pdfkit");

const SCENE_ROLE_LABEL = {
  gancho: "Gancho",
  desarrollo: "Desarrollo",
  mensaje: "Mensaje",
  cierre_y_llamado_a_la_accion: "Cierre y llamado a la acción",
};

const DECISION_LABEL = {
  aprobado: "Aprobado",
  ajuste_solicitado: "Quiere un ajuste",
};

// Escribe el acta directo al stream de respuesta HTTP (res). No se guarda en disco.
function streamActaPdf(res, { pieceName, clientName, roundNumber, maxReviewRounds, submittedAt, scenes }) {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  doc.pipe(res);

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#2a1f24").text("Acta de revisión");
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(14).text(pieceName);
  doc.fontSize(11).fillColor("#5a4f54").text(`Cliente: ${clientName}`);
  const fecha = submittedAt
    ? new Date(submittedAt).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })
    : "";
  doc.text(`Ronda ${roundNumber} de ${maxReviewRounds} · ${fecha}`);
  doc.moveDown(1);

  for (const scene of scenes) {
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#2a1f24")
      .text(`Cuadro ${scene.scene_number} — ${scene.scene_title}`);
    doc.font("Helvetica").fontSize(10).fillColor("#70616a")
      .text(`Rol: ${SCENE_ROLE_LABEL[scene.scene_role] || scene.scene_role}`);
    doc.font("Helvetica-Bold").fontSize(11)
      .fillColor(scene.decision === "aprobado" ? "#2e7d32" : "#a8432f")
      .text(`Decisión: ${DECISION_LABEL[scene.decision] || scene.decision}`);
    if (scene.comment && scene.comment.trim()) {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor("#43506b")
        .text(`Comentario: ${scene.comment.trim()}`);
    }
    doc.moveDown(0.8);
  }

  doc.end();
}

module.exports = { streamActaPdf };
