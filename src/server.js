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

    CREATE TABLE IF NOT EXISTS admin_users (
      id serial primary key,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    ALTER TABLE storyboard_projects ADD COLUMN IF NOT EXISTS submit_password text;
  `);

  // Primer arranque: si no hay ningún admin en la tabla, se siembra desde las
  // variables de entorno (bootstrap). Después de esto, la contraseña vive SOLO
  // en la base de datos -- cambiarla ya no depende de tocar Render.
  const countRes = await pool.query(`SELECT count(*)::int AS n FROM admin_users`);
  if (countRes.rows[0].n === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH) {
    await pool.query(
      `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
      [process.env.ADMIN_EMAIL.trim().toLowerCase(), process.env.ADMIN_PASSWORD_HASH]
    );
    console.log(`Admin sembrado desde variables de entorno: ${process.env.ADMIN_EMAIL}`);
  }
}

// ---------- Seed (datos reales del piloto ENC-2026-003, derivados del storyboard v5 aprobado) ----------
async function seed() {
  const project = await pool.query(
    `INSERT INTO storyboard_projects (
       encargo_code, piece_name, client_name, share_slug, intro_message,
       idea_angle, idea_audience, color_palette_notes, typography_notes,
       current_tier_label, current_tier_description, next_tier_label, next_tier_description, max_review_rounds
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (encargo_code) DO UPDATE SET share_slug=EXCLUDED.share_slug, piece_name=EXCLUDED.piece_name, client_name=EXCLUDED.client_name,
       intro_message=EXCLUDED.intro_message, idea_angle=EXCLUDED.idea_angle, idea_audience=EXCLUDED.idea_audience,
       color_palette_notes=EXCLUDED.color_palette_notes, typography_notes=EXCLUDED.typography_notes, updated_at=now()
     RETURNING id`,
    [
      "ENC-2026-003", "Arte en su Jardin", "Flavia Rosales / Marcela Cardenas", "arte-en-su-jardin",
      "Asi pensamos tu video: cada cuadro de aqui abajo es una decision tomada a proposito -- que sientes, cuando lo sientes y por que. Revisalos, dinos si algo no encaja, y aprueba cuando esten listos.",
      "\"No vienes a entenderlo, vienes a sentirlo florecer.\" El video contrasta el arte de museo -algo que se mira de lejos, detras de un marco- con el arte que se vive y respira como un jardin.",
      "Publico interesado en arte y cultura en Barranquilla, cercano a la Universidad Simon Bolivar, seguidores de Flavia Rosales y de Arte en su Jardin de Marcela Cardenas.",
      "Tres colores con significado fijo: Tinta (texto principal) - Tierra (datos practicos y remates) - Papel (fondo y texto sobre naturaleza real).",
      "Instrument Serif Italic para las frases intimas; Archivo (800-900) para titulares de impacto y datos del evento.",
      "Premium",
      "[PLACEHOLDER -- MAX reemplaza antes de publicar] Descripcion de lo que el cliente ya tiene contratado hoy.",
      "[PLACEHOLDER -- MAX reemplaza antes de publicar] Nombre del siguiente nivel",
      "[PLACEHOLDER -- MAX reemplaza antes de publicar] Que gana el cliente si sube de nivel.",
      2,
    ]
  );
  const projectId = project.rows[0].id;
  const scenes = [
    [1, "Gancho -- El Museo", "gancho", "/images/escena_1.jpg", 0.0, 1.95, "Curiosidad tranquila, casi solemne -- como entrar a una sala de museo.", "Arrancamos con quietud y un marco dibujado, no una foto, para plantar la idea de \"arte para mirar de lejos\" antes de romperla."],
    [2, "Ruptura -- \"No.\"", "desarrollo", "/images/escena_2.jpg", 1.95, 3.90, "Sorpresa, un golpe de energia que corta la calma inicial.", "El marco se rompe fisicamente en camara para decir, sin palabras, que esta pieza no es \"arte de museo\"."],
    [3, "Naturaleza -- Se mueve y respira", "desarrollo", "/images/escena_3.jpg", 3.90, 7.80, "Calma viva -- que la obra respira, no esta quieta en una pared.", "Clips reales de naturaleza convierten la metafora en experiencia sensorial; el texto entra palabra por palabra."],
    [4, "Florece -- Arte vivo", "desarrollo", "/images/escena_4.jpg", 7.80, 11.71, "Asombro creciente, la obra cobrando protagonismo.", "Las piezas de Flavia entran una a una como recortes de papel pegados, hasta que una salta al centro."],
    [5, "Mensaje clave -- Sentirlo florecer", "mensaje", "/images/escena_5.jpg", 11.71, 15.61, "El corazon del mensaje: que no es para entender, es para sentir.", "La obra real de Flavia vive de fondo en transparencia mientras el texto construye la frase central."],
    [6, "Datos del evento", "mensaje", "/images/escena_6.jpg", 15.61, 19.51, "Claridad practica -- ya sabes que sentir, ahora sabes a donde ir.", "Despues del climax emocional bajamos a lo concreto con la misma textura visual de las obras de fondo."],
    [7, "Cierre -- Te esperamos", "cierre_y_llamado_a_la_accion", "/images/escena_7.jpg", 19.51, 24.00, "Calidez personal y una invitacion directa a compartir.", "El cierre nombra a las dos personas detras del evento y pide una accion concreta y social."],
  ];
  for (const s of scenes) {
    await pool.query(
      `INSERT INTO storyboard_scenes (project_id, scene_number, scene_title, scene_role, image_path, seconds_start, seconds_end, intended_feeling, artistic_reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (project_id, scene_number) DO UPDATE SET scene_title=EXCLUDED.scene_title, scene_role=EXCLUDED.scene_role,
         image_path=EXCLUDED.image_path, seconds_start=EXCLUDED.seconds_start, seconds_end=EXCLUDED.seconds_end,
         intended_feeling=EXCLUDED.intended_feeling, artistic_reasoning=EXCLUDED.artistic_reasoning`,
      [projectId, ...s]
    );
  }
  await pool.query(
    `INSERT INTO approval_rounds (project_id, round_number, status) VALUES ($1,1,'abierta') ON CONFLICT (project_id, round_number) DO NOTHING`,
    [projectId]
  );
  console.log(`Seed OK -- proyecto ${projectId} (ENC-2026-003), 7 escenas, ronda 1 abierta.`);
}

// ---------- Auth ----------
const COOKIE_NAME = "sala_session";
const SESSION_HOURS = 12;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET no está configurada.");
  return secret;
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
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));

// ---------- Auth Routes ----------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Falta correo o contraseña." });
    const adminRes = await pool.query(`SELECT * FROM admin_users WHERE email = $1`, [email.trim().toLowerCase()]);
    const admin = adminRes.rows[0];
    if (!admin) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    const token = signSession({ email: admin.email, exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000 });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: SESSION_HOURS * 60 * 60 * 1000 });
    res.json({ email: admin.email });
  } catch (err) {
    console.error("POST /api/login error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});
app.post("/api/logout", (req, res) => { res.clearCookie(COOKIE_NAME); res.json({ ok: true }); });
app.get("/api/session", requireAdmin, (req, res) => res.json({ email: req.adminEmail }));

app.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Falta la contraseña actual o la nueva." });
    if (String(newPassword).length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
    const adminRes = await pool.query(`SELECT * FROM admin_users WHERE email = $1`, [req.adminEmail]);
    const admin = adminRes.rows[0];
    if (!admin) return res.status(404).json({ error: "No encontramos esta cuenta." });
    const ok = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!ok) return res.status(401).json({ error: "La contraseña actual no es correcta." });
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE admin_users SET password_hash = $1, updated_at = now() WHERE id = $2`, [newHash, admin.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/change-password error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

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
        requiresSubmitPassword: !!project.submit_password,
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
    const { roundId, reviews, password } = req.body;
    if (!roundId || !Array.isArray(reviews) || reviews.length === 0) return res.status(400).json({ error: "Faltan datos de la revisión." });
    const projectRes = await client.query(`SELECT * FROM storyboard_projects WHERE share_slug = $1`, [req.params.shareSlug]);
    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "No encontramos este proyecto." });
    if (project.submit_password && project.submit_password !== String(password || "")) {
      return res.status(401).json({ error: "Contraseña incorrecta." });
    }
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
    let query = `SELECT id, tier, nivel, nivel_porque, titulo, autor, cliente, cat, soft, fmt, que, gramatica, uso, angulo,
      seg, cortes, plano, estado, ficha, url, x, nichos, objetivos FROM plantillas WHERE 1=1`;
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
// -- admin routes (protegidas) --
app.get("/api/admin/projects", requireAdmin, async (req, res) => {
  try {
    const projectsRes = await pool.query(`SELECT * FROM storyboard_projects ORDER BY created_at DESC`);
    const projects = [];
    for (const project of projectsRes.rows) {
      const totalScenesRes = await pool.query(`SELECT count(*)::int AS count FROM storyboard_scenes WHERE project_id = $1`, [project.id]);
      const roundsRes = await pool.query(`SELECT * FROM approval_rounds WHERE project_id = $1 ORDER BY round_number DESC`, [project.id]);
      const rounds = roundsRes.rows;
      const latestSubmitted = rounds.find((r) => r.submitted_at !== null) || null;
      const latestRound = rounds[0] || null;
      let approved = 0, adjust = 0;
      if (latestSubmitted) {
        const reviewsRes = await pool.query(`SELECT decision FROM scene_reviews WHERE round_id = $1`, [latestSubmitted.id]);
        approved = reviewsRes.rows.filter((r) => r.decision === "aprobado").length;
        adjust = reviewsRes.rows.filter((r) => r.decision === "ajuste_solicitado").length;
      }
      projects.push({
        id: project.id, encargoCode: project.encargo_code, pieceName: project.piece_name, clientName: project.client_name,
        shareSlug: project.share_slug, totalScenes: totalScenesRes.rows[0].count,
        latestRoundNumber: latestRound ? latestRound.round_number : null, latestRoundStatus: latestRound ? latestRound.status : null,
        approvedScenesInLatestRound: approved, adjustScenesInLatestRound: adjust,
        lastSubmittedAt: latestSubmitted ? latestSubmitted.submitted_at : null,
      });
    }
    res.json({ projects });
  } catch (err) {
    console.error("GET /api/admin/projects error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

app.get("/api/admin/projects/:id", requireAdmin, async (req, res) => {
  try {
    const projectRes = await pool.query(`SELECT * FROM storyboard_projects WHERE id = $1`, [req.params.id]);
    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "No encontramos este proyecto." });
    const scenesRes = await pool.query(`SELECT id, scene_number, scene_title, scene_role FROM storyboard_scenes WHERE project_id = $1 ORDER BY scene_number ASC`, [project.id]);
    const roundsRes = await pool.query(`SELECT * FROM approval_rounds WHERE project_id = $1 ORDER BY round_number ASC`, [project.id]);
    const rounds = [];
    for (const round of roundsRes.rows) {
      const reviewsRes = await pool.query(`SELECT scene_id, decision, comment FROM scene_reviews WHERE round_id = $1`, [round.id]);
      rounds.push({
        id: round.id, roundNumber: round.round_number, status: round.status, submittedAt: round.submitted_at,
        reviews: reviewsRes.rows.map((r) => ({ sceneId: r.scene_id, decision: r.decision, comment: r.comment })),
      });
    }
    res.json({
      project: {
        id: project.id, encargoCode: project.encargo_code, pieceName: project.piece_name, clientName: project.client_name,
        shareSlug: project.share_slug, maxReviewRounds: project.max_review_rounds, requiresSubmitPassword: !!project.submit_password,
      },
      scenes: scenesRes.rows.map((s) => ({ id: s.id, sceneNumber: s.scene_number, sceneTitle: s.scene_title, sceneRole: s.scene_role })),
      rounds,
    });
  } catch (err) {
    console.error("GET /api/admin/projects/:id error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

app.post("/api/admin/projects/:id/submit-password", requireAdmin, async (req, res) => {
  try {
    const { password } = req.body || {};
    const value = password && String(password).trim() ? String(password).trim() : null;
    const result = await pool.query(
      `UPDATE storyboard_projects SET submit_password = $1, updated_at = now() WHERE id = $2 RETURNING id`,
      [value, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "No encontramos este proyecto." });
    res.json({ ok: true, requiresSubmitPassword: !!value });
  } catch (err) {
    console.error("POST /api/admin/projects/:id/submit-password error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

app.get("/", (req, res) => res.redirect("/panel"));
app.get("/planes", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "planes.html")));
app.get("/catalogo", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "catalogo.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "login.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "panel.html")));
app.get("/panel/:id", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "panel-proyecto.html")));
app.get("/revision/:shareSlug", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "revision.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send("Página no encontrada."));

async function start() {
  getSecret(); // falla al arrancar si falta SESSION_SECRET
  await migrate();
  if (process.env.SEED_ON_BOOT === "true") await seed();
  app.listen(PORT, () => console.log(`Sala de Aprobación y Planes ImpulData escuchando en http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error("No se pudo arrancar el servidor:", err);
  process.exit(1);
});
