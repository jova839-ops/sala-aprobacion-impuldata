// Shell interno: barra lateral, chequeo de sesión y salida. Envuelve el primer .page del body.
(function () {
  const ICONS = {
    panel: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z"/>',
    catalogo: '<path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    planes: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  };
  const LINKS = [
    { key: "panel", href: "/panel", label: "Sala de Aprobación" },
    { key: "catalogo", href: "/catalogo", label: "Catálogo" },
    { key: "planes", href: "/planes", label: "Planes y Propuestas" },
  ];
  const path = location.pathname;
  const activeKey = path.startsWith("/catalogo") ? "catalogo" : path.startsWith("/planes") ? "planes" : "panel";

  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  document.body.classList.add("app");
  const content = document.querySelector("body > .page, body > main, body > .catalog");
  const shell = document.createElement("div");
  shell.className = "shell";
  shell.innerHTML = `
    <aside class="side">
      <a class="brand" href="/panel"><span class="brand-mark">I</span><span><span class="brand-name">ImpulData</span><span class="brand-sub">Studio · interno</span></span></a>
      <nav class="nav">
        <div class="nav-label">Trabajo</div>
        ${LINKS.map((l) => `<a href="${l.href}" class="${l.key === activeKey ? "active" : ""}">${icon(l.key)}<span>${l.label}</span><span class="count" data-count="${l.key}"></span></a>`).join("")}
      </nav>
      <div class="side-foot"><span id="shellUser">…</span><button type="button" id="shellLogout">Salir</button></div>
    </aside>
    <div class="main"><div class="topbar"><button type="button" id="shellMenu" aria-label="Abrir menú">☰</button><strong>ImpulData Studio</strong><span></span></div></div>`;
  document.body.prepend(shell);
  if (content) shell.querySelector(".main").appendChild(content);

  shell.querySelector("#shellMenu").addEventListener("click", () => shell.classList.toggle("open"));
  shell.querySelector(".side").addEventListener("click", (e) => { if (e.target.closest("a")) shell.classList.remove("open"); });
  shell.querySelector("#shellLogout").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/login";
  });

  fetch("/api/session").then(async (r) => {
    if (r.status === 401) { location.href = "/login"; return; }
    const s = await r.json();
    shell.querySelector("#shellUser").textContent = s.email;
  });

  window.setNavCount = (key, n) => {
    const el = shell.querySelector(`[data-count="${key}"]`);
    if (el) el.textContent = n;
  };
})();
