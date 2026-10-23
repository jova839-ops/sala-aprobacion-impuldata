const express = require("express");
const { pool } = require("../db");
const { streamActaPdf } = require("../pdf");

const router = express.Router();

router.get("/api/review/:shareSlug", async (req, res) => {
  try {
    const projectRes = await pool.query(
      `SELECT * FROM storyboard_projects WHERE share_slug = $1`,
      [req.params.shareSlug]
    );
    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "No encontramos este proyecto." });

    const scenesRes = await pool.query(
      `SELECT * FROM storyboard_scenes WHERE project_id = $1 ORDER BY scene_number ASC`,
      [project.id]
    );
    const roundsRes = await pool.query(
      `SELECT * FROM approval_rounds WHERE project_id = $1 ORDER BY round_number ASC`,
      [project.id]
    );
    const rounds = roundsRes.rows;
    const activeRound = rounds.find((r) => r.status === "abierta") || null;

    res.json({
      project: {
        id: project.id,
        encargoCode: project.encargo_code,
        pieceName: project.piece_name,
        clientName: project.client_name,
        introMessage: project.intro_message,
        ideaAngle: project.idea_angle,
        ideaAudience: project.idea_audience,
        colorPaletteNotes: project.color_palette_notes,
        typographyNotes: project.typography_notes,
        currentTierLabel: project.current_tier_label,
        currentTierDescription: project.current_tier_description,
        nextTierLabel: project.next_tier_label,
        nextTierDescription: project.next_tier_description,
        maxReviewRounds: project.max_review_rounds,
      },
      scenes: scenesRes.rows.map((s) => ({
        id: s.id,
        sceneNumber: s.scene_number,
        sceneTitle: s.scene_title,
        sceneRole: s.scene_role,
        imagePath: s.image_path,
        secondsStart: Number(s.seconds_start),
        secondsEnd: Number(s.seconds_end),
        intendedFeeling: s.intended_feeling,
        artisticReasoning: s.artistic_reasoning,
      })),
      rounds: rounds.map((r) => ({
        id: r.id,
        roundNumber: r.round_number,
        status: r.status,
        submittedAt: r.submitted_at,
      })),
      activeRoundId: activeRound ? activeRound.id : null,
    });
  } catch (err) {
    console.error("GET /api/review error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

router.post("/api/review/:shareSlug/submit", async (req, res) => {
  const client = await pool.connect();
  try {
    const { roundId, reviews } = req.body;
    if (!roundId || !Array.isArray(reviews) || reviews.length === 0) {
      return res.status(400).json({ error: "Faltan datos de la revisión." });
    }

    const projectRes = await client.query(
      `SELECT * FROM storyboard_projects WHERE share_slug = $1`,
      [req.params.shareSlug]
    );
    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "No encontramos este proyecto." });

    const roundRes = await client.query(
      `SELECT * FROM approval_rounds WHERE id = $1 AND project_id = $2`,
      [roundId, project.id]
    );
    const round = roundRes.rows[0];
    if (!round) return res.status(404).json({ error: "No encontramos esta ronda." });
    if (round.status !== "abierta") {
      return res.status(409).json({ error: "Esta ronda ya fue enviada y quedó bloqueada." });
    }

    const scenesRes = await client.query(
      `SELECT id, scene_number FROM storyboard_scenes WHERE project_id = $1`,
      [project.id]
    );
    const sceneIds = new Set(scenesRes.rows.map((s) => s.id));
    const reviewBySceneId = new Map(reviews.map((r) => [r.sceneId, r]));

    for (const scene of scenesRes.rows) {
      if (!reviewBySceneId.has(scene.id)) {
        return res.status(400).json({ error: `Falta la decisión del cuadro ${scene.scene_number}.` });
      }
    }
    for (const sceneId of reviewBySceneId.keys()) {
      if (!sceneIds.has(sceneId)) {
        return res.status(400).json({ error: "Un cuadro enviado no pertenece a este proyecto." });
      }
      const decision = reviewBySceneId.get(sceneId).decision;
      if (decision !== "aprobado" && decision !== "ajuste_solicitado") {
        return res.status(400).json({ error: "Decisión inválida." });
      }
    }

    await client.query("BEGIN");

    for (const scene of scenesRes.rows) {
      const review = reviewBySceneId.get(scene.id);
      await client.query(
        `INSERT INTO scene_reviews (round_id, scene_id, decision, comment)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (round_id, scene_id) DO UPDATE SET decision = EXCLUDED.decision, comment = EXCLUDED.comment`,
        [round.id, scene.id, review.decision, review.comment ? String(review.comment).trim() : null]
      );
    }

    const submittedAt = new Date();
    await client.query(
      `UPDATE approval_rounds SET status = 'bloqueada', submitted_at = $2 WHERE id = $1`,
      [round.id, submittedAt]
    );

    const nextRoundNumber = round.round_number + 1;
    const nextRoundOpened = nextRoundNumber <= project.max_review_rounds;
    if (nextRoundOpened) {
      await client.query(
        `INSERT INTO approval_rounds (project_id, round_number, status)
         VALUES ($1,$2,'abierta')
         ON CONFLICT (project_id, round_number) DO NOTHING`,
        [project.id, nextRoundNumber]
      );
    }

    await client.query("COMMIT");

    res.json({
      roundNumber: round.round_number,
      actaPdfUrl: `/api/review/${req.params.shareSlug}/acta/${round.id}.pdf`,
      nextRoundOpened,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/review/submit error", err);
    res.status(500).json({ error: "Error inesperado." });
  } finally {
    client.release();
  }
});

router.get("/api/review/:shareSlug/acta/:roundId.pdf", async (req, res) => {
  try {
    const projectRes = await pool.query(
      `SELECT * FROM storyboard_projects WHERE share_slug = $1`,
      [req.params.shareSlug]
    );
    const project = projectRes.rows[0];
    if (!project) return res.status(404).send("No encontrado.");

    const roundRes = await pool.query(
      `SELECT * FROM approval_rounds WHERE id = $1 AND project_id = $2`,
      [req.params.roundId, project.id]
    );
    const round = roundRes.rows[0];
    if (!round || !round.submitted_at) return res.status(404).send("Esta ronda no tiene acta todavía.");

    const reviewsRes = await pool.query(
      `SELECT sr.decision, sr.comment, ss.scene_number, ss.scene_title, ss.scene_role
       FROM scene_reviews sr
       JOIN storyboard_scenes ss ON ss.id = sr.scene_id
       WHERE sr.round_id = $1
       ORDER BY ss.scene_number ASC`,
      [round.id]
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="acta-${project.encargo_code}-ronda-${round.round_number}.pdf"`
    );
    streamActaPdf(res, {
      pieceName: project.piece_name,
      clientName: project.client_name,
      roundNumber: round.round_number,
      maxReviewRounds: project.max_review_rounds,
      submittedAt: round.submitted_at,
      scenes: reviewsRes.rows,
    });
  } catch (err) {
    console.error("GET acta error", err);
    res.status(500).send("Error generando el acta.");
  }
});

module.exports = router;
