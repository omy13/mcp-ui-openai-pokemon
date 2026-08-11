# Pokémon MCP

MCP server mínimo con tools contra [PokéAPI](https://pokeapi.co/), sin UI todavía.

Sigue el flujo de la documentación de OpenAI ([Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)): primero tools + HTTP streamable, después UI.

## Requisitos

- Node.js 18+

## Instalación

```bash
npm install
```

## Tools

| Tool | Uso |
|------|-----|
| `list_pokemon` | Listar Pokémon paginados (`limit`, `offset`) |
| `get_pokemon` | Detalle por nombre o id (`pikachu`, `25`) |
| `get_type` | Matchups y Pokémon de un tipo (`electric`) |

Todas son read-only y consultan la API pública de PokéAPI (`openWorldHint: true`).

## Ejecutar

### Cursor (stdio)

```bash
npm run dev
```

Configuración MCP en Cursor. Sustituye `PATH_TO_REPO` por la ruta absoluta de este proyecto:

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

Si Cursor no encuentra `node` (por ejemplo con nvm), usa la ruta absoluta de tu binario de Node en `command`.

### ChatGPT / Inspector (HTTP en `/mcp`)

```bash
npm run dev:http
```

Deberías ver: `Pokémon MCP server listening on http://localhost:8787/mcp`

Probar con MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
```

## Smoke test

```bash
npm run smoke
```

## Siguiente paso

Cuando las tools funcionen end-to-end, puedes añadir UI con [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui) (`registerAppTool` + resource HTML).
