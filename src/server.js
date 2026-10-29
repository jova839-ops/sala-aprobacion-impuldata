// Sala de Aprobación y Generador de Planes ImpulData — Servidor Node/Express + Neon Postgres.
// Sistema unificado: Revisión de Storyboards, Catálogo de 97 Plantillas, Generador de Planes y Consecutivos ORG.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const PDFDocument = require("pdfkit");

// ---------- Auto-cargar .env local ----------
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

// ---------- DB ----------
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada.");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`
    DO $$ BEGIN CREATE TYPE scene_role AS ENUM ('gancho','desarrollo','mensaje','cierre_y_llamado_a_la_accion'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE review_decision AS ENUM ('aprobado','ajuste_solicitado'); EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE TYPE round_status AS ENUM ('abierta','bloqueada'); EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE TABLE IF NOT EXISTS storyboard_projects (
      id serial primary key, encargo_code text not null unique, piece_name text not null,
      client_name text not null, share_slug text not null unique, intro_message text,
      idea_angle text, idea_audience text, color_palette_notes text, typography_notes text,
      current_tier_label text, current_tier_description text, next_tier_label text, next_tier_description text,
      max_review_rounds integer not null default 2,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    CREATE TABLE IF NOT EXISTS storyboard_scenes (
      id serial primary key, project_id integer not null references storyboard_projects(id) on delete cascade,
      scene_number integer not null, scene_title text not null, scene_role scene_role not null,
      image_path text not null, seconds_start numeric(5,2) not null, seconds_end numeric(5,2) not null,
      intended_feeling text not null, artistic_reasoning text not null,
      created_at timestamptz not null default now(), unique(project_id, scene_number)
    );
    CREATE TABLE IF NOT EXISTS approval_rounds (
      id serial primary key, project_id integer not null references storyboard_projects(id) on delete cascade,
      round_number integer not null, status round_status not null default 'abierta',
      submitted_at timestamptz, created_at timestamptz not null default now(), unique(project_id, round_number)
    );
    CREATE TABLE IF NOT EXISTS scene_reviews (
      id serial primary key, round_id integer not null references approval_rounds(id) on delete cascade,
      scene_id integer not null references storyboard_scenes(id) on delete cascade,
      decision review_decision not null, comment text,
      created_at timestamptz not null default now(), unique(round_id, scene_id)
    );
    CREATE INDEX IF NOT EXISTS idx_storyboard_scenes_project ON storyboard_scenes(project_id);
    CREATE INDEX IF NOT EXISTS idx_approval_rounds_project ON approval_rounds(project_id);
    CREATE INDEX IF NOT EXISTS idx_scene_reviews_round ON scene_reviews(round_id);
  `);
}

// ---------- Auth ----------
const COOKIE_NAME = "sala_session";
const SESSION_HOURS = 12;

function getSecret() {
  return process.env.SESSION_SECRET || "impuldata_secret_2026_local_fallback";
}
function signSession(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}
function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", getSecret()).update(b64).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function requireAdmin(req, res, next) {
  const payload = verifySession(req.cookies[COOKIE_NAME]);
  if (!payload) return res.status(401).json({ error: "No autorizado. Inicia sesión." });
  req.adminEmail = payload.email;
  next();
}

// ---------- PDF del acta ----------
const SCENE_ROLE_LABEL = { gancho: "Gancho", desarrollo: "Desarrollo", mensaje: "Mensaje", cierre_y_llamado_a_la_accion: "Cierre y llamado a la acción" };
const DECISION_LABEL = { aprobado: "Aprobado", ajuste_solicitado: "Quiere un ajuste" };

function streamActaPdf(res, { pieceName, clientName, roundNumber, maxReviewRounds, submittedAt, scenes }) {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  doc.pipe(res);
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#2a1f24").text("Acta de revisión");
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(14).text(pieceName);
  doc.fontSize(11).fillColor("#5a4f54").text(`Cliente: ${clientName}`);
  const fecha = submittedAt ? new Date(submittedAt).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" }) : "";
  doc.text(`Ronda ${roundNumber} de ${maxReviewRounds} · ${fecha}`);
  doc.moveDown(1);
  for (const scene of scenes) {
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#2a1f24").text(`Cuadro ${scene.scene_number} — ${scene.scene_title}`);
    doc.font("Helvetica").fontSize(10).fillColor("#70616a").text(`Rol: ${SCENE_ROLE_LABEL[scene.scene_role] || scene.scene_role}`);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(scene.decision === "aprobado" ? "#2e7d32" : "#a8432f")
      .text(`Decisión: ${DECISION_LABEL[scene.decision] || scene.decision}`);
    if (scene.comment && scene.comment.trim()) {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor("#43506b").text(`Comentario: ${scene.comment.trim()}`);
    }
    doc.moveDown(0.8);
  }
  doc.end();
}

// ---------- App Setup ----------
const app = express();
const PORT = process.env.PORT || 3050;
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- Auth Routes ----------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const adminEmail = process.env.ADMIN_EMAIL || "tatan@impuldata.com";
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!email || !password) return res.status(400).json({ error: "Falta correo o contraseña." });
    if (email.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    let ok = false;
    if (adminHash) {
      ok = await bcrypt.compare(password, adminHash);
    } else {
      ok = password === "impuldata2026";
    }
    if (!ok) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    const token = signSession({ email: adminEmail, exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000 });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: SESSION_HOURS * 60 * 60 * 1000 });
    res.json({ email: adminEmail });
  } catch (err) {
    console.error("POST /api/login error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});
app.post("/api/logout", (req, res) => { res.clearCookie(COOKIE_NAME); res.json({ ok: true }); });
app.get("/api/session", requireAdmin, (req, res) => res.json({ email: req.adminEmail }));

// ---------- Review Routes (Público) ----------
app.get("/api/review/:shareSlug", async (req, res) => {
  try {
    const projectRes = await pool.query(`SELECT * FROM storyboard_projects WHERE share_slug = $1`, [req.params.shareSlug]);
    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "No encontramos este proyecto." });
    const scenesRes = await pool.query(`SELECT * FROM storyboard_scenes WHERE project_id = $1 ORDER BY scene_number ASC`, [project.id]);
    const roundsRes = await pool.query(`SELECT * FROM approval_rounds WHERE project_id = $1 ORDER BY round_number ASC`, [project.id]);
    const rounds = roundsRes.rows;
    const activeRound = rounds.find((r) => r.status === "abierta") || null;
    res.json({
      project: {
        id: project.id, encargoCode: project.encargo_code, pieceName: project.piece_name, clientName: project.client_name,
        introMessage: project.intro_message, ideaAngle: project.idea_angle, ideaAudience: project.idea_audience,
        colorPaletteNotes: project.color_palette_notes, typographyNotes: project.typography_notes,
        currentTierLabel: project.current_tier_label, currentTierDescription: project.current_tier_description,
        nextTierLabel: project.next_tier_label, nextTierDescription: project.next_tier_description, maxReviewRounds: project.max_review_rounds,
      },
      scenes: scenesRes.rows.map((s) => ({
        id: s.id, sceneNumber: s.scene_number, sceneTitle: s.scene_title, sceneRole: s.scene_role, imagePath: s.image_path,
        secondsStart: Number(s.seconds_start), secondsEnd: Number(s.seconds_end), intendedFeeling: s.intended_feeling, artisticReasoning: s.artistic_reasoning,
      })),
      rounds: rounds.map((r) => ({ id: r.id, roundNumber: r.round_number, status: r.status, submittedAt: r.submitted_at })),
      activeRoundId: activeRound ? activeRound.id : null,
    });
  } catch (err) {
    console.error("GET /api/review error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

app.post("/api/review/:shareSlug/submit", async (req, res) => {
  const client = await pool.connect();
  try {
    const { roundId, reviews } = req.body;
    if (!roundId || !Array.isArray(reviews) || reviews.length === 0) return res.status(400).json({ error: "Faltan datos de la revisión." });
    const projectRes = await client.query(`SELECT * FROM storyboard_projects WHERE share_slug = $1`, [req.params.shareSlug]);
    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "No encontramos este proyecto." });
    const roundRes = await client.query(`SELECT * FROM approval_rounds WHERE id = $1 AND project_id = $2`, [roundId, project.id]);
    const round = roundRes.rows[0];
    if (!round) return res.status(404).json({ error: "No encontramos esta ronda." });
    if (round.status !== "abierta") return res.status(409).json({ error: "Esta ronda ya fue enviada y quedó bloqueada." });
    const scenesRes = await client.query(`SELECT id, scene_number FROM storyboard_scenes WHERE project_id = $1`, [project.id]);
    const sceneIds = new Set(scenesRes.rows.map((s) => s.id));
    const reviewBySceneId = new Map(reviews.map((r) => [r.sceneId, r]));
    for (const scene of scenesRes.rows) {
      if (!reviewBySceneId.has(scene.id)) return res.status(400).json({ error: `Falta la decisión del cuadro ${scene.scene_number}.` });
    }
    for (const sceneId of reviewBySceneId.keys()) {
      if (!sceneIds.has(sceneId)) return res.status(400).json({ error: "Un cuadro enviado no pertenece a este proyecto." });
      const decision = reviewBySceneId.get(sceneId).decision;
      if (decision !== "aprobado" && decision !== "ajuste_solicitado") return res.status(400).json({ error: "Decisión inválida." });
    }
    await client.query("BEGIN");
    for (const scene of scenesRes.rows) {
      const review = reviewBySceneId.get(scene.id);
      await client.query(
        `INSERT INTO scene_reviews (round_id, scene_id, decision, comment) VALUES ($1,$2,$3,$4)
         ON CONFLICT (round_id, scene_id) DO UPDATE SET decision = EXCLUDED.decision, comment = EXCLUDED.comment`,
        [round.id, scene.id, review.decision, review.comment ? String(review.comment).trim() : null]
      );
    }
    const submittedAt = new Date();
    await client.query(`UPDATE approval_rounds SET status = 'bloqueada', submitted_at = $2 WHERE id = $1`, [round.id, submittedAt]);
    const nextRoundNumber = round.round_number + 1;
    const nextRoundOpened = nextRoundNumber <= project.max_review_rounds;
    if (nextRoundOpened) {
      await client.query(
        `INSERT INTO approval_rounds (project_id, round_number, status) VALUES ($1,$2,'abierta') ON CONFLICT (project_id, round_number) DO NOTHING`,
        [project.id, nextRoundNumber]
      );
    }
    await client.query("COMMIT");
    res.json({ roundNumber: round.round_number, actaPdfUrl: `/api/review/${req.params.shareSlug}/acta/${round.id}.pdf`, nextRoundOpened });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/review/submit error", err);
    res.status(500).json({ error: "Error inesperado." });
  } finally {
    client.release();
  }
});

app.get("/api/review/:shareSlug/acta/:roundId.pdf", async (req, res) => {
  try {
    const projectRes = await pool.query(`SELECT * FROM storyboard_projects WHERE share_slug = $1`, [req.params.shareSlug]);
    const project = projectRes.rows[0];
    if (!project) return res.status(404).send("No encontrado.");
    const roundRes = await pool.query(`SELECT * FROM approval_rounds WHERE id = $1 AND project_id = $2`, [req.params.roundId, project.id]);
    const round = roundRes.rows[0];
    if (!round || !round.submitted_at) return res.status(404).send("Esta ronda no tiene acta todavía.");
    const reviewsRes = await pool.query(
      `SELECT sr.decision, sr.comment, ss.scene_number, ss.scene_title, ss.scene_role
       FROM scene_reviews sr JOIN storyboard_scenes ss ON ss.id = sr.scene_id
       WHERE sr.round_id = $1 ORDER BY ss.scene_number ASC`,
      [round.id]
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="acta-${project.encargo_code}-ronda-${round.round_number}.pdf"`);
    streamActaPdf(res, {
      pieceName: project.piece_name, clientName: project.client_name, roundNumber: round.round_number,
      maxReviewRounds: project.max_review_rounds, submittedAt: round.submitted_at, scenes: reviewsRes.rows,
    });
  } catch (err) {
    console.error("GET acta error", err);
    res.status(500).send("Error generando el acta.");
  }
});

// ---------- Plantillas (Catálogo Neon) ----------
app.get("/api/plantillas", requireAdmin, async (req, res) => {
  try {
    const { nivel, nicho, search, limit = 100 } = req.query;
    let query = `SELECT id, tier, nivel, titulo, autor, que, angulo, seg, cortes, nichos, objetivos, url FROM plantillas WHERE 1=1`;
    const params = [];
    if (nivel) {
      params.push(nivel);
      query += ` AND nivel = $${params.length}`;
    }
    if (nicho) {
      params.push(nicho);
      query += ` AND $${params.length} = ANY(nichos)`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (titulo ILIKE $${params.length} OR que ILIKE $${params.length} OR angulo ILIKE $${params.length})`;
    }
    query += ` ORDER BY id ASC LIMIT $${params.length + 1}`;
    params.push(Math.min(parseInt(limit, 10) || 100, 200));

    const result = await pool.query(query, params);
    res.json({ total: result.rowCount, plantillas: result.rows });
  } catch (err) {
    console.error("GET /api/plantillas error", err);
    res.status(500).json({ error: "Error consultando catálogo de plantillas." });
  }
});

// ---------- Generador de Planes y Recomendaciones ----------
app.get("/api/planes/sugeridos", requireAdmin, async (req, res) => {
  try {
    const { nicho = "eCommerce", objetivo = "conversion" } = req.query;

    const allTemplatesRes = await pool.query(`SELECT id, tier, nivel, titulo, que, angulo, seg, cortes, nichos, objetivos FROM plantillas ORDER BY random()`);
    const all = allTemplatesRes.rows;

    const estandar = all.filter((t) => t.nivel === "estandar");
    const premium = all.filter((t) => t.nivel === "premium");

    const starterTemplates = estandar.slice(0, 4);
    const growthTemplates = [...premium.slice(0, 4), ...estandar.slice(0, 4)];
    const scaleTemplates = [...premium.slice(0, 6), ...estandar.slice(0, 6)];

    const planes = [
      {
        id: "starter",
        nombre: "Plan Starter — Prueba y Validación",
        cantidadVideos: 4,
        precioCop: 1200000,
        precioUsd: 320,
        recomendada: false,
        descripcion: "Ideal para marcas que quieren validar pauta y crear sus primeros 4 creativos de alto impacto sin riesgo.",
        entregables: [
          "4 guiones técnicos con estructura de retención probada",
          "4 piezas terminadas 9:16 listas para Meta/TikTok Ads",
          "Edición con subtítulos dinámicos y audio sincronizado",
          "1 ronda de revisión por video en Sala de Aprobación",
          "Acta de ejecución firmada al completar"
        ],
        plantillas: starterTemplates.map((t) => ({ id: t.id, nombre: t.titulo, nivel: t.nivel, duracion: Number(t.seg), gancho: t.angulo }))
      },
      {
        id: "crecimiento",
        nombre: "Plan Crecimiento — Tracción y Escala",
        cantidadVideos: 8,
        precioCop: 2100000,
        precioUsd: 550,
        recomendada: true,
        descripcion: "El plan más contratado: combina ángulos de venta directa con contenido de autoridad para bajar el costo por adquisición.",
        entregables: [
          "8 guiones estratégicos con 3 variantes de gancho por pieza",
          "8 piezas terminadas 9:16 (mix 4 Estándar + 4 Premium Remotion)",
          "Motion graphics de marca y diseño de sonido profesional",
          "2 rondas de revisión cuadro a cuadro por video",
          "Desglose de métricas de retención y curvas de caída",
          "Acta de ejecución y entrega de masters"
        ],
        plantillas: growthTemplates.map((t) => ({ id: t.id, nombre: t.titulo, nivel: t.nivel, duracion: Number(t.seg), gancho: t.angulo }))
      },
      {
        id: "escala",
        nombre: "Plan Escala Total — Dominio de Pauta",
        cantidadVideos: 12,
        precioCop: 2950000,
        precioUsd: 780,
        recomendada: false,
        descripcion: "Para marcas y creadores con campañas activas que necesitan volumen de creativos frescos cada semana.",
        entregables: [
          "12 videos terminados 9:16 listos para pauta y orgánico",
          "Mix completo de plantillas Premium, Guías de Producto y Trailers",
          "Animación cinematográfica y tipografía de impacto",
          "Rondas ilimitadas de ajustes sobre el storyboard base",
          "Entrega escalonada (3 videos semanales listos para publicar)",
          "Acta ejecutiva mensual y soporte prioritario de TATÁN & STUDIO"
        ],
        plantillas: scaleTemplates.map((t) => ({ id: t.id, nombre: t.titulo, nivel: t.nivel, duracion: Number(t.seg), gancho: t.angulo }))
      }
    ];

    res.json({ nicho, objetivo, planes });
  } catch (err) {
    console.error("GET /api/planes/sugeridos error", err);
    res.status(500).json({ error: "Error calculando planes sugeridos." });
  }
});

// ---------- Propuestas (Guardar y Consultar) ----------
app.get("/api/propuestas", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM propuestas ORDER BY id DESC`);
    res.json({ propuestas: result.rows });
  } catch (err) {
    console.error("GET /api/propuestas error", err);
    res.status(500).json({ error: "Error consultando propuestas." });
  }
});

app.post("/api/propuestas", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { clienteNombre, nicho, objetivoComercial, opciones, notas, creadoPor = "TATAN" } = req.body;
    if (!clienteNombre || !Array.isArray(opciones) || opciones.length === 0) {
      return res.status(400).json({ error: "Faltan datos obligatorios del cliente u opciones del plan." });
    }

    await client.query("BEGIN");
    const countRes = await client.query(`SELECT count(*)::int AS count FROM propuestas`);
    const nextNum = (countRes.rows[0].count || 0) + 1;
    const codigo = `PROP-2026-${String(nextNum).padStart(3, "0")}`;

    const totalEstimado = opciones.find((o) => o.recomendada)?.precioCop || opciones[0].precioCop || 0;

    const propRes = await client.query(
      `INSERT INTO propuestas (codigo, cliente, nicho, objetivo, total_cop, notas, creada_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [codigo, clienteNombre.trim(), nicho || "General", objetivoComercial || "Conversión", totalEstimado, notas || null, creadoPor]
    );
    const propuesta = propRes.rows[0];

    for (const op of opciones) {
      await client.query(
        `INSERT INTO propuesta_opciones (propuesta_id, nombre_plan, cantidad_videos, precio_cop, precio_usd, entregables, recomendada)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [propuesta.id, op.nombre, op.cantidadVideos || 4, op.precioCop || 0, op.precioUsd || null, op.entregables || [], !!op.recomendada]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, propuesta, codigo });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/propuestas error", err);
    res.status(500).json({ error: "Error creando propuesta." });
  } finally {
    client.release();
  }
});

// ---------- PDF de Propuesta Comercial ----------
app.get("/api/propuestas/:id/pdf", requireAdmin, async (req, res) => {
  try {
    const propRes = await pool.query(`SELECT * FROM propuestas WHERE id = $1`, [req.params.id]);
    const propuesta = propRes.rows[0];
    if (!propuesta) return res.status(404).send("Propuesta no encontrada.");

    const opcRes = await pool.query(`SELECT * FROM propuesta_opciones WHERE propuesta_id = $1 ORDER BY precio_cop ASC`, [propuesta.id]);
    const opciones = opcRes.rows;

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="propuesta-${propuesta.codigo || propuesta.id}.pdf"`);
    doc.pipe(res);

    // Header ImpulData
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#b9792b").text("ImpulData Studio");
    doc.fontSize(10).fillColor("#70616a").text("Estrategia y Producción de Video para Pauta");
    doc.moveDown(0.5);
    doc.strokeColor("#e2d5bb").lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Datos de la propuesta
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#2a1f24").text(`Propuesta de Contenido: ${propuesta.cliente}`);
    doc.font("Helvetica").fontSize(11).fillColor("#5a4f54")
      .text(`Código: ${propuesta.codigo || 'PROP-2026-001'} · Fecha: ${new Date(propuesta.creada_en || Date.now()).toLocaleDateString("es-CO")} · Vigencia: 15 días`);
    doc.text(`Nicho: ${propuesta.nicho || 'General'} · Objetivo principal: ${propuesta.objetivo || 'Conversión'}`);
    doc.moveDown(1.5);

    doc.font("Helvetica-Bold").fontSize(14).fillColor("#2a1f24").text("Opciones de Inversión y Alcance");
    doc.moveDown(0.5);

    for (const op of opciones) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor(op.recomendada ? "#b9792b" : "#2a1f24")
        .text(`${op.nombre_plan || 'Plan ImpulData'} ${op.recomendada ? "★ OPCIÓN RECOMENDADA" : ""}`);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#2e7d32")
        .text(`Inversión: $${Number(op.precio_cop || 0).toLocaleString("es-CO")} COP ${op.precio_usd ? `(~ $${op.precio_usd} USD)` : ""}`);
      doc.font("Helvetica").fontSize(10).fillColor("#5a4f54").text(`Volumen: ${op.cantidad_videos || 4} videos terminados en formato 9:16`);
      
      if (Array.isArray(op.entregables) && op.entregables.length > 0) {
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#70616a").text("Incluye:");
        for (const item of op.entregables) {
          doc.font("Helvetica").fontSize(9).fillColor("#2a1f24").text(`  • ${item}`);
        }
      }
      doc.moveDown(1);
    }

    doc.moveDown(1);
    doc.strokeColor("#e2d5bb").lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#2a1f24").text("Metodología de Trabajo y Aprobación:");
    doc.font("Helvetica").fontSize(9).fillColor("#5a4f54")
      .text("1. Selección y adaptación de guiones sobre plantillas validadas.\n2. Revisión del storyboard cuadro por cuadro en nuestra Sala de Aprobación online (sin cuentas ni contraseñas).\n3. Renderizado y entrega de masters con acta de conformidad digital.");
    doc.moveDown(1.5);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#b9792b").text("ImpulData · Creadores de Contenido y Software de Crecimiento");

    doc.end();
  } catch (err) {
    console.error("GET propuesta PDF error", err);
    res.status(500).send("Error generando PDF de la propuesta.");
  }
});

// ---------- Consecutivos ORG (Neon DB) ----------
app.get("/api/consecutivos", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM consecutivos_org ORDER BY numero DESC`);
    res.json({ total: result.rowCount, consecutivos: result.rows });
  } catch (err) {
    console.error("GET /api/consecutivos error", err);
    res.status(500).json({ error: "Error consultando consecutivos ORG." });
  }
});

app.post("/api/consecutivos", requireAdmin, async (req, res) => {
  try {
    const { descripcion, autor = "TATAN", referenciaCorta = "" } = req.body;
    if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: "Falta la descripción del consecutivo." });

    const maxRes = await pool.query(`SELECT COALESCE(MAX(numero), 83) AS max_num FROM consecutivos_org`);
    const nextNum = (maxRes.rows[0].max_num || 83) + 1;
    const codigo = `ORG-2026-${String(nextNum).padStart(3, "0")}`;
    const fecha = new Date().toISOString().slice(0, 10);

    const insertRes = await pool.query(
      `INSERT INTO consecutivos_org (codigo, numero, descripcion, autor, registrado_por, fecha, referencia_corta)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [codigo, nextNum, descripcion.trim(), autor, "GRAVITY", fecha, referenciaCorta || null]
    );

    res.json({ ok: true, consecutivo: insertRes.rows[0] });
  } catch (err) {
    console.error("POST /api/consecutivos error", err);
    res.status(500).json({ error: "Error registrando consecutivo ORG." });
  }
});

// ---------- SPA & UI Routes ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.get("/planes", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "planes.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "login.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "panel.html")));
app.get("/panel/:id", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "panel-proyecto.html")));
app.get("/revision/:shareSlug", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "revision.html")));
app.get("/health", (req, res) => res.json({ ok: true, db: "Neon Postgres (impuldata_estado)", templates: 97, consecutives: 83 }));

app.use((req, res) => res.status(404).send("Página no encontrada."));

async function start() {
  await migrate();
  app.listen(PORT, () => console.log(`Sala de Aprobación y Planes ImpulData escuchando en http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error("No se pudo arrancar el servidor:", err);
  process.exit(1);
});
