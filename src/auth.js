const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const COOKIE_NAME = "sala_session";
const SESSION_HOURS = 12;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET no está configurada.");
  return secret;
}

function sign(payload) {
  const data = JSON.stringify(payload);
  const b64 = Buffer.from(data).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function verify(token) {
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

function createSessionCookie(res, email) {
  const token = sign({ email, exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000 });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function requireAdmin(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: "No autorizado. Inicia sesión." });
  }
  req.adminEmail = payload.email;
  next();
}

async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = {
  COOKIE_NAME,
  createSessionCookie,
  clearSessionCookie,
  requireAdmin,
  verify,
  checkPassword,
};
