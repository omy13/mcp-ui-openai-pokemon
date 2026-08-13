# Pokémon MCP

MCP server de ejemplo que expone [PokéAPI](https://pokeapi.co/) como tools de ChatGPT y Cursor, con un widget visual embebido (MCP Apps).

Implementa el flujo recomendado por OpenAI: primero [tools](https://developers.openai.com/plugins/build/mcp-server), después [UI](https://developers.openai.com/plugins/build/chatgpt-ui).

## Demo

Conector activo en ChatGPT y petición al modelo:

![ChatGPT con el conector Pokémon MCP activo](images/paso6.png)

Respuesta con la tarjeta visual generada por `render_pokemon_widget`:

![Widget de Charmander renderizado en ChatGPT](images/paso7.png)

## Características

- **Tools read-only** contra PokéAPI (`list_pokemon`, `get_pokemon`, `get_type`)
- **Patrón desacoplado**: tools de datos + tool de render con `_meta.ui.resourceUri`
- **Widget inline** con sprite, tipos, habilidades, stats y matchups
- **Dos transports**: stdio (Cursor) y Streamable HTTP `/mcp` (ChatGPT / Inspector)
- **Preview local** en `/preview` sin depender del host

## Requisitos

- Node.js 18+
- npm

## Inicio rápido

```bash
git clone git@github.com:omy13/mcp-ui-openai-pokemon.git
cd mcp-ui-openai-pokemon

npm install
npm --prefix web install
npm run build:web   # obligatorio antes de arrancar el server
npm run dev:http
```

Comprueba el widget en http://localhost:8787/preview y el endpoint MCP en http://localhost:8787/mcp.

> **Importante:** tras clonar el repo, ejecuta siempre `npm run build:web`. El server embebe `web/dist/widget.js` en el resource HTML; sin ese build, `dev:http` fallará.

## Tools

| Tool | Descripción | UI |
|------|-------------|----|
| `list_pokemon` | Lista Pokémon paginados (`limit`, `offset`) | No |
| `get_pokemon` | Detalle por nombre o id (`pikachu`, `25`) | No |
| `get_type` | Matchups y Pokémon de un tipo | No |
| `render_pokemon_widget` | Renderiza la tarjeta visual | Sí |

Flujo recomendado en ChatGPT:

1. El modelo llama `get_pokemon` y obtiene `structuredContent`.
2. Luego llama `render_pokemon_widget` con esos campos.
3. ChatGPT monta el iframe con el resource `ui://widget/pokemon-card.html`.

## Desarrollo

### Preview del widget (sin ChatGPT)

```bash
npm run build:web
npm run dev:http
```

| URL | Descripción |
|-----|-------------|
| http://localhost:8787/preview | Pikachu mock |
| http://localhost:8787/preview/live | Datos reales de PokéAPI |

### Cursor (stdio)

```bash
npm run build:web
npm run dev
```

Configuración MCP (sustituye `PATH_TO_REPO` por la ruta absoluta del proyecto):

```json
{
  "mcpServers": {
    "pokemon-mcp": {
      "command": "node",
      "args": [
        "./node_modules/tsx/dist/cli.mjs",
        "src/index.ts"
      ],
      "cwd": "PATH_TO_REPO"
    }
  }
}
```

Si Cursor no encuentra `node` (común con nvm), usa la ruta absoluta del binario en `command`.

### ChatGPT (developer mode)

1. Arranca el server: `npm run build:web && npm run dev:http`
2. Expón el puerto con un túnel HTTPS, por ejemplo: `ngrok http 8787`
3. En ChatGPT: **Settings → Apps & Connectors → Advanced → Developer mode**
4. Crea un connector apuntando a `https://TU-TUNEL.ngrok.app/mcp`
5. En un chat nuevo, activa el connector y prueba: *Muestrame la carta de charmander*

Docs: [Connect from ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest \
  --server-url http://localhost:8787/mcp \
  --transport http
```

### Smoke test

```bash
npm run smoke
```

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | MCP por stdio (Cursor) |
| `npm run dev:http` | MCP HTTP en `:8787/mcp` |
| `npm run build:web` | Compila el widget (`web/dist/widget.js`) |
| `npm run build` | Widget + TypeScript → `dist/` |
| `npm run smoke` | Prueba rápida del cliente PokéAPI |

## Estructura del proyecto

```text
pokemon-mcp/
├── src/
│   ├── pokeapi-client.ts    # Cliente HTTP a PokéAPI
│   ├── server.ts            # McpServer + tools + resource
│   ├── widget-resource.ts   # HTML embebido del widget
│   ├── preview-widget.ts    # Datos mock para /preview
│   ├── http.ts              # Transport HTTP + preview
│   └── index.ts             # Transport stdio
├── web/
│   ├── src/                 # Widget (TypeScript + CSS)
│   └── dist/widget.js       # Bundle generado (no versionado)
└── images/                  # Capturas para documentación
```

## Variables de entorno

Copia `.env.example` si necesitas overrides:

```bash
POKEAPI_BASE_URL=https://pokeapi.co/api/v2
PORT=8787
```

## Referencias

- [PokéAPI](https://pokeapi.co/)
- [Build an MCP server — OpenAI](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to your MCP server — OpenAI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)

## Licencia

MIT — úsalo como base para tus propios MCP servers.
