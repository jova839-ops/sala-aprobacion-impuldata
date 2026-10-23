const express = require("express");
const { createSessionCookie, clearSessionCookie, checkPassword, requireAdmin } = require("../auth");

const router = express.Router();

router.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminEmail || !adminHash) {
      return res.status(500).json({ error: "El panel no tiene credenciales configuradas todavía." });
    }
    if (!email || !password) {
      return res.status(400).json({ error: "Falta correo o contraseña." });
    }
    if (email.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }
    const ok = await checkPassword(password, adminHash);
    if (!ok) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }
    createSessionCookie(res, adminEmail);
    res.json({ email: adminEmail });
  } catch (err) {
    console.error("POST /api/login error", err);
    res.status(500).json({ error: "Error inesperado." });
  }
});

router.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/api/session", requireAdmin, (req, res) => {
  res.json({ email: req.adminEmail });
});

module.exports = router;
