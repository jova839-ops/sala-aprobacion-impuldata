const { pool } = require("./db");

// Datos reales del piloto ENC-2026-003, derivados del storyboard v5 ya aprobado.
// Idempotente: se puede correr muchas veces sin duplicar filas.
async function seed() {
  const project = await pool.query(
    `INSERT INTO storyboard_projects (
       encargo_code, piece_name, client_name, share_slug, intro_message,
       idea_angle, idea_audience, color_palette_notes, typography_notes,
       current_tier_label, current_tier_description, next_tier_label, next_tier_description,
       max_review_rounds
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (encargo_code) DO UPDATE SET
       piece_name = EXCLUDED.piece_name,
       client_name = EXCLUDED.client_name,
       intro_message = EXCLUDED.intro_message,
       idea_angle = EXCLUDED.idea_angle,
       idea_audience = EXCLUDED.idea_audience,
       color_palette_notes = EXCLUDED.color_palette_notes,
       typography_notes = EXCLUDED.typography_notes,
       updated_at = now()
     RETURNING id`,
    [
      "ENC-2026-003",
      "Arte en su Jardín",
      "Flavia Rosales / Marcela Cárdenas",
      "arte-en-su-jardin",
      "Así pensamos tu video: cada cuadro de aquí abajo es una decisión tomada a propósito — qué sientes, cuándo lo sientes y por qué. Revísalos, dinos si algo no encaja, y aprueba cuando estén listos.",
      "\"No vienes a entenderlo, vienes a sentirlo florecer.\" El video contrasta el arte de museo —algo que se mira de lejos, detrás de un marco— con el arte que se vive y respira como un jardín: la obra de Flavia Rosales presentada como algo vivo, cercano, que crece, no una pieza distante para admirar en silencio.",
      "Público interesado en arte y cultura en Barranquilla, cercano a la Universidad Simón Bolívar (a pocas cuadras del evento), seguidores de Flavia Rosales y de Arte en su Jardín de Marcela Cárdenas.",
      "Tres colores con significado fijo: Tinta (texto principal, la voz seria y cercana) · Tierra (datos prácticos del evento y remates emocionales) · Papel (fondo y texto sobre naturaleza real).",
      "Instrument Serif Italic para las frases íntimas (el gancho, \"No vienes a entenderlo\"); Archivo (800-900) para titulares de impacto y datos del evento.",
      "Premium",
      "[PLACEHOLDER -- MAX reemplaza antes de publicar] Descripción de lo que el cliente ya tiene contratado hoy.",
      "[PLACEHOLDER -- MAX reemplaza antes de publicar] Nombre del siguiente nivel",
      "[PLACEHOLDER -- MAX reemplaza antes de publicar] Qué gana el cliente si sube de nivel.",
      2,
    ]
  );
  const projectId = project.rows[0].id;

  const scenes = [
    [1, "Gancho — El Museo", "gancho", "/images/escena_1.jpg", 0.0, 1.95,
      "Curiosidad tranquila, casi solemne — como entrar a una sala de museo.",
      "Arrancamos con quietud y un marco dibujado, no una foto, para plantar la idea de \"arte para mirar de lejos\" antes de romperla. El contraste prepara el giro de la escena 2."],
    [2, "Ruptura — \"No.\"", "desarrollo", "/images/escena_2.jpg", 1.95, 3.90,
      "Sorpresa, un golpe de energía que corta la calma inicial.",
      "El marco se rompe físicamente en cámara para decir, sin palabras, que esta pieza no es \"arte de museo\": el impacto sonoro y la sacudida de cámara refuerzan el quiebre antes de los 3 segundos."],
    [3, "Naturaleza — Se mueve y respira", "desarrollo", "/images/escena_3.jpg", 3.90, 7.80,
      "Calma viva — que la obra respira, no está quieta en una pared.",
      "Clips reales de naturaleza (gotas, helecho a contraluz) convierten la metáfora en experiencia sensorial; el texto entra palabra por palabra para que se sienta hablado, no leído."],
    [4, "Florece — Arte vivo", "desarrollo", "/images/escena_4.jpg", 7.80, 11.71,
      "Asombro creciente, la obra cobrando protagonismo.",
      "Las piezas de Flavia entran una a una como recortes de papel pegados, hasta que una salta al centro: el remate visual llega justo antes del mensaje clave."],
    [5, "Mensaje clave — Sentirlo florecer", "mensaje", "/images/escena_5.jpg", 11.71, 15.61,
      "El corazón del mensaje: que no es para entender, es para sentir.",
      "La obra real de Flavia vive de fondo en transparencia mientras el texto construye la frase central tiempo a tiempo; la cámara empuja levemente para dar peso al remate \"FLORECER.\""],
    [6, "Datos del evento", "mensaje", "/images/escena_6.jpg", 15.61, 19.51,
      "Claridad práctica — ya sabes qué sentir, ahora sabes a dónde ir.",
      "Después del clímax emocional bajamos a lo concreto (fecha, hora, lugar) con la misma textura visual de las obras de fondo, para que el dato no se sienta como un corte publicitario."],
    [7, "Cierre — Te esperamos", "cierre_y_llamado_a_la_accion", "/images/escena_7.jpg", 19.51, 24.00,
      "Calidez personal y una invitación directa a compartir.",
      "El cierre nombra a las dos personas detrás del evento (Flavia y Marcela) y pide una acción concreta y social (etiquetar, compartir) en vez de terminar solo con el logo."],
  ];

  for (const s of scenes) {
    await pool.query(
      `INSERT INTO storyboard_scenes
         (project_id, scene_number, scene_title, scene_role, image_path, seconds_start, seconds_end, intended_feeling, artistic_reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (project_id, scene_number) DO UPDATE SET
         scene_title = EXCLUDED.scene_title,
         scene_role = EXCLUDED.scene_role,
         image_path = EXCLUDED.image_path,
         seconds_start = EXCLUDED.seconds_start,
         seconds_end = EXCLUDED.seconds_end,
         intended_feeling = EXCLUDED.intended_feeling,
         artistic_reasoning = EXCLUDED.artistic_reasoning`,
      [projectId, ...s]
    );
  }

  await pool.query(
    `INSERT INTO approval_rounds (project_id, round_number, status)
     VALUES ($1, 1, 'abierta')
     ON CONFLICT (project_id, round_number) DO NOTHING`,
    [projectId]
  );

  console.log(`Seed OK — proyecto ${projectId} (ENC-2026-003), 7 escenas, ronda 1 abierta.`);
}

module.exports = { seed };
