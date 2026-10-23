const express = require("express");
const { pool } = require("../db");
const { requireAdmin } = require("../auth");

const router = express.Router();

router.get("/api/admin/projects", requireAdmin, async (req, res) => {
  try {
    const projectsRes = await pool.query(`SELECT * FROM storyboard_projects ORDER BY created_at DESC`);
    const projects = [];

    for (const project of projectsRes.rows) {
      const totalScenesRes = await pool.query(
        `SELECT count(*)::int AS count FROM storyboard_scenes WHERE project_id = $1`,
        [project.id]
      );
      const roundsRes = await pool.query(
        `SELECT * FROM approval_rounds WHERE project_id = $1 ORDER BY round_number DESC`,
        [project.id]
      );
      const rounds = roundsRes.rows;
      const latestSubmitted = rounds.find((r) => r.submitted_at !== null) || null;
      const latestRound = rounds[0] || null;

      let approved = 0;
      let adjust = 0;
      if (latestSubmitted) {
        const reviewsRes = await pool.query(
          `SELECT decision FROM scene_reviews WHERE round_id = $1`,
          [latestSubmitted.id]
        );
        approved = reviewsRes.rows.filter((r) => r.decision === "aprobado").length;
        adjust = reviewsRes.rows.filter((r) => r.decision === "ajuste_solicitado").length;
      }

      projects.push({
        id: project.id,
        encargoCode: project.encargo_code,
        pieceName: project.piece_name,
        clientName: project.client_name,
        shareSlug: project.share_slug,
        totalScenes: totalScenesRes.rows[0].count,
        latestRoundNumber: latestRound ? latestRound.round_number : null,
        latestRoundStatus: latestRound ? latestRound.status : null,
        approvedScenesInLatestRound: approved,
        adjustScenesInLatestRound: adjust,
        lastSubmittedAt: latestSubmitted ? latestSubmitted.submitted_at : null,
      });
    }

    res.json({ projects });
  } catch (err) {
    console.error("GET /api/admin/projects error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

router.get("/api/admin/projects/:id", requireAdmin, async (req, res) => {
  try {
    const projectRes = await pool.query(`SELECT * FROM storyboard_projects WHERE id = $1`, [req.params.id]);
    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "No encontramos este proyecto." });

    const scenesRes = await pool.query(
      `SELECT id, scene_number, scene_title, scene_role FROM storyboard_scenes WHERE project_id = $1 ORDER BY scene_number ASC`,
      [project.id]
    );
    const roundsRes = await pool.query(
      `SELECT * FROM approval_rounds WHERE project_id = $1 ORDER BY round_number ASC`,
      [project.id]
    );

    const rounds = [];
    for (const round of roundsRes.rows) {
      const reviewsRes = await pool.query(
        `SELECT scene_id, decision, comment FROM scene_reviews WHERE round_id = $1`,
        [round.id]
      );
      rounds.push({
        id: round.id,
        roundNumber: round.round_number,
        status: round.status,
        submittedAt: round.submitted_at,
        reviews: reviewsRes.rows.map((r) => ({
          sceneId: r.scene_id,
          decision: r.decision,
          comment: r.comment,
        })),
      });
    }

    res.json({
      project: {
        id: project.id,
        encargoCode: project.encargo_code,
        pieceName: project.piece_name,
        clientName: project.client_name,
        shareSlug: project.share_slug,
        maxReviewRounds: project.max_review_rounds,
      },
      scenes: scenesRes.rows.map((s) => ({
        id: s.id,
        sceneNumber: s.scene_number,
        sceneTitle: s.scene_title,
        sceneRole: s.scene_role,
      })),
      rounds,
    });
  } catch (err) {
    console.error("GET /api/admin/projects/:id error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

module.exports = router;
