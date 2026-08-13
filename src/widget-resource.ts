import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WIDGET_URI = "ui://widget/pokemon-card.html";

function getWebDistPath(relativePath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "web", "dist", relativePath);
}

export function buildWidgetHtml(): string {
  const widgetJs = readFileSync(getWebDistPath("widget.js"), "utf-8");

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pokémon card</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@600;700;800&display=swap"
      rel="stylesheet"
    />
    <!-- widget-build: 2026-08-13a -->
  </head>
  <body>
    <div class="widget" id="app">
      <div class="widget-status" id="widget-status">Widget Pokémon cargado — esperando datos…</div>

      <div class="empty" id="empty-state">
        Pide un Pokémon en el chat o usa el buscador cuando haya datos.
      </div>

      <div id="pokemon-card" hidden>
        <section class="hero">
          <div class="sprite-wrap">
            <img class="sprite" id="sprite" alt="" width="112" height="112" />
          </div>
          <div class="identity">
            <p class="dex" id="dex">#000</p>
            <h1 class="name" id="name">Pokémon</h1>
            <div class="meta-row" id="types"></div>
            <div class="meta-row" id="meta"></div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title">Abilities</h2>
          <ul class="abilities" id="abilities"></ul>
        </section>

        <section class="section">
          <h2 class="section-title">Base stats</h2>
          <div class="stats" id="stats"></div>
        </section>

        <section class="section" id="matchups-section" hidden>
          <h2 class="section-title">Type matchups</h2>
          <div class="matchups" id="matchups"></div>
        </section>

        <div class="actions">
          <div class="lookup">
            <input id="lookup-input" type="text" placeholder="pikachu o 25" autocomplete="off" />
            <button type="button" id="lookup-btn" class="primary">Buscar</button>
          </div>
          <button type="button" id="type-btn">Matchups</button>
        </div>
      </div>
    </div>

    <script>
${widgetJs}
    </script>
  </body>
</html>`;
}
