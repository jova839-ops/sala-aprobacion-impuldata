const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { migrate } = require("./db");
const { seed } = require("./seed");
const reviewRoutes = require("./routes/review");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(reviewRoutes);
app.use(authRoutes);
app.use(adminRoutes);

// Rutas de página: SPA simple, cada una sirve su HTML y el JS del navegador
// lee el slug / id de la URL.
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "login.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "panel.html")));
app.get("/panel/:id", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "panel-proyecto.html")));
app.get("/revision/:shareSlug", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "public", "revision.html"))
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).send("No encontrado."));

async function start() {
  await migrate();
  if (process.env.SEED_ON_BOOT === "true") {
    await seed();
  }
  app.listen(PORT, () => {
    console.log(`Sala de Aprobación ImpulData escuchando en el puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo arrancar el servidor:", err);
  process.exit(1);
});
